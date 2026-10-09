import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, LessThan } from 'typeorm';
import { CronConfig } from '../../../config';
import { Match, PassLoan, PassLoanStatus } from '../../../database/entities';
import { SeasonPassesService } from '../season-passes.service';

/**
 * Hourly sweeper that:
 *   - Marks expired pending invitations as EXPIRED.
 *   - Marks accepted loans whose match has finished as COMPLETED (and
 *     awards loyalty points to the lender via SeasonPassesService).
 */
@Injectable()
export class LoanReleaseJob {
  private readonly logger = new Logger(LoanReleaseJob.name);
  private readonly cronConfig: CronConfig;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly seasonPassesService: SeasonPassesService,
  ) {
    this.cronConfig = this.configService.getOrThrow<CronConfig>('cron');
    this.registerCron();
  }

  async run(): Promise<void> {
    const now = new Date();
    const completionGrace = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    // 1) expire pending invitations
    const expiredCount = await this.dataSource
      .getRepository(PassLoan)
      .update(
        { status: PassLoanStatus.PENDING, expiresAt: LessThan(now) },
        { status: PassLoanStatus.EXPIRED },
      );
    if (expiredCount.affected) {
      this.logger.log(`Pending loan invitations expired: ${expiredCount.affected}`);
    }

    // 2) complete accepted loans whose match kickoff was >4h ago
    const finishedMatches = await this.dataSource.getRepository(Match).find({
      where: { kickoffAt: LessThan(completionGrace) },
    });
    if (finishedMatches.length === 0) {
      return;
    }
    const accepted = await this.dataSource.getRepository(PassLoan).find({
      where: {
        status: PassLoanStatus.ACCEPTED,
        matchId: In(finishedMatches.map((m) => m.id)),
      },
      relations: ['lender'],
    });
    for (const loan of accepted) {
      try {
        await this.seasonPassesService.completeLoan(loan);
      } catch (error) {
        this.logger.error(`Failed to complete loan=${loan.id}: ${(error as Error).message}`);
      }
    }
    if (accepted.length > 0) {
      this.logger.log(`Loans completed by hourly sweep: ${accepted.length}`);
    }
  }

  private registerCron(): void {
    const job = new CronJob(
      this.cronConfig.loanReleaseExpression,
      () => {
        this.run().catch((error: Error) => {
          this.logger.error(`Loan release sweep failed: ${error.message}`, error.stack);
        });
      },
      null,
      false,
      this.cronConfig.timezone,
    );
    try {
      // Cast: @nestjs/schedule pins its own cron version which differs from the
      // workspace's cron — runtime-compatible, but TS types diverge.
      this.schedulerRegistry.addCronJob(
        'loanReleaseSweep',
        job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
      );
      job.start();
      this.logger.log(
        `LoanReleaseJob registered cron="${this.cronConfig.loanReleaseExpression}" tz="${this.cronConfig.timezone}"`,
      );
    } catch (error) {
      this.logger.warn(`Could not register loan-release cron: ${(error as Error).message}`);
    }
  }
}
