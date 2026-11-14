import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { nanoid } from 'nanoid';
import { DataSource, In, IsNull, MoreThan, QueryFailedError, Repository } from 'typeorm';
import { CronConfig, JwtConfig, MailConfig } from '../../config';
import {
  EmailChangeToken,
  PassLoan,
  PassLoanStatus,
  PasswordResetToken,
  User,
} from '../../database/entities';
import { ClientInfo, describeClient, formatNoticeTime } from '../auth/client-info';
import { EmailService } from '../email/email.service';
import { CurrentPasswordVerifier, EMAIL_CHANGE_BUDGET, sha256 } from './current-password.verifier';
import { maskEmail } from './mask-email';

/**
 * Loan statuses whose invitation still matters to the invitee: a pending one can
 * still be accepted (acceptLoan compares the account's address with
 * `borrowerEmail`, and the incoming list finds it by that address), an accepted
 * one is not over yet and its later notices go to `borrowerEmail`. Used,
 * completed, cancelled, expired, revoked and owner-entered loans are history and
 * keep the address they were sent to.
 */
export const LIVE_LOAN_STATUSES: readonly PassLoanStatus[] = [
  PassLoanStatus.PENDING,
  PassLoanStatus.ACCEPTED,
];

export interface EmailChangeRequestResult {
  message: string;
  pendingEmail: string;
}

export interface EmailChangeConfirmResult {
  message: string;
  email: string;
}

/**
 * Changing the e-mail address: confirm before effect.
 *
 * The address on the account does NOT change when the change is asked for, only
 * once the link mailed to the NEW address is opened. The address is the login id
 * and the password-reset address: if it changed at once, a typo would lock the
 * owner out, and someone who got hold of a session (and the password) could move
 * the account to a mailbox the owner cannot read, with no way back. Asking needs
 * the current password, and the current address is told about the request
 * straight away (masked new address, no link), so the owner can react while
 * nothing has happened yet - changing the password voids the pending request
 * (password fingerprint, as for reset links).
 *
 * What the address change touches: nothing else in the system is keyed on the
 * address - tickets, season passes, loyalty, waitlist and holder links all point
 * at the user id and stay as they are. The one exception is pass-loan invitations
 * (`pass_loans.borrower_email`): live ones (LIVE_LOAN_STATUSES) are moved to the
 * new address in the same transaction, so the invitee does not lose an
 * invitation they have not accepted yet. Invitations sent earlier to the NEW
 * address (before it had an account) become this user's naturally, by address.
 *
 * Sessions are NOT revoked on confirmation: the password was required to start
 * the change and the password has not changed. Outstanding password-reset links
 * are retired, though: they were sent to the old mailbox.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);
  private readonly jwtConfig: JwtConfig;
  private readonly mailConfig: MailConfig;
  private readonly timezone: string;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(EmailChangeToken) private readonly tokens: Repository<EmailChangeToken>,
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly passwordVerifier: CurrentPasswordVerifier,
  ) {
    this.jwtConfig = configService.getOrThrow<JwtConfig>('jwt');
    this.mailConfig = configService.getOrThrow<MailConfig>('mail');
    this.timezone = configService.getOrThrow<CronConfig>('cron').timezone;
  }

  /**
   * Starts a change. Nothing on the account changes here: a token is stored
   * (hash only), the link goes to the new address and a notice to the current one.
   */
  async requestChange(
    userId: string,
    rawNewEmail: string,
    currentPassword: string,
    client?: ClientInfo,
  ): Promise<EmailChangeRequestResult> {
    const newEmail = rawNewEmail.trim().toLowerCase();
    const user = await this.passwordVerifier.verify(userId, currentPassword, EMAIL_CHANGE_BUDGET);

    if (newEmail === user.email.trim().toLowerCase()) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Ez már most is a fiókod e-mail-címe.',
        code: 'email_unchanged',
      });
    }
    // Registration reveals the same, so saying it here leaks nothing new.
    const owner = await this.users.findOne({ where: { email: newEmail } });
    if (owner) {
      throw this.takenError();
    }

    const token = nanoid(48);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.jwtConfig.emailChangeTtlMinutes * 60_000);

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(EmailChangeToken);
      // Only the newest request counts: asking again retires the earlier links.
      await repo.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
      await repo.save(
        repo.create({
          userId: user.id,
          newEmail,
          tokenHash: sha256(token),
          passwordFingerprint: sha256(user.passwordHash),
          expiresAt,
        }),
      );
    });
    this.logger.log(`E-mail change requested user=${user.id}`);

    void this.sendConfirmation(user, newEmail, token, now).catch((error: Error) => {
      this.logger.error(
        `E-mail change confirmation mail FAILED for user=${user.id}: ${error.message}`,
      );
    });
    void this.sendRequestedNotice(user, newEmail, now, client).catch((error: Error) => {
      this.logger.error(
        `E-mail change notice to the current address FAILED for user=${user.id}: ${error.message}`,
      );
    });

    return {
      message: `Elküldtük a megerősítő linket az új címre. Az e-mail-címed csak a megerősítés után változik meg; a link ${this.validForLabel()} múlva lejár.`,
      pendingEmail: newEmail,
    };
  }

  /**
   * Opens the link from the new mailbox. The token is the credential (the link
   * may well be opened in another browser, signed out).
   */
  async confirmChange(token: string, client?: ClientInfo): Promise<EmailChangeConfirmResult> {
    const { row, user } = await this.loadUsableToken(token);
    const oldEmail = user.email;
    const newEmail = row.newEmail;
    const now = new Date();

    try {
      await this.dataSource.transaction(async (manager) => {
        const tokenRepo = manager.getRepository(EmailChangeToken);
        const userRepo = manager.getRepository(User);

        // Single use, atomically: of two requests racing on one link, one wins.
        const consumed = await tokenRepo.update(
          { id: row.id, usedAt: IsNull(), expiresAt: MoreThan(now) },
          { usedAt: now },
        );
        if (consumed.affected !== 1) {
          throw this.usedError();
        }

        // The address may have been registered since the request.
        const owner = await userRepo.findOne({ where: { email: newEmail } });
        if (owner && owner.id !== user.id) {
          throw this.takenError();
        }

        // Compare-and-swap on the password hash the fingerprint was checked
        // against: if the password changed meanwhile, nothing is written.
        // The unique index on users.email is the last word on "still free".
        const changed = await userRepo.update(
          { id: user.id, passwordHash: user.passwordHash },
          { email: newEmail, emailVerified: true },
        );
        if (changed.affected !== 1) {
          throw this.passwordChangedError();
        }

        // Live pass-loan invitations follow the address (see the class comment).
        const loanRepo = manager.getRepository(PassLoan);
        const live = In([...LIVE_LOAN_STATUSES]);
        await loanRepo.update(
          { borrowerEmail: oldEmail, status: live, borrowerUserId: IsNull() },
          { borrowerEmail: newEmail },
        );
        await loanRepo.update(
          { borrowerEmail: oldEmail, status: live, borrowerUserId: user.id },
          { borrowerEmail: newEmail },
        );

        // Reset links went to the old mailbox; they must not work any more.
        await manager
          .getRepository(PasswordResetToken)
          .update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
        // Any other change request of the account is over as well.
        await tokenRepo.update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw this.takenError();
      }
      throw error;
    }

    this.logger.log(`E-mail change confirmed user=${user.id}`);

    // The old mailbox must hear of it - it is how a hijack gets noticed. A mail
    // that cannot be sent is logged loudly but does not undo the change.
    void this.sendChangedNotice(user, oldEmail, newEmail, now, client).catch((error: Error) => {
      this.logger.error(
        `E-mail changed notice to the old address FAILED for user=${user.id}: ${error.message}`,
      );
    });

    return {
      message: 'Az e-mail-címed megváltozott. Mostantól ezzel a címmel jelentkezz be.',
      email: newEmail,
    };
  }

  /**
   * The address waiting for confirmation, if there is a usable request: unused,
   * unexpired, and made with the current password (a password change voids it).
   */
  async pendingEmailFor(user: Pick<User, 'id' | 'passwordHash'>): Promise<string | undefined> {
    const row = await this.tokens.findOne({
      where: {
        userId: user.id,
        usedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
        passwordFingerprint: sha256(user.passwordHash),
      },
      order: { createdAt: 'DESC' },
    });
    return row?.newEmail;
  }

  private async loadUsableToken(token: string): Promise<{ row: EmailChangeToken; user: User }> {
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

  private async sendConfirmation(
    user: User,
    newEmail: string,
    token: string,
    when: Date,
  ): Promise<void> {
    await this.emailService.send({
      to: newEmail,
      subject: 'Erősítsd meg az új e-mail-címed - KTE Jegyportál',
      template: 'email-change-confirm',
      context: {
        recipientName: user.firstName,
        newEmail,
        confirmUrl: `${this.mailConfig.baseUrl}/confirm-email/${encodeURIComponent(token)}`,
        validForLabel: this.validForLabel(),
      },
      correlationId: `email-change-confirm:${user.id}:${when.getTime()}`,
    });
  }

  private async sendRequestedNotice(
    user: User,
    newEmail: string,
    when: Date,
    client?: ClientInfo,
  ): Promise<void> {
    await this.emailService.send({
      to: user.email,
      subject: 'E-mail-cím módosítását kérték - KTE Jegyportál',
      template: 'email-change-requested',
      context: {
        recipientName: user.firstName,
        maskedNewEmail: maskEmail(newEmail),
        requestedAtLabel: formatNoticeTime(when, this.timezone),
        clientLabel: describeClient(client),
        supportEmail: this.mailConfig.supportEmail,
      },
      correlationId: `email-change-requested:${user.id}:${when.getTime()}`,
    });
  }

  private async sendChangedNotice(
    user: User,
    oldEmail: string,
    newEmail: string,
    when: Date,
    client?: ClientInfo,
  ): Promise<void> {
    await this.emailService.send({
      to: oldEmail,
      subject: 'Az e-mail-címed megváltozott - KTE Jegyportál',
      template: 'email-changed',
      context: {
        recipientName: user.firstName,
        maskedNewEmail: maskEmail(newEmail),
        changedAtLabel: formatNoticeTime(when, this.timezone),
        clientLabel: describeClient(client),
        supportEmail: this.mailConfig.supportEmail,
      },
      correlationId: `email-changed:${user.id}:${when.getTime()}`,
    });
  }

  private validForLabel(): string {
    const minutes = this.jwtConfig.emailChangeTtlMinutes;
    if (minutes % 60 === 0) {
      return `${minutes / 60} óra`;
    }
    return `${minutes} perc`;
  }

  private takenError(): ConflictException {
    return new ConflictException({
      statusCode: 409,
      message: 'Ez az e-mail-cím már egy másik fiókhoz tartozik.',
      code: 'email_taken',
    });
  }

  private invalidError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message: 'Ez a megerősítő link érvénytelen.',
      code: 'email_change_token_invalid',
    });
  }

  private usedError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message: 'Ezt a megerősítő linket már felhasználták, vagy közben újabb címmódosítást kértél.',
      code: 'email_change_token_used',
    });
  }

  private expiredError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message: 'A megerősítő link lejárt. Kérd újra a címmódosítást a profilodban.',
      code: 'email_change_token_expired',
    });
  }

  private passwordChangedError(): BadRequestException {
    return new BadRequestException({
      statusCode: 400,
      message:
        'A jelszavad a kérés óta megváltozott, ezért ez a link már nem használható. Kérd újra a címmódosítást, ha még szükséged van rá.',
      code: 'email_change_token_password_changed',
    });
  }
}

/** MySQL duplicate-key error (the unique index on users.email). */
function isDuplicateKey(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = (
    error as QueryFailedError & { driverError?: { code?: string; errno?: number } }
  ).driverError;
  return driverError?.code === 'ER_DUP_ENTRY' || driverError?.errno === 1062;
}
