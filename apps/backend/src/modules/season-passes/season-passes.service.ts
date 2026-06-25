import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { DataSource, In, Repository } from 'typeorm';
import { nanoid } from 'nanoid';
import {
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  Match,
  PassLoan,
  PassLoanStatus,
  SeasonPass,
  SeasonPassPrice,
  SeasonPassStatus,
  User,
} from '../../database/entities';
import { CronConfig, LoyaltyConfig, MailConfig, StripeConfig } from '../../config';
import { EmailService } from '../email/email.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { QrService } from '../qr/qr.service';
import { STRIPE_CLIENT } from '../payments/stripe.provider';
import { TicketRendererService } from '../tickets/ticket-renderer.service';
import { CancelLoanDto, CreateLoanDto } from './dto/create-loan.dto';
import { PurchaseSeasonPassDto } from './dto/purchase-season-pass.dto';
import { PurchaseSeasonPassResponseDto } from './dto/purchase-season-pass-response.dto';
import { SeasonPassPriceDto } from './dto/season-pass-price.dto';

const ACTIVE_SEASON_LABEL = '2026/2027';

@Injectable()
export class SeasonPassesService {
  private readonly logger = new Logger(SeasonPassesService.name);
  private readonly mailConfig: MailConfig;
  private readonly cronConfig: CronConfig;
  private readonly loyaltyConfig: LoyaltyConfig;
  private readonly stripeCurrency: string;

  constructor(
    @InjectRepository(SeasonPass) private readonly seasonPassRepository: Repository<SeasonPass>,
    @InjectRepository(PassLoan) private readonly passLoanRepository: Repository<PassLoan>,
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(SeasonPassPrice)
    private readonly seasonPassPriceRepository: Repository<SeasonPassPrice>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly qrService: QrService,
    private readonly loyaltyService: LoyaltyService,
    private readonly renderer: TicketRendererService,
  ) {
    this.mailConfig = this.configService.getOrThrow<MailConfig>('mail');
    this.cronConfig = this.configService.getOrThrow<CronConfig>('cron');
    this.loyaltyConfig = this.configService.getOrThrow<LoyaltyConfig>('loyalty');
    this.stripeCurrency = this.configService.getOrThrow<StripeConfig>('stripe').currency;
  }

  /**
   * Returns the per-section season pass price list for the currently
   * active season (`2026/2027`). Public read endpoint — no auth.
   */
  async listPrices(): Promise<SeasonPassPriceDto[]> {
    const prices = await this.seasonPassPriceRepository.find({
      where: { seasonLabel: ACTIVE_SEASON_LABEL, isActive: true },
      order: { price: 'DESC' },
    });
    return prices.map((row) => ({
      sectionId: row.section,
      sectionName: row.sectionLabel,
      price: row.price,
      currency: row.currency,
      seasonLabel: row.seasonLabel,
    }));
  }

  /**
   * Purchases a season pass for the given user + section using Stripe.
   *
   * Flow:
   *   1. Look up the active season's price row for the section.
   *   2. Create a PaymentIntent (idempotency-keyed per user+section+season)
   *      and confirm it server-side with the supplied PaymentMethod.
   *   3. On `succeeded`: persist a SeasonPass row, award +500 loyalty.
   *   4. If the intent requires further action (3DS), return the
   *      clientSecret so the frontend can drive the next step.
   *
   * Idempotency guarantees:
   *   - The Stripe idempotency key prevents duplicate PaymentIntents on
   *     retries.
   *   - We refuse to create a second SeasonPass for the same
   *     `stripePaymentIntentId` (DB-level guard via existence check).
   */
  async purchase(
    userId: string,
    dto: PurchaseSeasonPassDto,
  ): Promise<PurchaseSeasonPassResponseDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('A felhasználó nem található.');
    }

    const priceRow = await this.seasonPassPriceRepository.findOne({
      where: {
        section: dto.sectionId,
        seasonLabel: ACTIVE_SEASON_LABEL,
        isActive: true,
      },
    });
    if (!priceRow) {
      throw new NotFoundException(
        `Nem található aktív bérletár ehhez a szektorhoz: ${dto.sectionId}`,
      );
    }

    // Idempotency: same user buying the same section for the same season
    // within Stripe's idempotency window must collapse to a single intent.
    const idempotencyKey = `seasonpass_${userId}_${priceRow.section}_${priceRow.seasonLabel}`.replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );

    const stripeAmount = this.toStripeAmount(priceRow.price);

    const intentParams: Stripe.PaymentIntentCreateParams = {
      amount: stripeAmount,
      currency: this.stripeCurrency,
      description: `KTE Jegyportál — Bérlet ${priceRow.sectionLabel} (${priceRow.seasonLabel})`,
      metadata: {
        userId,
        section: priceRow.section,
        seasonLabel: priceRow.seasonLabel,
        purpose: 'season_pass_purchase',
      },
    };

    if (dto.paymentMethodId) {
      intentParams.payment_method = dto.paymentMethodId;
      intentParams.confirm = true;
      // Disallow off-session redirects so we don't bounce the user out
      // of the SPA mid-confirm. 3DS is handled via clientSecret.
      intentParams.automatic_payment_methods = {
        enabled: true,
        allow_redirects: 'never',
      };
    } else {
      intentParams.automatic_payment_methods = { enabled: true };
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.paymentIntents.create(intentParams, { idempotencyKey });
    } catch (error) {
      const stripeError = error as Stripe.errors.StripeError;
      // Card declined / requires action errors come back inside the error
      // payload with a `payment_intent` we can still surface to the client.
      if (stripeError?.payment_intent) {
        const failedIntent = stripeError.payment_intent;
        this.logger.warn(
          `Season pass Stripe error user=${userId} section=${priceRow.section}: ${stripeError.message}`,
        );
        return this.buildPurchaseResponse(failedIntent, priceRow, null);
      }
      this.logger.error(
        `Season pass PaymentIntent create failed user=${userId} section=${priceRow.section}: ${stripeError?.message ?? String(error)}`,
      );
      throw new BadRequestException(
        stripeError?.message ?? 'A fizetés feldolgozása sikertelen.',
      );
    }

    if (intent.status === 'succeeded') {
      const pass = await this.persistSeasonPassFromIntent(intent, priceRow, userId);
      await this.awardSeasonPassLoyalty(pass);
      return this.buildPurchaseResponse(intent, priceRow, pass.id);
    }

    // requires_action / requires_confirmation / processing → client drives the rest.
    return this.buildPurchaseResponse(intent, priceRow, null);
  }

  private buildPurchaseResponse(
    intent: Stripe.PaymentIntent,
    priceRow: SeasonPassPrice,
    seasonPassId: string | null,
  ): PurchaseSeasonPassResponseDto {
    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret ?? null,
      status: intent.status,
      seasonPassId,
      succeeded: intent.status === 'succeeded',
      seasonLabel: priceRow.seasonLabel,
      amount: priceRow.price,
      currency: priceRow.currency,
    };
  }

  /**
   * Atomically persists the SeasonPass row backed by a succeeded
   * PaymentIntent. Idempotent: a repeated call for the same
   * `stripePaymentIntentId` returns the existing row.
   */
  private async persistSeasonPassFromIntent(
    intent: Stripe.PaymentIntent,
    priceRow: SeasonPassPrice,
    userId: string,
  ): Promise<SeasonPass> {
    const existing = await this.seasonPassRepository.findOne({
      where: { stripePaymentIntentId: intent.id },
    });
    if (existing) {
      return existing;
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SeasonPass);
      const pass = repo.create({
        id: randomUUID(),
        userId,
        seasonLabel: priceRow.seasonLabel,
        validFrom: priceRow.validFrom,
        validUntil: priceRow.validUntil,
        status: SeasonPassStatus.ACTIVE,
        pricePaid: priceRow.price.toFixed(2),
        currency: priceRow.currency,
        qrCode: `KTE-SP-${randomUUID()}`,
        autoRenew: false,
        stripePaymentIntentId: intent.id,
      });
      return repo.save(pass);
    });
  }

  private async awardSeasonPassLoyalty(pass: SeasonPass): Promise<void> {
    try {
      await this.loyaltyService.award({
        userId: pass.userId,
        type: LoyaltyTransactionType.EARN,
        source: LoyaltyTransactionSource.SEASON_PASS_PURCHASE,
        points: this.loyaltyConfig.seasonPassPoints,
        referenceId: `season_pass:${pass.id}`,
        description: 'Bérletvásárlás bónusz',
      });
    } catch (error) {
      this.logger.error(
        `Loyalty award failed for season pass=${pass.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private toStripeAmount(huf: number): number {
    // Stripe treats HUF as a 2-decimal currency at the API edge even
    // though HUF is real-life zero-decimal: 30 000 HUF must be sent
    // as 3 000 000. See PaymentsService.toStripeAmount for the same
    // rationale.
    return Math.round(huf) * 100;
  }

  /**
   * Returns the seat ids occupied by an ACTIVE season pass — used by the
   * seat map to render those seats with a distinct status. Empty array
   * when none of the active passes have a seat assigned.
   */
  async listSeatIdsHeldBySeasonPass(): Promise<string[]> {
    const passes = await this.seasonPassRepository.find({
      where: { status: SeasonPassStatus.ACTIVE },
      select: ['seatId'],
    });
    return passes
      .map((p) => p.seatId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  async listForUser(userId: string): Promise<Array<{ pass: SeasonPass; loans: PassLoan[]; seat: string | undefined }>> {
    const passes = await this.seasonPassRepository.find({
      where: { userId },
      relations: ['seat'],
      order: { validFrom: 'DESC' },
    });
    if (passes.length === 0) {
      return [];
    }
    const loans = await this.passLoanRepository.find({
      where: { seasonPassId: In(passes.map((p) => p.id)) },
      relations: ['match'],
      order: { createdAt: 'DESC' },
    });
    return passes.map((pass) => ({
      pass,
      loans: loans.filter((l) => l.seasonPassId === pass.id),
      seat: pass.seat ? this.renderer.formatSeat(pass.seat) : undefined,
    }));
  }

  async getOwnedPass(passId: string, userId: string): Promise<SeasonPass> {
    const pass = await this.seasonPassRepository.findOne({
      where: { id: passId },
      relations: ['seat'],
    });
    if (!pass) {
      throw new NotFoundException(`Season pass ${passId} not found`);
    }
    if (pass.userId !== userId) {
      throw new ForbiddenException('Not the owner of this season pass');
    }
    return pass;
  }

  async createLoan(passId: string, lenderUserId: string, dto: CreateLoanDto): Promise<PassLoan> {
    const pass = await this.getOwnedPass(passId, lenderUserId);
    if (pass.status !== SeasonPassStatus.ACTIVE) {
      throw new BadRequestException('Season pass is not active');
    }

    const lender = await this.userRepository.findOne({ where: { id: lenderUserId } });
    if (!lender) {
      throw new NotFoundException('Lender user not found');
    }
    if (lender.email.toLowerCase() === dto.borrowerEmail.toLowerCase()) {
      throw new BadRequestException('Cannot loan to yourself');
    }

    const match = await this.matchRepository.findOne({ where: { id: dto.matchId } });
    if (!match) {
      throw new NotFoundException('Match not found');
    }
    if (match.kickoffAt.getTime() < Date.now()) {
      throw new BadRequestException('Cannot create a loan for a match that has already started');
    }

    // Reject overlapping pending/accepted loans for the same match.
    const existing = await this.passLoanRepository.findOne({
      where: {
        seasonPassId: passId,
        matchId: dto.matchId,
        status: In([PassLoanStatus.PENDING, PassLoanStatus.ACCEPTED]),
      },
    });
    if (existing) {
      throw new BadRequestException('This pass is already loaned for this match');
    }

    const borrower = await this.userRepository.findOne({
      where: { email: dto.borrowerEmail.toLowerCase() },
    });

    const loan = this.passLoanRepository.create({
      seasonPassId: pass.id,
      lenderUserId,
      borrowerUserId: borrower?.id,
      borrowerEmail: dto.borrowerEmail.toLowerCase(),
      matchId: dto.matchId,
      status: PassLoanStatus.PENDING,
      invitationToken: nanoid(48),
      expiresAt: new Date(Date.now() + this.cronConfig.loanInvitationTtlHours * 60 * 60 * 1000),
    });
    const saved = await this.passLoanRepository.save(loan);

    void this.dispatchInvitationEmail(saved, lender, match, pass).catch((error: Error) => {
      this.logger.error(`Loan invitation email failed for loan=${saved.id}: ${error.message}`);
    });

    return saved;
  }

  /**
   * Borrower-side acceptance flow.
   * Generates the QR token (jti persisted on the loan row for rotation).
   */
  async acceptLoan(invitationToken: string, borrowerUserId: string): Promise<PassLoan> {
    return this.dataSource.transaction(async (manager) => {
      const loanRepo = manager.getRepository(PassLoan);
      const loan = await loanRepo.findOne({
        where: { invitationToken },
        relations: ['match', 'seasonPass', 'seasonPass.seat', 'lender'],
      });
      if (!loan) {
        throw new NotFoundException('Invitation not found');
      }
      if (loan.status !== PassLoanStatus.PENDING) {
        throw new BadRequestException(`Invitation is already in state ${loan.status}`);
      }
      if (loan.expiresAt.getTime() < Date.now()) {
        loan.status = PassLoanStatus.EXPIRED;
        await loanRepo.save(loan);
        throw new BadRequestException('Invitation has expired');
      }
      const borrower = await manager.getRepository(User).findOne({ where: { id: borrowerUserId } });
      if (!borrower) {
        throw new NotFoundException('Borrower user not found');
      }
      if (borrower.email.toLowerCase() !== loan.borrowerEmail.toLowerCase()) {
        throw new ForbiddenException('Invitation was issued to a different email address');
      }

      loan.borrowerUserId = borrowerUserId;
      loan.status = PassLoanStatus.ACCEPTED;
      loan.acceptedAt = new Date();
      loan.qrJti = this.qrService.generateJti();
      await loanRepo.save(loan);

      void this.dispatchAcceptanceEmails(loan).catch((error: Error) => {
        this.logger.error(`Loan acceptance emails failed loan=${loan.id}: ${error.message}`);
      });

      return loan;
    });
  }

  async cancelLoan(passId: string, loanId: string, userId: string, dto: CancelLoanDto): Promise<PassLoan> {
    return this.dataSource.transaction(async (manager) => {
      const loanRepo = manager.getRepository(PassLoan);
      const loan = await loanRepo.findOne({
        where: { id: loanId, seasonPassId: passId },
        relations: ['match', 'borrower', 'lender'],
      });
      if (!loan) {
        throw new NotFoundException('Loan not found');
      }
      if (loan.lenderUserId !== userId) {
        throw new ForbiddenException('Only the lender can cancel a loan');
      }
      if (
        loan.status !== PassLoanStatus.PENDING &&
        loan.status !== PassLoanStatus.ACCEPTED
      ) {
        throw new BadRequestException(`Loan in state ${loan.status} cannot be cancelled`);
      }
      const now = new Date();
      const wasAccepted = loan.status === PassLoanStatus.ACCEPTED;
      loan.status = PassLoanStatus.CANCELLED;
      loan.cancelledAt = now;
      loan.cancellationReason = dto.reason;
      if (loan.qrJti) {
        await this.qrService.revoke(loan.qrJti);
        loan.qrRevokedAt = now;
      }
      await loanRepo.save(loan);

      // Notify both parties when an accepted loan is cancelled. Pending loans
      // notify only the borrower (lender just cancelled, no need to mail self).
      void this.dispatchCancellationEmails(loan, wasAccepted).catch((error: Error) => {
        this.logger.error(`Loan cancellation emails failed loan=${loan.id}: ${error.message}`);
      });

      return loan;
    });
  }

  /**
   * Marks an accepted loan as COMPLETED once the match is over and
   * awards loyalty points to the lender. Idempotent.
   */
  async completeLoan(loan: PassLoan): Promise<void> {
    if (loan.status !== PassLoanStatus.ACCEPTED) {
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      const loanRepo = manager.getRepository(PassLoan);
      loan.status = PassLoanStatus.COMPLETED;
      loan.completedAt = new Date();
      if (loan.qrJti) {
        await this.qrService.revoke(loan.qrJti);
        loan.qrRevokedAt = new Date();
      }
      await loanRepo.save(loan);
    });

    try {
      await this.loyaltyService.award({
        userId: loan.lenderUserId,
        type: LoyaltyTransactionType.EARN,
        source: LoyaltyTransactionSource.PASS_LOAN,
        points: this.loyaltyService.getConfig().passLoanPoints,
        referenceId: `loan:${loan.id}`,
        description: 'Bérlet kölcsönzés jutalom',
      });
    } catch (error) {
      this.logger.error(`Loan completion loyalty award failed loan=${loan.id}: ${(error as Error).message}`);
    }
  }

  private async dispatchInvitationEmail(
    loan: PassLoan,
    lender: User,
    match: Match,
    pass: SeasonPass,
  ): Promise<void> {
    const matchSummary = this.renderer.matchSummary(match);
    const acceptUrl = `${this.mailConfig.baseUrl}/loans/accept?token=${encodeURIComponent(loan.invitationToken)}`;
    await this.emailService.send({
      to: loan.borrowerEmail,
      subject: `${lender.firstName} bérletet ajánlott fel - ${matchSummary.title}`,
      template: 'loan-invitation',
      context: {
        recipientName: loan.borrowerEmail.split('@')[0],
        lenderName: `${lender.firstName} ${lender.lastName}`,
        matchTitle: matchSummary.title,
        matchVenue: matchSummary.venue,
        matchKickoffLabel: matchSummary.kickoffLabel,
        seatLabel: pass.seat ? this.renderer.formatSeat(pass.seat) : '-',
        expiresAtLabel: this.renderer.formatKickoff(loan.expiresAt),
        acceptUrl,
      },
      correlationId: `loan-invitation:${loan.id}`,
    });
  }

  private async dispatchAcceptanceEmails(loan: PassLoan): Promise<void> {
    if (!loan.match || !loan.lender || !loan.borrowerUserId || !loan.seasonPass) {
      return;
    }
    const borrower = await this.userRepository.findOne({ where: { id: loan.borrowerUserId } });
    if (!borrower) {
      return;
    }
    const matchSummary = this.renderer.matchSummary(loan.match);
    const seatLabel = loan.seasonPass.seat ? this.renderer.formatSeat(loan.seasonPass.seat) : '-';
    const qrResult = await this.qrService.generateForLoan(loan.id, loan.qrJti ?? undefined);
    const qrUrl = `${this.mailConfig.baseUrl}/profile/loans/${loan.id}`;

    // Borrower email (with QR)
    await this.emailService.send({
      to: borrower.email,
      subject: `Bérlet kölcsön elfogadva - ${matchSummary.title}`,
      template: 'loan-confirmation',
      context: {
        recipientName: borrower.firstName,
        borrowerName: `${borrower.firstName} ${borrower.lastName}`,
        matchTitle: matchSummary.title,
        matchVenue: matchSummary.venue,
        matchKickoffLabel: matchSummary.kickoffLabel,
        seatLabel,
        qrDataUrl: qrResult.dataUrl,
        qrUrl,
        isLender: false,
      },
      correlationId: `loan-confirmation:borrower:${loan.id}`,
    });

    // Lender notification (no QR)
    await this.emailService.send({
      to: loan.lender.email,
      subject: `${borrower.firstName} elfogadta a bérletkölcsönt - ${matchSummary.title}`,
      template: 'loan-confirmation',
      context: {
        recipientName: loan.lender.firstName,
        borrowerName: `${borrower.firstName} ${borrower.lastName}`,
        matchTitle: matchSummary.title,
        matchVenue: matchSummary.venue,
        matchKickoffLabel: matchSummary.kickoffLabel,
        seatLabel,
        qrDataUrl: '',
        qrUrl,
        isLender: true,
      },
      correlationId: `loan-confirmation:lender:${loan.id}`,
    });
  }

  private async dispatchCancellationEmails(loan: PassLoan, wasAccepted: boolean): Promise<void> {
    const match = loan.match
      ? loan.match
      : await this.matchRepository.findOne({ where: { id: loan.matchId } });
    if (!match) {
      return;
    }
    const matchSummary = this.renderer.matchSummary(match);
    const lender =
      loan.lender ?? (await this.userRepository.findOne({ where: { id: loan.lenderUserId } }));
    const borrower =
      loan.borrower ?? (loan.borrowerUserId
        ? await this.userRepository.findOne({ where: { id: loan.borrowerUserId } })
        : null);

    const recipients: Array<{ email: string; name: string; isLender: boolean }> = [];
    // Borrower always notified (they have a stake in the pass)
    if (borrower) {
      recipients.push({ email: borrower.email, name: borrower.firstName, isLender: false });
    } else {
      recipients.push({ email: loan.borrowerEmail, name: loan.borrowerEmail.split('@')[0], isLender: false });
    }
    if (wasAccepted && lender) {
      recipients.push({ email: lender.email, name: lender.firstName, isLender: true });
    }

    for (const recipient of recipients) {
      await this.emailService.send({
        to: recipient.email,
        subject: `Bérlet kölcsönzés visszavonva - ${matchSummary.title}`,
        template: 'loan-cancelled',
        context: {
          recipientName: recipient.name,
          matchTitle: matchSummary.title,
          matchKickoffLabel: matchSummary.kickoffLabel,
          reason: loan.cancellationReason,
          isLender: recipient.isLender,
        },
        correlationId: `loan-cancelled:${recipient.isLender ? 'lender' : 'borrower'}:${loan.id}`,
      });
    }
  }
}
