import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, LessThan, Not, Repository } from 'typeorm';
import { CronConfig } from '../../../config';
import { Match, MatchStatus, Ticket, TicketStatus } from '../../../database/entities';
import { QrService } from '../../qr/qr.service';

/**
 * Expires unscanned PAID tickets after match kickoff. Runs once a day at the
 * configured cron expression. Tickets in EXPIRED state are also persisted so
 * the user-facing dashboard renders the right status badge.
 */
@Injectable()
export class ExpireTicketsJob {
  private readonly logger = new Logger(ExpireTicketsJob.name);
  private readonly cronConfig: CronConfig;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly qrService: QrService,
  ) {
    this.cronConfig = this.configService.getOrThrow<CronConfig>('cron');
    this.registerDynamicCron();
  }

  async run(): Promise<void> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    this.logger.log(`Expiring unused tickets for matches finished before ${dayAgo.toISOString()}`);

    const matches = await this.dataSource.getRepository(Match).find({
      where: [
        {
          kickoffAt: LessThan(dayAgo),
          status: Not(In([MatchStatus.SCHEDULED, MatchStatus.ON_SALE])),
        },
      ],
    });
    if (matches.length === 0) {
      this.logger.log('No finished matches found requiring expiry sweep.');
      return;
    }

    let expiredTickets = 0;
    for (const match of matches) {
      const tickets = await this.ticketRepository.find({
        where: { matchId: match.id, status: TicketStatus.PAID },
      });
      for (const ticket of tickets) {
        ticket.status = TicketStatus.EXPIRED;
        ticket.expiredAt = now;
        await this.ticketRepository.save(ticket);
        if (ticket.qrJti) {
          await this.qrService.revoke(ticket.qrJti);
        }
        expiredTickets += 1;
      }
    }
    this.logger.log(`ExpireTicketsJob finished. expired=${expiredTickets}`);
  }

  private registerDynamicCron(): void {
    const job = new CronJob(
      this.cronConfig.ticketExpireExpression,
      () => {
        this.run().catch((error: Error) => {
          this.logger.error(`Ticket expiry sweep failed: ${error.message}`, error.stack);
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
        'ticketExpireSweep',
        job as unknown as Parameters<SchedulerRegistry['addCronJob']>[1],
      );
      job.start();
      this.logger.log(
        `ExpireTicketsJob registered cron="${this.cronConfig.ticketExpireExpression}" tz="${this.cronConfig.timezone}"`,
      );
    } catch (error) {
      this.logger.warn(
        `Could not register dynamic ticket-expire cron: ${(error as Error).message}`,
      );
    }
  }
}
