import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WaitlistConfig } from '../../../config';
import { WaitlistService } from '../waitlist.service';
import { WaitlistNotificationService } from '../waitlist-notification.service';

/**
 * Reaps notified-but-unclaimed waitlist entries every minute and cascades to
 * the next person in line. The Redis claim key (TTL) is the source of truth
 * for "is the slot still valid?", and this cron only flips the DB row to
 * EXPIRED when the Redis key is gone.
 */
@Injectable()
export class WaitlistExpireJob {
  private readonly logger = new Logger(WaitlistExpireJob.name);
  private readonly claimTtlSeconds: number;
  private running = false;

  constructor(
    configService: ConfigService,
    private readonly waitlistService: WaitlistService,
    private readonly notificationService: WaitlistNotificationService,
  ) {
    const config = configService.getOrThrow<WaitlistConfig>('waitlist');
    this.claimTtlSeconds = config.claimTtlSeconds;
  }

  @Cron(CronExpression.EVERY_MINUTE, {
    name: 'waitlist-expire',
    timeZone: 'Europe/Budapest',
  })
  async handle(): Promise<void> {
    if (this.running) {
      this.logger.warn('waitlist-expire cron skipped (previous run still in flight)');
      return;
    }
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - this.claimTtlSeconds * 1000);
      const expired = await this.waitlistService.findExpiredNotifications(cutoff);
      if (expired.length === 0) {
        return;
      }
      this.logger.log(`Reaping ${expired.length} expired waitlist notifications`);
      for (const entry of expired) {
        try {
          await this.notificationService.expireNotification(entry);
        } catch (error) {
          this.logger.error(`Failed to expire entry ${entry.id}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
