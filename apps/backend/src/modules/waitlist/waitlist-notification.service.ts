import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { MailConfig, WaitlistConfig } from '../../config';
import { Waitlist, WaitlistStatus } from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { EmailService } from '../email/email.service';
import { WaitlistService } from './waitlist.service';

const NOTIFICATION_LOCK_TTL_SECONDS = 5;

export interface ClaimSlotInfo {
  matchId: string;
  userId: string;
  expiresAt: Date;
  waitlistEntryId: string;
}

@Injectable()
export class WaitlistNotificationService {
  private readonly logger = new Logger(WaitlistNotificationService.name);
  private readonly waitlistConfig: WaitlistConfig;
  private readonly mailConfig: MailConfig;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly configService: ConfigService,
    private readonly waitlistService: WaitlistService,
    private readonly emailService: EmailService,
  ) {
    this.waitlistConfig = this.configService.getOrThrow<WaitlistConfig>('waitlist');
    this.mailConfig = this.configService.getOrThrow<MailConfig>('mail');
  }

  /**
   * Notifies the next waitlist entry that a seat became available on the
   * given match. The entire flow is protected by a Redis SETNX lock so two
   * concurrent triggers (e.g. cancel + cron) cannot promote the same slot
   * to two different users.
   */
  async notifyNextInLine(matchId: string): Promise<ClaimSlotInfo | null> {
    const lockKey = RedisKeys.waitlistNotificationLock(matchId);
    const lockAcquired = await this.redis.set(
      lockKey,
      '1',
      'EX',
      NOTIFICATION_LOCK_TTL_SECONDS,
      'NX',
    );
    if (lockAcquired !== 'OK') {
      this.logger.debug(`Notification lock busy for match ${matchId}; skipping.`);
      return null;
    }

    try {
      // Don't promote anyone if no seats are actually free.
      const free = await this.waitlistService.hasAvailability(matchId);
      if (!free) {
        return null;
      }

      const next = await this.waitlistService.findNextActive(matchId);
      if (!next) {
        return null;
      }

      const claimKey = RedisKeys.waitlistClaim(matchId, next.userId);
      const ttl = this.waitlistConfig.claimTtlSeconds;
      const claimSet = await this.redis.set(claimKey, next.id, 'EX', ttl, 'NX');
      if (claimSet !== 'OK') {
        // Another process beat us to it for the same user; abort silently.
        this.logger.debug(`Claim slot already held for user ${next.userId} on match ${matchId}.`);
        return null;
      }

      const notifiedAt = new Date();
      await this.waitlistService.updateStatus(next.id, WaitlistStatus.NOTIFIED, notifiedAt);

      // Best-effort email — failures are logged but don't throw, so the
      // claim slot is still valid. The user can also see the notification
      // via the profile-page polling loop.
      try {
        await this.sendNotificationEmail(next, notifiedAt, ttl);
      } catch (error) {
        this.logger.error(
          `Waitlist email failed for entry ${next.id}: ${(error as Error).message}`,
        );
      }

      const expiresAt = new Date(notifiedAt.getTime() + ttl * 1000);
      this.logger.log(
        `Notified user ${next.userId} for match ${matchId} (claim TTL ${ttl}s, entry ${next.id})`,
      );
      return { matchId, userId: next.userId, expiresAt, waitlistEntryId: next.id };
    } finally {
      // Best-effort release; if the lock TTL already expired, the DEL is harmless.
      await this.redis.del(lockKey).catch(() => undefined);
    }
  }

  /**
   * Confirms that the user wants the offered seat — converts the entry and
   * clears the Redis claim slot. Called from the controller when the fan
   * clicks "Megerősítés". The actual purchase still happens via the normal
   * checkout flow; this just marks the waitlist entry as CONVERTED so the
   * cron does not re-trigger expiration.
   */
  async claimReservation(userId: string, matchId: string): Promise<void> {
    const claimKey = RedisKeys.waitlistClaim(matchId, userId);
    const exists = await this.redis.get(claimKey);
    if (!exists) {
      throw new ConflictException('A foglalási lehetőség lejárt vagy már nem elérhető.');
    }
    const entry = await this.waitlistService.findUserEntry(userId, matchId);
    if (!entry) {
      throw new NotFoundException('Várólista bejegyzés nem található.');
    }
    if (entry.status !== WaitlistStatus.NOTIFIED) {
      throw new ConflictException('A várólista bejegyzés nincs értesített állapotban.');
    }
    await this.waitlistService.updateStatus(entry.id, WaitlistStatus.CONVERTED);
    await this.redis.del(claimKey);
    this.logger.log(`User ${userId} claimed waitlist slot for match ${matchId}`);
  }

  /**
   * Marks a notified-but-unclaimed entry as EXPIRED and triggers the next
   * notification. Called by the cron job for entries whose Redis claim TTL
   * expired without action.
   */
  async expireNotification(entry: Waitlist): Promise<void> {
    if (entry.status !== WaitlistStatus.NOTIFIED) {
      return;
    }
    const claimKey = RedisKeys.waitlistClaim(entry.matchId, entry.userId);
    const stillHeld = await this.redis.exists(claimKey);
    if (stillHeld) {
      // The slot is still within the TTL window — cron is too eager; skip.
      return;
    }
    await this.waitlistService.updateStatus(entry.id, WaitlistStatus.EXPIRED);
    this.logger.log(
      `Expired waitlist entry ${entry.id} (user ${entry.userId} match ${entry.matchId})`,
    );
    // Cascade: try to notify the next person in line.
    await this.notifyNextInLine(entry.matchId).catch((error: unknown) => {
      this.logger.error(
        `Cascade notifyNextInLine failed for match ${entry.matchId}: ${(error as Error).message}`,
      );
    });
  }

  private async sendNotificationEmail(
    entry: Waitlist,
    notifiedAt: Date,
    ttlSeconds: number,
  ): Promise<void> {
    if (!entry.user || !entry.match) {
      throw new Error('User or match relation missing on waitlist entry');
    }
    const expiresAt = new Date(notifiedAt.getTime() + ttlSeconds * 1000);
    const expiresLabel = formatHungarian(expiresAt);
    const matchKickoffLabel = formatHungarian(entry.match.kickoffAt);
    const matchTitle = `${entry.match.homeTeam} – ${entry.match.awayTeam}`;
    const minutes = Math.round(ttlSeconds / 60);
    await this.emailService.send({
      to: entry.user.email,
      subject: `Felszabadult egy hely - ${matchTitle}`,
      template: 'waitlist-notification',
      context: {
        recipientName: entry.user.firstName,
        matchTitle,
        matchVenue: entry.match.venue,
        matchKickoffLabel,
        windowMinutes: minutes,
        expiresAtLabel: expiresLabel,
        confirmUrl: `${this.mailConfig.baseUrl}/profile?waitlistMatchId=${entry.matchId}`,
      },
      correlationId: `waitlist-notification:${entry.id}:${notifiedAt.getTime()}`,
    });
  }
}

function formatHungarian(date: Date): string {
  return new Intl.DateTimeFormat('hu-HU', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Budapest',
  }).format(date);
}
