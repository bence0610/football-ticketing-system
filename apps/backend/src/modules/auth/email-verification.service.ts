import { BadRequestException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { DataSource, IsNull, Repository } from 'typeorm';
import { JwtConfig, MailConfig } from '../../config';
import { SlidingWindowLimiter } from '../../common/rate-limit/sliding-window.limiter';
import { EmailVerificationToken, User } from '../../database/entities';
import { EmailService } from '../email/email.service';

/** At most this many verification mails per account per hour (the registration mail counts). */
const MAX_MAILS_PER_ACCOUNT = 4;
const ACCOUNT_WINDOW_SECONDS = 3600;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * E-mail verification at registration, built on the one-time token mechanism of the password
 * reset: a long random token (nanoid(48)) goes out in an emailed link, only its hash is stored,
 * and the link is single use and expires (EMAIL_VERIFICATION_TTL_HOURS, default 48 h: unlike a
 * reset link it opens nothing by itself, a registrant may read their mail the next day).
 *
 * What an unverified address may not do is enforced where it matters (SeasonPassesService): it
 * sees no incoming loan invitations, cannot accept one, and cannot be named as a pass holder.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly jwtConfig: JwtConfig;
  private readonly mailConfig: MailConfig;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(EmailVerificationToken)
    private readonly tokens: Repository<EmailVerificationToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly limiter: SlidingWindowLimiter,
  ) {
    this.jwtConfig = configService.getOrThrow<JwtConfig>('jwt');
    this.mailConfig = configService.getOrThrow<MailConfig>('mail');
  }

  /** Creates the token (hash only), retires older ones, and mails the link. */
  async issueAndSend(user: User): Promise<void> {
    const token = nanoid(48);
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.jwtConfig.emailVerificationTtlHours * 3_600_000,
    );
    const email = user.email.toLowerCase();

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(EmailVerificationToken);
      // Only the newest link works: asking again retires the earlier ones.
      await repo.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
      await repo.save(repo.create({ userId: user.id, tokenHash: sha256(token), email, expiresAt }));
    });

    await this.emailService.send({
      to: user.email,
      subject: 'Erősítsd meg az e-mail-címed - KTE Jegyportál',
      template: 'email-verification',
      context: {
        recipientName: user.firstName,
        verifyUrl: `${this.mailConfig.baseUrl}/verify-email/${encodeURIComponent(token)}`,
        validForLabel: this.validForLabel(),
      },
      correlationId: `email-verification:${user.id}:${now.getTime()}`,
    });
  }

  /**
   * The mail sent at registration. A failed mail never fails the registration: the person can ask
   * for another one from their profile.
   */
  sendAtRegistration(user: User): void {
    void this.limiter
      .hit('emailverify:account', user.id, MAX_MAILS_PER_ACCOUNT, ACCOUNT_WINDOW_SECONDS)
      .then(() => this.issueAndSend(user))
      .catch((error: Error) => {
        this.logger.error(`Verification mail failed for user=${user.id}: ${error.message}`);
      });
  }

  /** Sends a fresh link to a signed-in, still unverified account. */
  async resend(userId: string): Promise<{ alreadyVerified: boolean }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw this.invalidError();
    }
    if (user.emailVerified) {
      return { alreadyVerified: true };
    }
    const within = await this.limiter.hit(
      'emailverify:account',
      user.id,
      MAX_MAILS_PER_ACCOUNT,
      ACCOUNT_WINDOW_SECONDS,
    );
    if (!within) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Ma már többször küldtünk megerősítő levelet. Nézd meg a postafiókod és a spamet.',
          code: 'rate_limited',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.issueAndSend(user);
    return { alreadyVerified: false };
  }

  /**
   * Marks the address verified. The link is consumed in the same transaction as the change, and
   * only if the account still has the address the link was sent to.
   */
  async confirm(token: string): Promise<{ email: string }> {
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
    if (!user || !user.isActive || user.email.toLowerCase() !== row.email) {
      throw this.invalidError();
    }

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      const consumed = await manager
        .getRepository(EmailVerificationToken)
        .createQueryBuilder()
        .update()
        .set({ usedAt: now })
        .where('id = :id AND used_at IS NULL AND expires_at > :now', { id: row.id, now })
        .execute();
      if (consumed.affected !== 1) {
        throw this.usedError();
      }
      await manager
        .getRepository(User)
        .update({ id: user.id, email: user.email }, { emailVerified: true });
      await manager
        .getRepository(EmailVerificationToken)
        .update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
    });
    this.logger.log(`E-mail verified for user=${user.id}`);
    return { email: user.email };
  }

  private validForLabel(): string {
    const hours = this.jwtConfig.emailVerificationTtlHours;
    return hours % 24 === 0 ? `${hours / 24} nap` : `${hours} óra`;
  }

  private invalidError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message: 'Ez a megerősítő link érvénytelen. Kérj újat a profilod oldalán.',
      code: 'verification_token_invalid',
    });
  }

  private expiredError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message: 'A megerősítő link lejárt. Kérj újat a profilod oldalán.',
      code: 'verification_token_expired',
    });
  }

  private usedError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message:
        'Ezt a megerősítő linket már felhasználták, vagy közben újat kértél. Kérj újat a profilod oldalán, ha még szükséged van rá.',
      code: 'verification_token_used',
    });
  }
}
