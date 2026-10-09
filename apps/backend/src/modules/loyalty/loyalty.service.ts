import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import {
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  User,
} from '../../database/entities';
import { LoyaltyConfig, MailConfig } from '../../config';
import { EmailService } from '../email/email.service';
import {
  definitionFor,
  tierForPoints,
  TIER_DEFINITIONS,
  TierDefinition,
} from './loyalty.constants';

export interface AwardOptions {
  userId: string;
  type: LoyaltyTransactionType;
  source: LoyaltyTransactionSource;
  points: number;
  referenceId?: string | null;
  description?: string;
  /** Pre-existing transaction manager (for use inside another DB transaction). */
  manager?: EntityManager;
}

export interface AwardResult {
  transaction: LoyaltyTransaction | null;
  /** True when the call was a no-op because the (source, referenceId) was already awarded. */
  duplicate: boolean;
  /** True when the user crossed into a higher tier as a result of this award. */
  tierUpgraded: boolean;
  newTier: LoyaltyTier;
  previousTier: LoyaltyTier;
  newBalance: number;
}

export interface LoyaltySnapshot {
  userId: string;
  points: number;
  tier: TierDefinition;
  nextTier?: TierDefinition;
  pointsToNextTier?: number;
  recentTransactions: LoyaltyTransaction[];
}

/**
 * Encapsulates all loyalty-points mutations.
 *
 * Idempotency: every awardable event MUST pass a `referenceId` (e.g.
 * `ticket:<ticketId>` or `profile_completion:<userId>`). The DB unique
 * constraint `(source, reference_id)` then guarantees double-fires
 * (Stripe webhook retries, email-redelivery, etc.) never double-award.
 *
 * Tier recalculation runs in the same transaction as the award so the
 * `users.loyalty_tier` column never gets out of sync with the points sum.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);
  private readonly config: LoyaltyConfig;
  private readonly mailConfig: MailConfig;

  constructor(
    @InjectRepository(LoyaltyTransaction)
    private readonly loyaltyRepository: Repository<LoyaltyTransaction>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.config = this.configService.getOrThrow<LoyaltyConfig>('loyalty');
    this.mailConfig = this.configService.getOrThrow<MailConfig>('mail');
  }

  async count(): Promise<number> {
    return this.loyaltyRepository.count();
  }

  /**
   * Records a loyalty transaction and updates the user's running balance + tier.
   *
   * - Pass a `referenceId` for idempotency (recommended for everything except admin adjustments).
   * - Pass `manager` to participate in an existing transaction (e.g. checkout flow).
   */
  async award(options: AwardOptions): Promise<AwardResult> {
    if (options.manager) {
      return this.runAward(options.manager, options);
    }
    return this.dataSource.transaction((manager) => this.runAward(manager, options));
  }

  async getSnapshot(userId: string): Promise<LoyaltySnapshot> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    const recentTransactions = await this.loyaltyRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 25,
    });
    const currentTier = definitionFor(user.loyaltyTier);
    const nextTier = TIER_DEFINITIONS.find((t) => t.minPoints > user.loyaltyPoints);
    return {
      userId,
      points: user.loyaltyPoints,
      tier: currentTier,
      nextTier,
      pointsToNextTier: nextTier ? Math.max(nextTier.minPoints - user.loyaltyPoints, 0) : undefined,
      recentTransactions,
    };
  }

  getTierDefinitions(): readonly TierDefinition[] {
    return TIER_DEFINITIONS;
  }

  getDiscountPercentForTier(tier: LoyaltyTier): number {
    return definitionFor(tier).discountPercent;
  }

  /**
   * Loyalty config exposure for other modules (e.g. checkout to award
   * ticket-purchase points).
   */
  getConfig(): LoyaltyConfig {
    return this.config;
  }

  private async runAward(manager: EntityManager, options: AwardOptions): Promise<AwardResult> {
    const userRepo = manager.getRepository(User);
    const txRepo = manager.getRepository(LoyaltyTransaction);

    const user = await userRepo.findOne({ where: { id: options.userId } });
    if (!user) {
      throw new NotFoundException(`User ${options.userId} not found for loyalty award`);
    }

    const previousTier = user.loyaltyTier;
    const newBalance = Math.max(user.loyaltyPoints + options.points, 0);

    const transaction = txRepo.create({
      userId: options.userId,
      type: options.type,
      source: options.source,
      points: options.points,
      balanceAfter: newBalance,
      referenceId: options.referenceId ?? undefined,
      description: options.description,
    });

    try {
      await txRepo.save(transaction);
    } catch (error) {
      if (error instanceof QueryFailedError && this.isDuplicateKey(error)) {
        this.logger.log(
          `Loyalty award skipped (duplicate) source=${options.source} ref=${options.referenceId ?? '-'} user=${options.userId}`,
        );
        return {
          transaction: null,
          duplicate: true,
          tierUpgraded: false,
          newTier: previousTier,
          previousTier,
          newBalance: user.loyaltyPoints,
        };
      }
      throw error;
    }

    const newTierDefinition = tierForPoints(newBalance);
    user.loyaltyPoints = newBalance;
    user.loyaltyTier = newTierDefinition.tier;
    await userRepo.save(user);

    const tierUpgraded =
      TIER_DEFINITIONS.findIndex((t) => t.tier === newTierDefinition.tier) >
      TIER_DEFINITIONS.findIndex((t) => t.tier === previousTier);

    if (tierUpgraded) {
      // Fire-and-forget tier upgrade email. Never block the caller on SMTP.
      void this.emailService
        .send({
          to: user.email,
          subject: `Új hűségszintet értél el: ${newTierDefinition.label}`,
          template: 'tier-upgraded',
          context: {
            recipientName: user.firstName,
            newTierLabel: newTierDefinition.label,
            newDiscountPercent: newTierDefinition.discountPercent,
            pointsBalance: newBalance,
            loyaltyDashboardUrl: `${this.mailConfig.baseUrl}/loyalty`,
          },
          correlationId: `tier-upgrade:${user.id}:${newTierDefinition.tier}`,
        })
        .catch((error: Error) => {
          this.logger.error(`Tier-upgrade email failed for user ${user.id}: ${error.message}`);
        });
    }

    return {
      transaction,
      duplicate: false,
      tierUpgraded,
      newTier: newTierDefinition.tier,
      previousTier,
      newBalance,
    };
  }

  private isDuplicateKey(error: QueryFailedError): boolean {
    const driverError = (
      error as QueryFailedError & { driverError?: { code?: string; errno?: number } }
    ).driverError;
    return driverError?.code === 'ER_DUP_ENTRY' || driverError?.errno === 1062;
  }
}
