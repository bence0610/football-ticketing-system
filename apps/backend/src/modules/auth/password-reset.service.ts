import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcrypt';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { DataSource, IsNull, Repository } from 'typeorm';
import { CronConfig, JwtConfig, MailConfig } from '../../config';
import { SlidingWindowLimiter } from '../../common/rate-limit/sliding-window.limiter';
import { PasswordResetToken, User } from '../../database/entities';
import { EmailService } from '../email/email.service';
import { ClientInfo, describeClient } from './client-info';
import { RefreshTokenStore } from './refresh-token.store';

/** At most this many reset emails per address per hour - counted whether or not the address has an account. */
const MAX_REQUESTS_PER_ADDRESS = 3;
const ADDRESS_WINDOW_SECONDS = 3600;

export const RESET_REQUESTED_MESSAGE_PREFIX =
  'Ha ez az e-mail-cím regisztrálva van, elküldtük a jelszó-visszaállító linket.';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * Password reset, built the way pass invitations are: a long random token
 * (nanoid(48)) goes out in an emailed link, and the link is single use and
 * expires. Differences, on purpose: only the token's hash is stored, and the
 * link lives an hour, not 72.
 *
 * Why an hour: an invitation only offers a seat for one match and its holder
 * may not read mail for days, so it lives 72 hours. A reset link is a key to the
 * whole account and is normally used within minutes of being requested; a short
 * life limits how long a link sitting in a mailbox (a shared computer, a mailbox
 * that is breached later) is worth anything. The TTL is configurable
 * (PASSWORD_RESET_TTL_MINUTES).
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly jwtConfig: JwtConfig;
  private readonly mailConfig: MailConfig;
  private readonly timezone: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(PasswordResetToken) private readonly tokens: Repository<PasswordResetToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly refreshStore: RefreshTokenStore,
    private readonly limiter: SlidingWindowLimiter,
  ) {
    this.jwtConfig = configService.getOrThrow<JwtConfig>('jwt');
    this.mailConfig = configService.getOrThrow<MailConfig>('mail');
    this.timezone = configService.getOrThrow<CronConfig>('cron').timezone;
  }

  /** What the request endpoint always answers - identical for every address. */
  requestedMessage(): string {
    return `${RESET_REQUESTED_MESSAGE_PREFIX} A link ${this.validForLabel()} múlva lejár.`;
  }

  /**
   * Asks for a reset link. Never reveals whether the address has an account:
   * it returns the same way for a registered address, an unknown one, an
   * inactive account and a throttled address. Everything that differs between
   * them (creating the token, sending the mail) happens after the answer is
   * decided, in the background, so the response does not differ in timing
   * either.
   */
  async requestReset(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    // Counts every request for this address, registered or not, so being
    // throttled says nothing about whether an account exists.
    const withinLimit = await this.limiter.hit(
      'pwreset:address',
      sha256(email),
      MAX_REQUESTS_PER_ADDRESS,
      ADDRESS_WINDOW_SECONDS,
    );
    const user = await this.users.findOne({ where: { email } });
    if (!withinLimit || !user || !user.isActive) {
      return;
    }
    void this.issueAndSend(user).catch((error: Error) => {
      this.logger.error(`Password reset mail failed for user=${user.id}: ${error.message}`);
    });
  }

  /** Creates the token (hash only), retires older ones, and mails the link. */
  async issueAndSend(user: User): Promise<void> {
    const token = nanoid(48);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.jwtConfig.passwordResetTtlMinutes * 60_000);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PasswordResetToken);
      // Only the newest link works: asking again retires the earlier ones.
      await repo.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
      await repo.save(
        repo.create({
          userId: user.id,
          tokenHash: sha256(token),
          passwordFingerprint: sha256(user.passwordHash),
          expiresAt,
        }),
      );
    });

    await this.emailService.send({
      to: user.email,
      subject: 'Jelszó-visszaállítás - KTE Jegyportál',
      template: 'password-reset',
      context: {
        recipientName: user.firstName,
        resetUrl: `${this.mailConfig.baseUrl}/reset-password/${encodeURIComponent(token)}`,
        validForLabel: this.validForLabel(),
      },
      correlationId: `password-reset:${user.id}:${now.getTime()}`,
    });
  }

  /** Lets the page tell an expired or used link before the person types a password. */
  async checkToken(token: string): Promise<void> {
    await this.loadUsableToken(token);
  }

  /**
   * Sets the new password. The link is consumed in the same transaction as the
   * password change, and every refresh token of the account is revoked
   * afterwards, so a session someone else holds does not survive the reset.
   * (An access token already issued stays valid until it expires on its own,
   * 15 minutes by default.)
   */
  async resetPassword(token: string, newPassword: string, client?: ClientInfo): Promise<void> {
    const { row, user } = await this.loadUsableToken(token);
    const passwordHash = await hash(newPassword, this.jwtConfig.bcryptRounds);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const tokenRepo = manager.getRepository(PasswordResetToken);

      // Single use, atomically: of two requests racing on one link, one wins.
      const consumed = await tokenRepo
        .createQueryBuilder()
        .update()
        .set({ usedAt: now })
        .where('id = :id AND used_at IS NULL AND expires_at > :now', { id: row.id, now })
        .execute();
      if (consumed.affected !== 1) {
        throw this.usedError();
      }

      // Compare-and-swap on the password hash we checked the fingerprint against:
      // if the password changed since, nothing is overwritten.
      const changed = await manager
        .getRepository(User)
        .createQueryBuilder()
        .update()
        .set({ passwordHash })
        .where('id = :id AND password_hash = :current', {
          id: user.id,
          current: user.passwordHash,
        })
        .execute();
      if (changed.affected !== 1) {
        throw this.passwordChangedError();
      }

      // The account's other outstanding links are void now.
      await tokenRepo.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
    });

    await this.refreshStore.revokeAll(user.id);
    this.logger.log(`Password reset completed for user=${user.id}`);

    // The account's owner must learn of this - it is how a hijacked account gets
    // noticed. A mail that cannot be sent is logged loudly but does not undo the
    // reset: the password has already changed and the sessions are already gone.
    void this.notifyPasswordChanged(user, now, client).catch((error: Error) => {
      this.logger.error(
        `Password-changed notification FAILED for user=${user.id}: ${error.message}`,
      );
    });
  }

  /**
   * Tells the owner their password changed: when, and roughly from where. It never
   * carries the new password or any token.
   */
  async notifyPasswordChanged(user: User, when: Date, client?: ClientInfo): Promise<void> {
    await this.emailService.send({
      to: user.email,
      subject: 'A jelszavad megváltozott - KTE Jegyportál',
      template: 'password-changed',
      context: {
        recipientName: user.firstName,
        changedAtLabel: this.formatWhen(when),
        clientLabel: describeClient(client),
        supportEmail: this.mailConfig.supportEmail,
      },
      correlationId: `password-changed:${user.id}:${when.getTime()}`,
    });
  }

  private formatWhen(when: Date): string {
    return new Intl.DateTimeFormat('hu-HU', {
      timeZone: this.timezone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(when);
  }

  private async loadUsableToken(token: string): Promise<{ row: PasswordResetToken; user: User }> {
    const row = await this.tokens.findOne({ where: { tokenHash: sha256(token.trim()) } });
    if (!row) {
      throw this.invalidError();
    }
    if (row.usedAt) {
      throw this.usedError();
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw this.expiredError();
    }
    const user = await this.users.findOne({ where: { id: row.userId } });
    if (!user || !user.isActive) {
      throw this.invalidError();
    }
    if (sha256(user.passwordHash) !== row.passwordFingerprint) {
      throw this.passwordChangedError();
    }
    return { row, user };
  }

  private validForLabel(): string {
    const minutes = this.jwtConfig.passwordResetTtlMinutes;
    if (minutes % 60 === 0) {
      return `${minutes / 60} óra`;
    }
    return `${minutes} perc`;
  }

  private invalidError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message: 'Ez a visszaállító link érvénytelen. Kérj új linket.',
      code: 'reset_token_invalid',
    });
  }

  private expiredError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message: 'A visszaállító link lejárt. Kérj új linket.',
      code: 'reset_token_expired',
    });
  }

  private usedError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message:
        'Ezt a visszaállító linket már felhasználták, vagy közben újat kértél. Kérj új linket, ha még szükséged van rá.',
      code: 'reset_token_used',
    });
  }

  private passwordChangedError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message:
        'A jelszavad azóta megváltozott, ezért ez a link már nem használható. Kérj új linket, ha még szükséged van rá.',
      code: 'reset_token_used',
    });
  }
}
