import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
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
  Ticket,
  TicketSource,
  TicketStatus,
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
import { LoanPreviewDto } from './dto/season-pass-response.dto';

const ACTIVE_SEASON_LABEL = '2026/2027';

function isDuplicateKeyError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e['code'] === 'ER_DUP_ENTRY') return true;
  const driver = e['driverError'];
  if (driver != null && typeof driver === 'object') {
    if ((driver as Record<string, unknown>)['code'] === 'ER_DUP_ENTRY') return true;
  }
  if (typeof e['message'] === 'string' && e['message'].includes('ER_DUP_ENTRY')) return true;
  return false;
}

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
    const idempotencyKey =
      `seasonpass_${userId}_${priceRow.section}_${priceRow.seasonLabel}`.replace(
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
      throw new BadRequestException(stripeError?.message ?? 'A fizetés feldolgozása sikertelen.');
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

  async listForUser(
    userId: string,
  ): Promise<Array<{ pass: SeasonPass; loans: PassLoan[]; seat: string | undefined }>> {
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

  /**
   * Lazily materialises the owner's SEASON_PASS Ticket for a given match,
   * then returns a QR token the holder can present at the gate.
   *
   * Guards:
   *  - Pass must be ACTIVE and have a seat assigned.
   *  - No ACCEPTED loan may exist for this (pass, match) — that would mean
   *    the right of entry belongs to the borrower.
   *  - No existing LOAN Ticket for the same (match, seat) — means the
   *    borrower already consumed that entry.
   *
   * Two simultaneous requests for the same (pass, match) are safe: the
   * second request sees the ticket created by the first and returns it.
   */
  async getMatchQr(
    passId: string,
    matchId: string,
    userId: string,
  ): Promise<{ ticketId: string; dataUrl: string; token: string }> {
    const pass = await this.getOwnedPass(passId, userId);
    if (pass.status !== SeasonPassStatus.ACTIVE) {
      throw new BadRequestException('Season pass is not active');
    }
    if (!pass.seatId) {
      throw new BadRequestException('Season pass has no seat assigned');
    }

    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException('Match not found');
    }

    const ticket = await this.materializeSeasonPassTicket(pass, matchId);
    const result = await this.qrService.generateForTicket(ticket.id, ticket.qrJti);
    return { ticketId: ticket.id, dataUrl: result.dataUrl, token: result.token };
  }

  /**
   * Single source of truth for the owner's SEASON_PASS Ticket.
   *
   * Creates (or finds) the Ticket row that represents the pass holder's
   * right of entry for the given match. Guards against:
   *  - An active loan (ACCEPTED) for this (pass, match)
   *  - An existing LOAN Ticket (meaning the right was already transferred
   *    to a borrower, and may even have been used)
   *
   * Concurrent calls for the same (pass, match) resolve to the same row:
   * on a duplicate-key race the loser re-fetches and returns the winner's row.
   */
  private async materializeSeasonPassTicket(pass: SeasonPass, matchId: string): Promise<Ticket> {
    const seatId = pass.seatId!;

    try {
      return await this.dataSource.transaction(async (manager) => {
        // Guard: active loan blocks the owner's right of entry
        const activeLoan = await manager.getRepository(PassLoan).findOne({
          where: { seasonPassId: pass.id, matchId, status: PassLoanStatus.ACCEPTED },
        });
        if (activeLoan) {
          throw new ConflictException('Season pass is currently loaned out for this match');
        }

        const ticketRepo = manager.getRepository(Ticket);

        // Guard: a remaining LOAN Ticket means the seat was loaned and the
        // borrower may have already entered — the owner cannot reclaim it
        const loanTicket = await ticketRepo.findOne({
          where: { matchId, seatId, source: TicketSource.LOAN },
        });
        if (loanTicket) {
          throw new ConflictException(
            'Entry right for this match was already transferred to a borrower',
          );
        }

        // Idempotent: return the ticket if it already exists
        const existing = await ticketRepo.findOne({
          where: { matchId, seatId, source: TicketSource.SEASON_PASS },
        });
        if (existing) return existing;

        const ticket = ticketRepo.create({
          matchId,
          seatId,
          userId: pass.userId,
          seasonPassId: pass.id,
          status: TicketStatus.PAID,
          source: TicketSource.SEASON_PASS,
          pricePaid: '0.00',
          currency: 'HUF',
          qrCode: `KTE-SP-${randomUUID()}`,
          qrJti: this.qrService.generateJti(),
        });
        return ticketRepo.save(ticket);
      });
    } catch (err: unknown) {
      if (err instanceof HttpException) throw err;
      // Duplicate key: a concurrent request inserted first — re-fetch
      if (isDuplicateKeyError(err)) {
        const found = await this.dataSource.getRepository(Ticket).findOne({
          where: { matchId, seatId, source: TicketSource.SEASON_PASS },
        });
        if (found) return found;
      }
      throw err;
    }
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
   *
   * Inside a single transaction:
   *  1. Validates the invitation and marks the loan ACCEPTED.
   *  2. Checks the owner's SEASON_PASS Ticket status. If already USED
   *     (owner entered the stadium), the loan is marked REVOKED and a 409
   *     is returned — a used right of entry cannot be transferred.
   *  3. Deletes the owner's SEASON_PASS Ticket (if PAID) and revokes its
   *     QR — the owner's right of entry is gone for this match.
   *  4. Creates a LOAN Ticket owned by the borrower, satisfying the
   *     uq_tickets_match_seat constraint. The LOAN Ticket is the only
   *     valid right of entry for this (match, seat) going forward.
   *
   * Why hard-delete the owner's ticket instead of a status change:
   *  The unique constraint on (match_id, seat_id) means only ONE row can
   *  exist for a given seat per match. Changing the owner's ticket to
   *  CANCELLED would leave the row in place, preventing the LOAN Ticket
   *  insert. Deletion + revocation achieves the same security goal: the
   *  old QR token is denylist-blocked so any cached copy is harmless.
   *  The LOAN Ticket immediately occupies the unique slot, ensuring the
   *  seat never appears purchasable between the delete and the insert.
   */
  async acceptLoan(invitationToken: string, borrowerUserId: string): Promise<PassLoan> {
    // Set to true inside the transaction when the owner has already entered.
    // We commit the REVOKED status first, then throw outside the transaction
    // so the terminal state is persisted before the 409 is surfaced.
    let ownerAlreadyEntered = false;

    const { loan, loanTicket } = await this.dataSource.transaction(async (manager) => {
      const loanRepo = manager.getRepository(PassLoan);
      const loan = await loanRepo.findOne({
        where: { invitationToken },
        relations: ['match', 'seasonPass', 'seasonPass.seat', 'lender'],
      });
      if (!loan) {
        throw new NotFoundException('Invitation not found');
      }
      if (loan.status !== PassLoanStatus.PENDING) {
        const statusCodeMap: Partial<Record<PassLoanStatus, string>> = {
          [PassLoanStatus.EXPIRED]: 'loan_expired',
          [PassLoanStatus.CANCELLED]: 'loan_revoked',
          [PassLoanStatus.REVOKED]: 'seat_already_used',
        };
        const code = statusCodeMap[loan.status] ?? 'loan_revoked';
        if (code === 'seat_already_used') {
          throw new ConflictException({
            statusCode: 409,
            message: `A meghívó már nem érvényes (állapot: ${loan.status}).`,
            code,
          });
        }
        throw new BadRequestException({
          statusCode: 400,
          message: `A meghívó már nem érvényes (állapot: ${loan.status}).`,
          code,
        });
      }
      if (loan.expiresAt.getTime() < Date.now()) {
        loan.status = PassLoanStatus.EXPIRED;
        await loanRepo.save(loan);
        throw new BadRequestException({
          statusCode: 400,
          message: 'A meghívó lejárt.',
          code: 'loan_expired',
        });
      }
      const borrower = await manager.getRepository(User).findOne({ where: { id: borrowerUserId } });
      if (!borrower) {
        throw new NotFoundException('Borrower user not found');
      }
      if (borrower.email.toLowerCase() !== loan.borrowerEmail.toLowerCase()) {
        throw new ForbiddenException('Invitation was issued to a different email address');
      }

      const pass = loan.seasonPass!;
      if (!pass.seatId) {
        throw new BadRequestException('Season pass has no seat assigned');
      }

      const ticketRepo = manager.getRepository(Ticket);

      // Fetch the owner's ticket early so we can check its status before
      // committing to the acceptance path.
      const ownerTicket = await ticketRepo.findOne({
        where: {
          matchId: loan.matchId,
          seatId: pass.seatId,
          source: TicketSource.SEASON_PASS,
        },
      });

      // Guard: owner already entered — the exercised entry right cannot be
      // transferred retroactively. Mark the loan REVOKED (terminal state)
      // and let the transaction commit that status before we throw 409.
      if (ownerTicket?.status === TicketStatus.USED) {
        loan.status = PassLoanStatus.REVOKED;
        loan.cancelledAt = new Date();
        loan.cancellationReason = 'Owner already entered the stadium for this match';
        await loanRepo.save(loan);
        ownerAlreadyEntered = true;
        return { loan, loanTicket: null as Ticket | null };
      }

      loan.borrowerUserId = borrowerUserId;
      loan.status = PassLoanStatus.ACCEPTED;
      loan.acceptedAt = new Date();
      loan.qrJti = this.qrService.generateJti();
      await loanRepo.save(loan);

      // Invalidate the owner's SEASON_PASS Ticket for this match if it
      // was already materialised. See method JSDoc for the rationale.
      if (ownerTicket) {
        if (ownerTicket.qrJti) {
          await this.qrService.revoke(ownerTicket.qrJti);
        }
        await ticketRepo.delete(ownerTicket.id);
      }

      // Create the borrower's LOAN Ticket — the single right of entry for
      // this (match, seat) from this point forward.
      const loanTicket = ticketRepo.create({
        matchId: loan.matchId,
        seatId: pass.seatId,
        userId: borrowerUserId,
        seasonPassId: pass.id,
        status: TicketStatus.PAID,
        source: TicketSource.LOAN,
        pricePaid: '0.00',
        currency: 'HUF',
        qrCode: `KTE-LOAN-${randomUUID()}`,
        qrJti: this.qrService.generateJti(),
      });
      const savedTicket = await ticketRepo.save(loanTicket);

      return { loan, loanTicket: savedTicket as Ticket | null };
    });

    if (ownerAlreadyEntered) {
      throw new ConflictException({
        statusCode: 409,
        message:
          'A bérletestulajdonos már belépett erre a mérkőzésre. Az érvényesített belépőjog nem ruházható át.',
        code: 'seat_already_used',
      });
    }

    void this.dispatchAcceptanceEmails(loan, loanTicket!).catch((error: Error) => {
      this.logger.error(`Loan acceptance emails failed loan=${loan.id}: ${error.message}`);
    });

    return loan;
  }

  /**
   * Returns the minimum data a borrower needs to see BEFORE accepting.
   * No auth required — the token is the only credential.
   *
   * Does NOT mutate the loan's status on expiry check (unlike acceptLoan).
   */
  async previewLoan(invitationToken: string): Promise<LoanPreviewDto> {
    const loan = await this.passLoanRepository.findOne({
      where: { invitationToken },
      relations: ['match', 'seasonPass', 'seasonPass.seat', 'lender'],
    });

    if (!loan) {
      throw new NotFoundException('A meghívó nem található.');
    }

    if (loan.status !== PassLoanStatus.PENDING) {
      const statusCodeMap: Partial<Record<PassLoanStatus, string>> = {
        [PassLoanStatus.EXPIRED]: 'loan_expired',
        [PassLoanStatus.CANCELLED]: 'loan_revoked',
        [PassLoanStatus.REVOKED]: 'seat_already_used',
      };
      const code = statusCodeMap[loan.status] ?? 'loan_revoked';
      if (code === 'seat_already_used') {
        throw new ConflictException({
          statusCode: 409,
          message: `A meghívó már nem érvényes (állapot: ${loan.status}).`,
          code,
        });
      }
      throw new BadRequestException({
        statusCode: 400,
        message: `A meghívó már nem érvényes (állapot: ${loan.status}).`,
        code,
      });
    }

    // Check time expiry WITHOUT writing back to the database.
    if (loan.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'A meghívó lejárt.',
        code: 'loan_expired',
      });
    }

    const match = loan.match!;
    const seat = loan.seasonPass?.seat;
    const lender = loan.lender!;

    return {
      matchTitle: `${match.homeTeam} - ${match.awayTeam}`,
      matchVenue: match.venue,
      kickoffAt: match.kickoffAt.toISOString(),
      seatSection: seat?.section ?? '–',
      seatRow: seat?.row ?? '–',
      seatNumber: seat?.number ?? 0,
      lenderName: `${lender.firstName} ${lender.lastName}`,
      expiresAt: loan.expiresAt.toISOString(),
    };
  }

  async cancelLoan(
    passId: string,
    loanId: string,
    userId: string,
    dto: CancelLoanDto,
  ): Promise<PassLoan> {
    return this.dataSource.transaction(async (manager) => {
      const loanRepo = manager.getRepository(PassLoan);
      const loan = await loanRepo.findOne({
        where: { id: loanId, seasonPassId: passId },
        relations: ['match', 'borrower', 'lender', 'seasonPass'],
      });
      if (!loan) {
        throw new NotFoundException('Loan not found');
      }
      if (loan.lenderUserId !== userId) {
        throw new ForbiddenException('Only the lender can cancel a loan');
      }
      if (loan.status !== PassLoanStatus.PENDING && loan.status !== PassLoanStatus.ACCEPTED) {
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

      // If the loan was accepted, a LOAN Ticket exists for the borrower.
      // Revoke its QR and handle it based on whether the borrower has
      // already entered the stadium.
      if (wasAccepted && loan.seasonPass?.seatId) {
        const ticketRepo = manager.getRepository(Ticket);
        const loanTicket = await ticketRepo.findOne({
          where: {
            matchId: loan.matchId,
            seatId: loan.seasonPass.seatId,
            source: TicketSource.LOAN,
          },
        });
        if (loanTicket) {
          if (loanTicket.qrJti) {
            await this.qrService.revoke(loanTicket.qrJti);
          }
          if (loanTicket.status !== TicketStatus.USED) {
            // Borrower has not entered yet — hard-delete the LOAN Ticket so
            // the owner can re-materialise their SEASON_PASS Ticket and the
            // uq_tickets_match_seat slot is freed for them.
            await ticketRepo.delete(loanTicket.id);
          }
          // If USED: the borrower already entered. Revoking the QR is
          // enough; the USED record must stay so the seat remains occupied
          // and no new usable entry can be produced for this match.
        }
      }

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
   *
   * Also revokes the LOAN Ticket's QR if the borrower did not show up
   * (ticket is still PAID) so stale tokens cannot be presented after the
   * match. The ExpireTicketsJob will expire the PAID ticket itself.
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

      // Revoke the LOAN Ticket's QR if the borrower never entered
      const loanTicket = await manager.getRepository(Ticket).findOne({
        where: {
          matchId: loan.matchId,
          seasonPassId: loan.seasonPassId,
          source: TicketSource.LOAN,
        },
      });
      if (loanTicket?.qrJti && loanTicket.status === TicketStatus.PAID) {
        await this.qrService.revoke(loanTicket.qrJti);
      }
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
      this.logger.error(
        `Loan completion loyalty award failed loan=${loan.id}: ${(error as Error).message}`,
      );
    }
  }

  private async dispatchInvitationEmail(
    loan: PassLoan,
    lender: User,
    match: Match,
    pass: SeasonPass,
  ): Promise<void> {
    const matchSummary = this.renderer.matchSummary(match);
    const acceptUrl = `${this.mailConfig.baseUrl}/loans/accept/${encodeURIComponent(loan.invitationToken)}`;
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

  /**
   * Sends acceptance emails to both borrower and lender.
   *
   * The borrower's email includes a QR generated from the LOAN Ticket
   * (type='ticket') so it is accepted by the unified gate scan path.
   */
  private async dispatchAcceptanceEmails(loan: PassLoan, loanTicket: Ticket): Promise<void> {
    if (!loan.match || !loan.lender || !loan.borrowerUserId || !loan.seasonPass) {
      return;
    }
    const borrower = await this.userRepository.findOne({ where: { id: loan.borrowerUserId } });
    if (!borrower) {
      return;
    }
    const matchSummary = this.renderer.matchSummary(loan.match);
    const seatLabel = loan.seasonPass.seat ? this.renderer.formatSeat(loan.seasonPass.seat) : '-';

    // Generate QR from the LOAN Ticket so the gate scan path works
    const qrResult = await this.qrService.generateForTicket(
      loanTicket.id,
      loanTicket.qrJti ?? undefined,
    );
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
      loan.borrower ??
      (loan.borrowerUserId
        ? await this.userRepository.findOne({ where: { id: loan.borrowerUserId } })
        : null);

    const recipients: Array<{ email: string; name: string; isLender: boolean }> = [];
    // Borrower always notified (they have a stake in the pass)
    if (borrower) {
      recipients.push({ email: borrower.email, name: borrower.firstName, isLender: false });
    } else {
      recipients.push({
        email: loan.borrowerEmail,
        name: loan.borrowerEmail.split('@')[0],
        isLender: false,
      });
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
