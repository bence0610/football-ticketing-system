import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { CronConfig } from '../../../config';
import { Match, MatchStatus } from '../../../database/entities';

const HOUR_MS = 3_600_000;

/** The statuses a match holds before it is played. Cancelled and postponed matches are left as they are. */
export const PRE_MATCH_STATUSES: readonly MatchStatus[] = [
  MatchStatus.SCHEDULED,
  MatchStatus.ON_SALE,
  MatchStatus.SOLD_OUT,
];

/**
 * Marks a match FINISHED a few hours after its kickoff. Nothing else in the application ever
 * writes that status, so without this a match stayed `on_sale` for ever.
 *
 * The delay (MATCH_FINISH_DELAY_HOURS, default 6) is longer than the gate's "current match"
 * window (4 hours after kickoff), so a match is never taken off the gate screen while it can
 * still be scanned. Everything that decides what is over by time (sales, gate entry, the
 * overview's `final`, loan completion, ticket expiry) goes by the kickoff and does not wait for
 * this job; the status is the record, not the trigger.
 */
@Injectable()
export class MatchFinishJob {
  private readonly logger = new Logger(MatchFinishJob.name);
  private readonly delayMs: number;
  private running = false;

  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    configService: ConfigService,
  ) {
    this.delayMs = configService.getOrThrow<CronConfig>('cron').matchFinishDelayHours * HOUR_MS;
  }

  @Cron('*/15 * * * *', { name: 'match-finish', timeZone: 'Europe/Budapest' })
  async handle(): Promise<void> {
    if (this.running) {
      this.logger.warn('match-finish cron skipped (previous run still in flight)');
      return;
    }
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Marking matches finished failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Returns how many matches were marked. `now` is a parameter so it can be tested. */
  async run(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.delayMs);
    const result = await this.matchRepository.update(
      { kickoffAt: LessThan(cutoff), status: In([...PRE_MATCH_STATUSES]) },
      { status: MatchStatus.FINISHED },
    );
    const marked = result.affected ?? 0;
    if (marked > 0) {
      this.logger.log(
        `Marked ${marked} match(es) finished (kickoff before ${cutoff.toISOString()})`,
      );
    }
    return marked;
  }
}
