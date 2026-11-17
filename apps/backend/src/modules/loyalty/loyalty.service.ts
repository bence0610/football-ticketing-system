import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import {
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  Match,
  PassLoan,
  Ticket,
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
import { minPointsOf, tierAfterAward, tierKeptUntil, tierRank } from './loyalty-tier-keeping';

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
  /**
   * Set while the tier is kept without the points to match it (the season-end conversion took the
   * balance below its threshold): the last day it is kept, `yyyy-mm-dd`.
   */
  tierKeptUntil?: string;
  /** With `tierKeptUntil`: how many points the balance is short of the kept tier's threshold. */
  pointsToKeepTier?: number;
  /** The real earning rules (from LoyaltyConfig), so the UI never hard-codes them. */
  earning: LoyaltyEarningRules;
  /** Distinct matches the user actually entered (a ticket with a scan). */
  matchesAttended: number;
  /** Size of the whole ledger, so the UI knows whether `recentTransactions` is all of it. */
  totalTransactions: number;
  recentTransactions: LoyaltyTransaction[];
}

export interface LoyaltyEarningRules {
  registrationPoints: number;
  profileCompletionPoints: number;
  /** Points for entering a match: once per person per match, with a ticket, a pass entry or a borrowed entry. */
  attendancePoints: number;
  seasonPassPoints: number;
  passLoanPoints: number;
  /** Share of the balance kept at the season-end conversion (0-100). */
  carryoverPercent: number;
  /** The tier discount applies to at most this many tickets per buyer per match. */
  discountTicketLimit: number;
}

export interface TransactionMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
}

export const SNAPSHOT_TRANSACTION_LIMIT = 25;

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
    const [recentTransactions, totalTransactions, matchesAttended] = await Promise.all([
      this.getTransactions(userId, 0, SNAPSHOT_TRANSACTION_LIMIT),
      this.loyaltyRepository.count({ where: { userId } }),
      this.countMatchesAttended(userId),
    ]);
    // The stored tier (it can be above what the points give: see loyalty-tier-keeping.ts), and the
    // tier above it, not the first threshold above the points.
    const currentTier = definitionFor(user.loyaltyTier);
    const nextTier = TIER_DEFINITIONS[tierRank(user.loyaltyTier) + 1];
    const kept =
      tierRank(tierForPoints(user.loyaltyPoints).tier) < tierRank(user.loyaltyTier) &&
      user.loyaltyTierReachedAt
        ? {
            tierKeptUntil: tierKeptUntil(user.loyaltyTierReachedAt).toISOString().slice(0, 10),
            pointsToKeepTier: Math.max(minPointsOf(user.loyaltyTier) - user.loyaltyPoints, 0),
          }
        : {};
    return {
      userId,
      points: user.loyaltyPoints,
      tier: currentTier,
      nextTier,
      pointsToNextTier: nextTier ? Math.max(nextTier.minPoints - user.loyaltyPoints, 0) : undefined,
      ...kept,
      earning: {
        registrationPoints: this.config.registrationPoints,
        profileCompletionPoints: this.config.profileCompletionPoints,
        attendancePoints: this.config.attendancePoints,
        seasonPassPoints: this.config.seasonPassPoints,
        passLoanPoints: this.config.passLoanPoints,
        carryoverPercent: this.config.carryoverPercent,
        discountTicketLimit: this.config.discountTicketLimit,
      },
      matchesAttended,
      totalTransactions,
      recentTransactions,
    };
  }

  /** Newest first. `id` breaks ties so paging is stable for rows created in the same second. */
  async getTransactions(
    userId: string,
    offset: number,
    limit: number,
  ): Promise<LoyaltyTransaction[]> {
    return this.loyaltyRepository.find({
      where: { userId },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: offset,
      take: limit,
    });
  }

  /**
   * The match each ledger row belongs to, for showing the row in plain words (the internal source
   * and reference are never shown): attendance rows carry it in their reference, an old ticket
   * purchase or pass entry points at a ticket, a loan at the loan.
   */
  async matchesFor(rows: readonly LoyaltyTransaction[]): Promise<Map<string, TransactionMatch>> {
    const matchOfRow = new Map<string, string>();
    const ticketRefs = new Map<string, string[]>();
    const loanRefs = new Map<string, string[]>();
    const push = (map: Map<string, string[]>, id: string, rowId: string): void => {
      map.set(id, [...(map.get(id) ?? []), rowId]);
    };
    for (const row of rows) {
      const ref = row.referenceId ?? '';
      if (row.source === LoyaltyTransactionSource.ATTENDANCE && ref.startsWith('match:')) {
        matchOfRow.set(row.id, ref.split(':')[1]);
      } else if (ref.startsWith('ticket:')) {
        push(ticketRefs, ref.slice('ticket:'.length), row.id);
      } else if (row.source === LoyaltyTransactionSource.PASS_LOAN && ref.startsWith('loan:')) {
        push(loanRefs, ref.slice('loan:'.length), row.id);
      }
    }
    if (ticketRefs.size > 0) {
      const tickets = await this.dataSource.getRepository(Ticket).find({
        where: { id: In([...ticketRefs.keys()]) },
        select: ['id', 'matchId'],
      });
      for (const t of tickets)
        for (const rowId of ticketRefs.get(t.id) ?? []) matchOfRow.set(rowId, t.matchId);
    }
    if (loanRefs.size > 0) {
      const loans = await this.dataSource.getRepository(PassLoan).find({
        where: { id: In([...loanRefs.keys()]) },
        select: ['id', 'matchId'],
      });
      for (const l of loans)
        for (const rowId of loanRefs.get(l.id) ?? []) matchOfRow.set(rowId, l.matchId);
    }
    const ids = [...new Set(matchOfRow.values())];
    const out = new Map<string, TransactionMatch>();
    if (ids.length === 0) return out;
    const matches = await this.dataSource.getRepository(Match).find({
      where: { id: In(ids) },
      select: ['id', 'homeTeam', 'awayTeam', 'kickoffAt'],
    });
    const byId = new Map(matches.map((m) => [m.id, m]));
    for (const [rowId, matchId] of matchOfRow) {
      const m = byId.get(matchId);
      if (m) {
        out.set(rowId, {
          id: m.id,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          kickoffAt: m.kickoffAt.toISOString(),
        });
      }
    }
    return out;
  }

  /** Distinct matches for which one of the user's tickets was scanned at the gate. */
  private async countMatchesAttended(userId: string): Promise<number> {
    const row = await this.dataSource
      .getRepository(Ticket)
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t.match_id)', 'count')
      .where('t.user_id = :userId', { userId })
      .andWhere('t.scanned_at IS NOT NULL')
      .getRawOne<{ count: string }>();
    return Number(row?.count ?? 0);
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

    // An award raises the tier when the points reach a higher one, and never lowers it: only the
    // season-end conversion can, and a tier reached in a season is kept (loyalty-tier-keeping.ts).
    const after = tierAfterAward(
      { tier: user.loyaltyTier, reachedAt: user.loyaltyTierReachedAt ?? null },
      newBalance,
      new Date(),
    );
    const newTierDefinition = definitionFor(after.tier);
    user.loyaltyPoints = newBalance;
    user.loyaltyTier = after.tier;
    user.loyaltyTierReachedAt = after.reachedAt;
    await userRepo.save(user);

    const tierUpgraded = after.upgraded;

    if (tierUpgraded) {
      const nextTierDefinition = TIER_DEFINITIONS[tierRank(after.tier) + 1];
      // Fire-and-forget tier upgrade email. Never block the caller on SMTP.
      void this.emailService
        .send({
          to: user.email,
          subject: `Új hűségszinted: ${newTierDefinition.label} — ${newTierDefinition.discountPercent}% kedvezmény a jegyekből`,
          template: 'tier-upgraded',
          context: {
            recipientName: user.firstName,
            newTierLabel: newTierDefinition.label,
            newDiscountPercent: newTierDefinition.discountPercent,
            pointsBalance: newBalance,
            nextTierLabel: nextTierDefinition?.label,
            pointsToNextTier: nextTierDefinition
              ? Math.max(nextTierDefinition.minPoints - newBalance, 0)
              : undefined,
            attendancePoints: this.config.attendancePoints,
            carryoverPercent: this.config.carryoverPercent,
            discountTicketLimit: this.config.discountTicketLimit,
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
