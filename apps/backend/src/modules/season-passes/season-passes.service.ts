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
import Redis from 'ioredis';
import Stripe from 'stripe';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
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
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
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

// TTL for the per-attempt Redis record. Two requests within this window for
// the same (user, section, season) share one Stripe idempotency key so
// double-clicks and network retries collapse to a single PaymentIntent.
// A card decline clears the record immediately so the next attempt is fresh.
const SEASON_PASS_ATTEMPT_TTL_SEC = 300;

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

type DuplicateKind = 'seat' | 'holder' | 'other';

/** Which unique index a duplicate-key error came from (MySQL names it in the message). */
function duplicateKind(err: unknown): DuplicateKind {
  const e = err as { message?: unknown; driverError?: { message?: unknown } } | null;
  const text = `${String(e?.message ?? '')} ${String(e?.driverError?.message ?? '')}`;
  if (text.includes('uq_season_passes_seat_season')) return 'seat';
  if (text.includes('uq_season_passes_holder_season')) return 'holder';
  return 'other';
}

interface PassHolder {
  name: string;
  /** Linked account, or null when the holder has no account (e.g. a child). */
  userId: string | null;
}

const fullName = (u: { firstName: string; lastName: string }): string =>
  `${u.firstName} ${u.lastName}`.trim();

class NoFreeSeatError extends Error {}

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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
      validFrom: row.validFrom.toISOString().slice(0, 10),
      validUntil: row.validUntil.toISOString().slice(0, 10),
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

    const holder = await this.resolveHolder(user, dto);
    await this.assertPassCanBeIssued(priceRow, holder, userId);

    // Resolve a per-attempt ID stored in Redis.
    // Two rapid calls for the same (user, section, season) within the 5-minute
    // window share the same attemptId → same Stripe idempotency key → one
    // PaymentIntent (double-click / network-retry protection).
    // A card decline deletes the key so the next attempt is genuinely fresh
    // with a new PaymentIntent — no 24-hour Stripe block.
    // The holder is part of the attempt identity: three passes for three
    // holders in one section are three purchases, not one retried click.
    const holderKey = createHash('sha256')
      .update(`${holder.userId ?? ''}|${holder.name.toLowerCase()}`)
      .digest('hex')
      .slice(0, 16);
    const attemptKey = RedisKeys.seasonPassAttempt(
      userId,
      priceRow.section,
      priceRow.seasonLabel,
      holderKey,
    );
    let attemptId = await this.redis.get(attemptKey);
    if (!attemptId) {
      const freshId = randomUUID();
      const stored = await this.redis.set(
        attemptKey,
        freshId,
        'EX',
        SEASON_PASS_ATTEMPT_TTL_SEC,
        'NX',
      );
      // If SET NX lost a concurrent race, re-fetch whichever value won.
      attemptId = stored === 'OK' ? freshId : ((await this.redis.get(attemptKey)) ?? freshId);
    }

    const idempotencyKey = `seasonpass_${attemptId}`;

    const stripeAmount = this.toStripeAmount(priceRow.price);

    const intentParams: Stripe.PaymentIntentCreateParams = {
      amount: stripeAmount,
      currency: this.stripeCurrency,
      description: `KTE Jegyportál — Bérlet ${priceRow.sectionLabel} (${priceRow.seasonLabel})`,
      metadata: {
        kind: 'season_pass',
        userId,
        priceRowId: priceRow.id,
        section: priceRow.section,
        seasonLabel: priceRow.seasonLabel,
        holderName: holder.name,
        holderUserId: holder.userId ?? '',
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
      // Clear the attempt key so the user can retry immediately without
      // being blocked by the old Stripe idempotency key.
      await this.redis.del(attemptKey).catch(() => undefined);
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
      const pass = await this.persistSeasonPassFromIntent(intent, priceRow, userId, holder);
      if (!pass) {
        throw new ConflictException({
          statusCode: 409,
          message: 'A bérletet nem sikerült kiállítani, a befizetett összeget visszatérítettük.',
          code: 'pass_not_issued_refunded',
        });
      }
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
   * Webhook-driven finalisation for a season-pass PaymentIntent.
   * Called by PaymentsService when it dispatches on `kind === 'season_pass'`.
   * Idempotent: a repeated call for the same intent (double webhook delivery)
   * produces exactly one SeasonPass row and one loyalty transaction.
   */
  async finalizeSeasonPassFromIntent(intent: Stripe.PaymentIntent): Promise<void> {
    const { userId, priceRowId } = intent.metadata;
    if (!userId || !priceRowId) {
      this.logger.error(
        `[season-pass] PaymentIntent ${intent.id} missing required metadata fields — ` +
          `userId=${userId ?? 'MISSING'} priceRowId=${priceRowId ?? 'MISSING'}. ` +
          `No SeasonPass will be created.`,
      );
      return;
    }

    const priceRow = await this.seasonPassPriceRepository.findOne({ where: { id: priceRowId } });
    if (!priceRow) {
      this.logger.error(
        `[season-pass] PaymentIntent ${intent.id}: SeasonPassPrice row id=${priceRowId} not found. ` +
          `No SeasonPass will be created.`,
      );
      return;
    }

    const holderName = intent.metadata.holderName?.trim();
    const holder: PassHolder = holderName
      ? { name: holderName, userId: intent.metadata.holderUserId || null }
      : await this.defaultHolder(userId);
    const pass = await this.persistSeasonPassFromIntent(intent, priceRow, userId, holder);
    if (!pass) return; // refunded and logged
    await this.awardSeasonPassLoyalty(pass);
    this.logger.log(
      `[season-pass] Finalized PaymentIntent ${intent.id} → SeasonPass ${pass.id} for user ${userId}`,
    );
  }

  /**
   * Persists the SeasonPass row backed by a succeeded PaymentIntent and
   * assigns the seat. Idempotent per `stripePaymentIntentId`.
   *
   * Seat choice: the first free seat (by row, number) of the purchased
   * section that is neither held by another pass this season nor occupied by
   * a single-match ticket. Concurrent purchases may pick the same seat; the
   * `uq_season_passes_seat_season` index rejects the loser, which retries with
   * the next free seat.
   *
   * Returns `null` when the pass could not be issued (section full, or the
   * holder account already holds a pass this season). In that case the
   * payment has already been refunded in full.
   */
  private async persistSeasonPassFromIntent(
    intent: Stripe.PaymentIntent,
    priceRow: SeasonPassPrice,
    userId: string,
    holder: PassHolder,
  ): Promise<SeasonPass | null> {
    const existing = await this.seasonPassRepository.findOne({
      where: { stripePaymentIntentId: intent.id },
    });
    if (existing) {
      return existing;
    }

    const maxSeatAttempts = 8;
    let failure = 'no free seat in section';
    for (let attempt = 0; attempt < maxSeatAttempts; attempt++) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const seatId = await this.findFreeSeatId(manager, priceRow.section, priceRow.seasonLabel);
          if (!seatId) {
            throw new NoFreeSeatError();
          }
          const repo = manager.getRepository(SeasonPass);
          return repo.save(
            repo.create({
              id: randomUUID(),
              userId,
              holderName: holder.name,
              holderUserId: holder.userId,
              seatId,
              seasonLabel: priceRow.seasonLabel,
              validFrom: priceRow.validFrom,
              validUntil: priceRow.validUntil,
              status: SeasonPassStatus.ACTIVE,
              pricePaid: priceRow.price.toFixed(2),
              currency: priceRow.currency,
              qrCode: `KTE-SP-${randomUUID()}`,
              autoRenew: false,
              stripePaymentIntentId: intent.id,
            }),
          );
        });
      } catch (err: unknown) {
        if (err instanceof NoFreeSeatError) {
          break;
        }
        if (isDuplicateKeyError(err)) {
          const kind = duplicateKind(err);
          if (kind === 'seat') continue; // lost a race for the seat — pick the next one
          if (kind === 'holder') {
            failure = 'holder already holds a pass this season';
            break;
          }
          // Same intent inserted concurrently (webhook + confirm): return the winner's row.
          const winner = await this.seasonPassRepository.findOne({
            where: { stripePaymentIntentId: intent.id },
          });
          if (winner) return winner;
        }
        throw err;
      }
    }

    await this.refundUnissuedPass(intent, failure);
    return null;
  }

  private async refundUnissuedPass(intent: Stripe.PaymentIntent, reason: string): Promise<void> {
    this.logger.error(
      `[season-pass] PaymentIntent ${intent.id}: pass not issued (${reason}); refunding.`,
    );
    try {
      await this.stripe.refunds.create(
        { payment_intent: intent.id },
        { idempotencyKey: `refund_seasonpass_${intent.id}` },
      );
    } catch (error) {
      this.logger.error(
        `[season-pass] PaymentIntent ${intent.id}: refund FAILED, manual action required: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async findFreeSeatId(
    manager: EntityManager,
    section: string,
    seasonLabel: string,
  ): Promise<string | null> {
    const rows: Array<{ id: string }> = await manager.query(
      'SELECT s.id FROM seats s ' +
        'WHERE s.section = ? AND s.is_active = 1 ' +
        'AND NOT EXISTS (SELECT 1 FROM season_passes sp WHERE sp.seat_id = s.id AND sp.season_label = ?) ' +
        "AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.seat_id = s.id AND t.status IN ('pending_payment', 'paid', 'used')) " +
        'ORDER BY s.`row`, s.`number` LIMIT 1',
      [section, seasonLabel],
    );
    return rows[0]?.id ?? null;
  }

  private async defaultHolder(buyerId: string): Promise<PassHolder> {
    const buyer = await this.userRepository.findOne({ where: { id: buyerId } });
    return { name: buyer ? fullName(buyer) : 'Ismeretlen', userId: buyer ? buyer.id : null };
  }

  /**
   * Who will occupy the seat. Nothing given → the buyer. A name only → a
   * holder without an account (the buyer shows that QR). An email → the
   * registered account with that email (name defaults to the account's).
   */
  private async resolveHolder(buyer: User, dto: PurchaseSeasonPassDto): Promise<PassHolder> {
    const name = dto.holderName?.trim();
    const email = dto.holderEmail?.trim().toLowerCase();
    if (!name && !email) {
      return { name: fullName(buyer), userId: buyer.id };
    }
    if (email) {
      const account = await this.userRepository.findOne({ where: { email } });
      if (!account) {
        throw new NotFoundException({
          statusCode: 404,
          message:
            'Ehhez az e-mail-címhez nem tartozik fiók. Hagyd üresen az e-mail mezőt, ha a birtokosnak nincs fiókja.',
          code: 'holder_account_not_found',
        });
      }
      return { name: name || fullName(account), userId: account.id };
    }
    return { name: name!, userId: null };
  }

  /** Fail fast, before any money moves. The DB constraints remain the final word. */
  private async assertPassCanBeIssued(
    priceRow: SeasonPassPrice,
    holder: PassHolder,
    buyerId: string,
  ): Promise<void> {
    if (holder.userId) {
      const already = await this.seasonPassRepository.findOne({
        where: { holderUserId: holder.userId, seasonLabel: priceRow.seasonLabel },
      });
      if (already) {
        throw new ConflictException({
          statusCode: 409,
          // Second person when the buyer is the holder, the holder's name otherwise.
          message:
            holder.userId === buyerId
              ? 'Erre a szezonra már van bérleted.'
              : `${holder.name} nevére már van bérlet erre a szezonra.`,
          code: 'holder_already_has_pass',
        });
      }
    }
    const seatId = await this.findFreeSeatId(
      this.dataSource.manager,
      priceRow.section,
      priceRow.seasonLabel,
    );
    if (!seatId) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Ebben a szektorban nincs több szabad bérletes hely.',
        code: 'section_sold_out',
      });
    }
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
    // Passes the user manages: bought by them, or held by them (account link).
    const passes = await this.seasonPassRepository.find({
      where: [{ userId }, { holderUserId: userId }],
      relations: ['seat', 'user'],
      order: { validFrom: 'DESC', createdAt: 'ASC' },
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

  /**
   * Who may act on a pass (show its QR, lend it, withdraw a loan): the BUYER
   * (manages it, and is the only one who can act for a holder without an
   * account) and the HOLDER's account if linked. Both have equal rights.
   */
  async getManagedPass(passId: string, userId: string): Promise<SeasonPass> {
    const pass = await this.seasonPassRepository.findOne({
      where: { id: passId },
      relations: ['seat'],
    });
    if (!pass) {
      throw new NotFoundException(`Season pass ${passId} not found`);
    }
    if (pass.userId !== userId && pass.holderUserId !== userId) {
      throw new ForbiddenException('Not the buyer or holder of this season pass');
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
  ): Promise<{ ticketId: string; dataUrl: string; token: string; holderName: string }> {
    const pass = await this.getManagedPass(passId, userId);
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

    const kickoff = match.kickoffAt.getTime();
    if (kickoff < pass.validFrom.getTime() || kickoff > pass.validUntil.getTime()) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Ez a mérkőzés nem esik a bérlet érvényességi idejébe.',
        code: 'match_outside_validity',
      });
    }

    const ticket = await this.materializeSeasonPassTicket(pass, matchId);
    const result = await this.qrService.generateForTicket(ticket.id, ticket.qrJti);
    return {
      ticketId: ticket.id,
      dataUrl: result.dataUrl,
      token: result.token,
      holderName: pass.holderName,
    };
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
          throw new ConflictException({
            statusCode: 409,
            message:
              'A belépési jog átadásra került. A kölcsönzést visszavonhatod, ha vissza szeretnéd kapni a helyedet.',
            code: 'entry_transferred',
          });
        }

        const ticketRepo = manager.getRepository(Ticket);

        // Guard: a remaining LOAN Ticket means the seat was loaned and the
        // borrower may have already entered — the owner cannot reclaim it
        const loanTicket = await ticketRepo.findOne({
          where: { matchId, seatId, source: TicketSource.LOAN },
        });
        if (loanTicket) {
          throw new ConflictException({
            statusCode: 409,
            message: 'A belépési jog már felhasználásra került ennél a mérkőzésnél.',
            code: 'seat_already_used',
          });
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
    const pass = await this.getManagedPass(passId, lenderUserId);
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
    const borrowerAccount = await this.userRepository.findOne({
      where: { email: dto.borrowerEmail.toLowerCase() },
    });
    if (
      borrowerAccount &&
      (borrowerAccount.id === pass.userId || borrowerAccount.id === pass.holderUserId)
    ) {
      throw new BadRequestException('Cannot loan a pass to its own buyer or holder');
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
   * The error for an invitation that is no longer PENDING. Each terminal state
   * gets a message that says what actually happened to the invitation.
   */
  private nonPendingLoanError(status: PassLoanStatus): HttpException {
    switch (status) {
      case PassLoanStatus.OWNER_ENTERED:
        return new ConflictException({
          statusCode: 409,
          message:
            'A bérletestulajdonos már belépett erre a mérkőzésre, ezért a belépőjog nem adható át.',
          code: 'seat_already_used',
        });
      case PassLoanStatus.EXPIRED:
        return new BadRequestException({
          statusCode: 400,
          message: 'A meghívó lejárt.',
          code: 'loan_expired',
        });
      case PassLoanStatus.ACCEPTED:
      case PassLoanStatus.USED:
      case PassLoanStatus.COMPLETED:
        return new BadRequestException({
          statusCode: 400,
          message: 'A meghívót már elfogadták.',
          code: 'loan_already_accepted',
        });
      case PassLoanStatus.CANCELLED:
      case PassLoanStatus.REVOKED:
      default:
        return new BadRequestException({
          statusCode: 400,
          message: 'A meghívót visszavonták.',
          code: 'loan_revoked',
        });
    }
  }

  /**
   * Borrower-side acceptance flow.
   *
   * Inside a single transaction:
   *  1. Validates the invitation and marks the loan ACCEPTED.
   *  2. Checks the owner's SEASON_PASS Ticket status. If already USED
   *     (owner entered the stadium), the loan is marked OWNER_ENTERED and a 409
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
    // We commit the OWNER_ENTERED status first, then throw outside the transaction
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
        throw this.nonPendingLoanError(loan.status);
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
      // transferred retroactively. Mark the loan OWNER_ENTERED (terminal state; not a revocation by anyone)
      // and let the transaction commit that status before we throw 409.
      if (ownerTicket?.status === TicketStatus.USED) {
        loan.status = PassLoanStatus.OWNER_ENTERED;
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
      throw this.nonPendingLoanError(loan.status);
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
      // Buyer and holder share management rights, so either may withdraw a
      // loan (the lender may be the other one, or a holder without an account
      // acting through the buyer).
      const seasonPass = loan.seasonPass;
      const mayManage =
        loan.lenderUserId === userId ||
        seasonPass?.userId === userId ||
        seasonPass?.holderUserId === userId;
      if (!mayManage) {
        throw new ForbiddenException('Only the buyer or holder of the pass can cancel a loan');
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
