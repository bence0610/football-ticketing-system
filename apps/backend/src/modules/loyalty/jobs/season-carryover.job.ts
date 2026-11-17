import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LoyaltyConfig } from '../../../config';
import {
  LoyaltyTier,
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  User,
} from '../../../database/entities';
import { LoyaltyService } from '../loyalty.service';
import { tierForPoints } from '../loyalty.constants';
import { tierAtSeasonEnd, tierRank } from '../loyalty-tier-keeping';

/**
 * Runs once a year on June 30 at 03:00 Europe/Budapest. For every user, the
 * outstanding points balance is reduced to LOYALTY_CARRYOVER_PERCENT% (the
 * remainder is logged as an EXPIRY transaction so the audit trail stays clean).
 *
 * The tier is decided in the same database transaction, by `tierAtSeasonEnd`: a tier reached (or
 * earned again) during the season that is ending is kept through the next season even when the
 * points fall below its threshold; one whose protection is used up falls to what the points give.
 */
@Injectable()
export class SeasonCarryoverJob {
  private readonly logger = new Logger(SeasonCarryoverJob.name);
  private readonly loyaltyConfig: LoyaltyConfig;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly loyaltyService: LoyaltyService,
  ) {
    this.loyaltyConfig = this.configService.getOrThrow<LoyaltyConfig>('loyalty');
  }

  @Cron('0 3 30 6 *', { timeZone: 'Europe/Budapest', name: 'loyaltySeasonCarryover' })
  async run(): Promise<void> {
    const carryoverPercent = this.loyaltyConfig.carryoverPercent;
    const at = new Date();
    const seasonStamp = at.toISOString().slice(0, 10);
    this.logger.log(`Season-end carryover starting (carryover=${carryoverPercent}%)`);

    const userRepo = this.dataSource.getRepository(User);
    const users = await userRepo.find({ where: { isActive: true } });

    let processed = 0;
    let skipped = 0;
    for (const user of users) {
      try {
        if (await this.convert(user, carryoverPercent, seasonStamp, at)) {
          processed += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        this.logger.error(`Carryover failed for user ${user.id}: ${(error as Error).message}`);
      }
    }
    this.logger.log(`Season-end carryover finished. processed=${processed} skipped=${skipped}`);

    // Sanity: the stored tier may be above what the points give (a kept tier) but never below it.
    const drift = await userRepo.find({ where: { isActive: true } });
    for (const user of drift) {
      const derived = tierForPoints(user.loyaltyPoints).tier;
      if (tierRank(derived) > tierRank(user.loyaltyTier)) {
        await userRepo.update({ id: user.id }, { loyaltyTier: derived, loyaltyTierReachedAt: at });
      }
    }
  }

  /**
   * One user's conversion: the points, then the tier, in one transaction. Returns false when there
   * was nothing to do. A second run on the same day is a no-op (the ledger reference is the same),
   * and must not decide the tier again from the already reduced balance.
   */
  private async convert(
    user: User,
    carryoverPercent: number,
    seasonStamp: string,
    at: Date,
  ): Promise<boolean> {
    const pointsBefore = user.loyaltyPoints;
    const expiring = Math.floor((pointsBefore * (100 - carryoverPercent)) / 100);
    if (pointsBefore <= 0 && user.loyaltyTier === LoyaltyTier.BRONZE) {
      return false;
    }
    return this.dataSource.transaction(async (manager) => {
      let pointsAfter = pointsBefore;
      if (expiring > 0) {
        const result = await this.loyaltyService.award({
          userId: user.id,
          type: LoyaltyTransactionType.EXPIRY,
          source: LoyaltyTransactionSource.SEASON_CARRYOVER,
          points: -expiring,
          referenceId: `season:${seasonStamp}:${user.id}`,
          description: `Szezonzáró pontkonverzió (${carryoverPercent}% megtartva)`,
          manager,
        });
        if (result.duplicate) {
          return false;
        }
        pointsAfter = result.newBalance;
      }
      const fresh = await manager.getRepository(User).findOneOrFail({ where: { id: user.id } });
      const decided = tierAtSeasonEnd({
        tier: fresh.loyaltyTier,
        reachedAt: fresh.loyaltyTierReachedAt ?? null,
        pointsBefore,
        pointsAfter,
        year: at.getUTCFullYear(),
        at,
      });
      if (
        decided.tier !== fresh.loyaltyTier ||
        decided.reachedAt?.getTime() !== fresh.loyaltyTierReachedAt?.getTime()
      ) {
        await manager
          .getRepository(User)
          .update(
            { id: user.id },
            { loyaltyTier: decided.tier, loyaltyTierReachedAt: decided.reachedAt },
          );
      }
      return expiring > 0;
    });
  }
}
