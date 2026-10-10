import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import Stripe from 'stripe';
import { DataSource, In, Repository } from 'typeorm';
import { LoyaltyConfig, MailConfig, StripeConfig } from '../../config';
import {
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  Match,
  Seat,
  Ticket,
  TicketSource,
  TicketStatus,
} from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { SeatLockService } from '../../redis/seat-lock.service';
import { EmailService } from '../email/email.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SeatAvailability } from '../seats/dto';
import { SeatsService } from '../seats/seats.service';
import { QrService } from '../qr/qr.service';
import { TicketRendererService } from '../tickets/ticket-renderer.service';
import {
  CreatePaymentIntentDto,
  PaymentIntentResponseDto,
  PaymentIntentSeatDto,
  PaymentIntentSeatLineDto,
} from './dto';
import { STRIPE_CLIENT } from './stripe.provider';

interface SeatLine {
  seat: Seat;
  ownerToken: string;
  price: number;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly currency: string;
  private readonly webhookSecret: string;
  private readonly loyaltyConfig: LoyaltyConfig;
  private readonly mailConfig: MailConfig;

  constructor(
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(Seat) private readonly seatRepository: Repository<Seat>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly seatLockService: SeatLockService,
    private readonly seatsService: SeatsService,
    private readonly dataSource: DataSource,
    private readonly loyaltyService: LoyaltyService,
    private readonly qrService: QrService,
    private readonly emailService: EmailService,
    private readonly ticketRenderer: TicketRendererService,
    configService: ConfigService,
  ) {
    const stripeConfig = configService.getOrThrow<StripeConfig>('stripe');
    this.currency = stripeConfig.currency;
    this.webhookSecret = stripeConfig.webhookSecret;
    this.loyaltyConfig = configService.getOrThrow<LoyaltyConfig>('loyalty');
    this.mailConfig = configService.getOrThrow<MailConfig>('mail');
  }

  async createPaymentIntent(
    userId: string,
    dto: CreatePaymentIntentDto,
  ): Promise<PaymentIntentResponseDto> {
    const match = await this.matchRepository.findOne({ where: { id: dto.matchId } });
    if (!match) {
      throw new NotFoundException('Meccs nem található.');
    }

    const lines = await this.assertSeatsAvailable(dto.matchId, dto.seats, match);

    const totalAmount = lines.reduce((acc, line) => acc + line.price, 0);
    if (totalAmount <= 0) {
      throw new BadRequestException('Érvénytelen összeg.');
    }

    const idempotencyKey = `intent_${userId}_${dto.matchId}_${dto.seats
      .map((s) => s.seatId)
      .sort()
      .join('_')}`;

    const stripeAmount = this.toStripeAmount(totalAmount);
    this.logger.debug(
      `Creating PaymentIntent amount=${stripeAmount} currency=${this.currency} user=${userId} match=${dto.matchId}`,
    );

    const intent = await this.stripe.paymentIntents.create(
      {
        amount: stripeAmount,
        currency: this.currency,
        automatic_payment_methods: { enabled: true },
        metadata: {
          userId,
          matchId: dto.matchId,
          seatIds: dto.seats.map((s) => s.seatId).join(','),
          ownerTokens: dto.seats.map((s) => s.ownerToken).join(','),
        },
        description: `KTE Jegyportál — ${match.homeTeam} vs ${match.awayTeam}`,
      },
      { idempotencyKey },
    );

    if (!intent.client_secret) {
      throw new ConflictException('A fizetési szándék nem hozott létre client_secret-et.');
    }

    const lineItems: PaymentIntentSeatLineDto[] = lines.map(({ seat, price }) => ({
      seatId: seat.id,
      section: seat.section,
      row: seat.row,
      seatNumber: seat.number,
      price,
    }));

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      currency: this.currency,
      amount: totalAmount,
      lineItems,
    };
  }

  /**
   * Verifies the Stripe webhook signature using the raw request body and
   * delegates handling to {@link handleEvent}.
   */
  constructEvent(rawBody: Buffer | string, signature: string | string[] | undefined): Stripe.Event {
    if (!signature) {
      throw new BadRequestException('Hiányzó Stripe-Signature fejléc.');
    }
    try {
      return this.stripe.webhooks.constructEvent(
        rawBody,
        Array.isArray(signature) ? signature[0] : signature,
        this.webhookSecret,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Webhook signature verification failed: ${message}`);
      throw new BadRequestException(`Érvénytelen webhook aláírás: ${message}`);
    }
  }

  async handleEvent(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSuccess(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'charge.dispute.created':
        this.logger.warn(`Dispute opened: ${event.id}`);
        break;
      default:
        this.logger.debug(`Ignoring Stripe event ${event.type}`);
    }
  }

  /**
   * Idempotently turn a successful PaymentIntent into Ticket rows, award
   * loyalty points, and release the corresponding Redis locks.
   *
   * Each created ticket is given a freshly generated `qrJti` so it satisfies
   * the NOT NULL constraint on `tickets.qr_jti` and so QR generation works
   * out-of-the-box from the user's profile page.
   *
   * Loyalty points are awarded after the transaction commits to keep the
   * award idempotent through the LoyaltyService's `(source, referenceId)`
   * uniqueness — repeat webhook deliveries for the same PaymentIntent are
   * safe.
   */
  private async handlePaymentSuccess(intent: Stripe.PaymentIntent): Promise<void> {
    await this.finalizePaymentIntent(intent);
  }

  /**
   * Frontend-driven counterpart to the Stripe webhook for {@code payment_intent.succeeded}.
   *
   * Called by the checkout page immediately after `stripe.confirmPayment()`
   * resolves with `paymentIntent.status === 'succeeded'`. In development the
   * Stripe CLI listener can be flaky, so relying solely on the webhook leaves
   * the user staring at an empty profile. This endpoint authoritatively
   * retrieves the PaymentIntent server-side to verify it really succeeded
   * (the client cannot fabricate a `succeeded` status), then runs the same
   * idempotent finalization logic as the webhook.
   *
   * Idempotency: if tickets already exist for this PaymentIntent (e.g. the
   * webhook beat us to it), no duplicates are created — the existing rows
   * are returned and `alreadyProcessed` is set to true.
   *
   * The webhook handler still works as a fallback / source of truth.
   */
  async confirmPaymentAndCreateTicket(
    paymentIntentId: string,
    userId: string,
  ): Promise<{ alreadyProcessed: boolean; ticketIds: string[] }> {
    if (!paymentIntentId) {
      throw new BadRequestException('Hiányzó paymentIntentId.');
    }

    let intent: Stripe.PaymentIntent;
    try {
      intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Stripe paymentIntents.retrieve failed for ${paymentIntentId}: ${message}`);
      throw new BadRequestException(`A fizetési szándék nem található: ${message}`);
    }

    if (intent.status !== 'succeeded') {
      this.logger.warn(
        `confirmPaymentAndCreateTicket called for ${paymentIntentId} with status=${intent.status}`,
      );
      throw new BadRequestException(`A fizetés még nem sikerült (státusz: ${intent.status}).`);
    }

    const intentUserId = intent.metadata.userId;
    if (intentUserId && intentUserId !== userId) {
      this.logger.warn(
        `User ${userId} attempted to confirm payment ${paymentIntentId} owned by ${intentUserId}.`,
      );
      throw new BadRequestException('A fizetés nem ehhez a felhasználóhoz tartozik.');
    }

    const existing = await this.ticketRepository.find({
      where: { stripePaymentIntentId: intent.id },
      select: ['id'],
    });
    if (existing.length > 0) {
      this.logger.log(
        `confirmPaymentAndCreateTicket: ${paymentIntentId} already processed (${existing.length} ticket(s)).`,
      );
      return { alreadyProcessed: true, ticketIds: existing.map((t) => t.id) };
    }

    const created = await this.finalizePaymentIntent(intent);
    return { alreadyProcessed: false, ticketIds: created.map((t) => t.id) };
  }

  /**
   * Shared finalization path used by both the Stripe webhook
   * ({@link handlePaymentSuccess}) and the frontend-driven confirm endpoint
   * ({@link confirmPaymentAndCreateTicket}). Whichever path arrives first
   * persists the tickets; the other path observes the existing rows and
   * runs only the idempotent post-steps (lock release, loyalty award).
   */
  private async finalizePaymentIntent(intent: Stripe.PaymentIntent): Promise<Ticket[]> {
    const userId = intent.metadata.userId;
    const matchId = intent.metadata.matchId;
    const seatIds = (intent.metadata.seatIds ?? '').split(',').filter(Boolean);
    const ownerTokens = (intent.metadata.ownerTokens ?? '').split(',').filter(Boolean);

    if (!userId || !matchId || seatIds.length === 0) {
      this.logger.error(
        `PaymentIntent ${intent.id} missing metadata: ${JSON.stringify(intent.metadata)}`,
      );
      return [];
    }

    const existing = await this.ticketRepository.find({
      where: { stripePaymentIntentId: intent.id },
      select: ['id', 'userId'],
    });
    let createdTickets: Ticket[];
    if (existing.length > 0) {
      this.logger.log(
        `PaymentIntent ${intent.id} already produced tickets — running idempotent post-steps.`,
      );
      createdTickets = await this.ticketRepository.find({
        where: { stripePaymentIntentId: intent.id },
      });
    } else {
      const match = await this.matchRepository.findOne({ where: { id: matchId } });
      if (!match) {
        this.logger.error(`PaymentIntent ${intent.id} references missing match ${matchId}`);
        return [];
      }

      const seats = await this.seatRepository.find({ where: { id: In(seatIds) } });
      const seatById = new Map(seats.map((s) => [s.id, s]));
      const basePrice = Number(match.basePrice);

      createdTickets = await this.dataSource.transaction(async (em) => {
        const persisted: Ticket[] = [];
        for (const seatId of seatIds) {
          const seat = seatById.get(seatId);
          if (!seat) {
            this.logger.error(`Seat ${seatId} missing while finalizing payment ${intent.id}`);
            continue;
          }
          const price = Math.round(basePrice * Number(seat.priceModifier));
          const ticket = em.create(Ticket, {
            matchId,
            seatId,
            userId,
            status: TicketStatus.PAID,
            source: TicketSource.SINGLE,
            pricePaid: price.toFixed(2),
            currency: 'HUF',
            qrCode: `KTE-${randomUUID()}`,
            qrJti: this.qrService.generateJti(),
            stripePaymentIntentId: intent.id,
          });
          const saved = await em.save(Ticket, ticket);
          persisted.push(saved);
        }
        return persisted;
      });
    }

    // Release any seat lock the buyer owned. Run regardless of whether the
    // tickets were just created or already existed — repeat webhook deliveries
    // must still cleanly release stale locks.
    await Promise.all(
      seatIds.map((seatId, idx) => {
        const ownerToken = ownerTokens[idx];
        if (!ownerToken) {
          return Promise.resolve(false);
        }
        return this.seatLockService.release(matchId, seatId, ownerToken).catch((error: unknown) => {
          this.logger.warn(
            `Seat lock release failed match=${matchId} seat=${seatId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return false;
        });
      }),
    );

    try {
      await this.redis.del(RedisKeys.seatLockOwner(matchId, userId));
    } catch (error) {
      this.logger.warn(
        `Failed to clear seat-lock-owner hash user=${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Award loyalty points (one EARN transaction per ticket). The service is
    // idempotent through `(source, referenceId)`, so retried Stripe webhook
    // deliveries do not double-credit the user.
    for (const ticket of createdTickets) {
      try {
        await this.loyaltyService.award({
          userId: ticket.userId,
          type: LoyaltyTransactionType.EARN,
          source: LoyaltyTransactionSource.TICKET_PURCHASE,
          points: this.loyaltyConfig.ticketPointsPerTicket,
          referenceId: `ticket:${ticket.id}`,
          description: 'Jegyvásárlás bónusz',
        });
      } catch (error) {
        this.logger.error(
          `Loyalty award failed for ticket=${ticket.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Schedule the confirmation email after this function returns so the
    // webhook response is never held up by SMTP latency or retries.
    setImmediate(() => {
      this.sendConfirmationEmails(intent.id, createdTickets).catch((error: unknown) => {
        this.logger.error(
          `Confirmation email dispatch failed for payment ${intent.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    });

    this.logger.log(
      `Finalized payment ${intent.id}: ${createdTickets.length} ticket(s) PAID for user ${userId}, loyalty awarded.`,
    );
    return createdTickets;
  }

  /**
   * Sends one `ticket-confirmation` email per distinct buyer in the given
   * ticket set, guarded by `confirmationEmailSentAt` so repeated Stripe
   * webhook deliveries never produce duplicates.
   *
   * The relations (`user`, `match`, `seat`) required by the renderer and
   * template are reloaded here because callers of `finalizePaymentIntent`
   * work with ticket entities that may not have these populated.
   */
  private async sendConfirmationEmails(
    paymentIntentId: string,
    createdTickets: Ticket[],
  ): Promise<void> {
    if (createdTickets.length === 0) {
      return;
    }

    const ticketsWithRelations = await this.ticketRepository.find({
      where: { stripePaymentIntentId: paymentIntentId },
      relations: ['user', 'match', 'seat'],
    });
    if (ticketsWithRelations.length === 0) {
      return;
    }

    const grouped = new Map<string, Ticket[]>();
    for (const ticket of ticketsWithRelations) {
      const bucket = grouped.get(ticket.userId) ?? [];
      bucket.push(ticket);
      grouped.set(ticket.userId, bucket);
    }

    for (const [userId, userTickets] of grouped) {
      const alreadySent = userTickets.some((t) => t.confirmationEmailSentAt != null);
      if (alreadySent) {
        this.logger.log(
          `Confirmation email skipped (already sent) user=${userId} payment=${paymentIntentId}`,
        );
        continue;
      }

      const first = userTickets[0];
      if (!first.user || !first.match) {
        this.logger.warn(
          `Confirmation email skipped (missing relations) user=${userId} payment=${paymentIntentId}`,
        );
        continue;
      }
      if (userTickets.some((t) => !t.seat)) {
        this.logger.warn(
          `Confirmation email skipped (missing seat relation) user=${userId} payment=${paymentIntentId}`,
        );
        continue;
      }

      // Acquire a per-user distributed lock so two concurrent webhook
      // redeliveries of the same event cannot both send the email.
      // TTL covers the maximum time needed: two send attempts + buffer.
      const lockKey = RedisKeys.emailConfirmLock(paymentIntentId, userId);
      const lockTtlSec = Math.ceil((this.mailConfig.retryDelayMs * 2) / 1000) + 30;
      const lockAcquired = await this.redis.set(lockKey, '1', 'EX', lockTtlSec, 'NX');
      if (!lockAcquired) {
        this.logger.log(
          `Confirmation email send already in progress user=${userId} payment=${paymentIntentId} — skipping`,
        );
        continue;
      }

      try {
        // Re-check the flag inside the lock to close the read→acquire race.
        const recheck = await this.ticketRepository.find({
          where: { stripePaymentIntentId: paymentIntentId, userId },
          select: ['id', 'confirmationEmailSentAt'],
        });
        if (recheck.some((t) => t.confirmationEmailSentAt != null)) {
          this.logger.log(
            `Confirmation email skipped (already sent, re-check) user=${userId} payment=${paymentIntentId}`,
          );
          continue;
        }

        const matchSummary = this.ticketRenderer.matchSummary(first.match);
        const sections = userTickets.map((t) => this.ticketRenderer.renderTicketSection(t));
        const qrImageDataUrls = await Promise.all(
          userTickets.map(async (t) => {
            const result = await this.qrService.generateForTicket(t.id, t.qrJti);
            return {
              ticketId: t.id,
              seatLabel: t.seat ? this.ticketRenderer.formatSeat(t.seat) : '',
              dataUrl: result.dataUrl,
            };
          }),
        );

        await this.emailService.send({
          to: first.user.email,
          subject: `Jegy visszaigazolás - ${matchSummary.title}`,
          template: 'ticket-confirmation',
          context: {
            recipientName: first.user.firstName,
            matchTitle: matchSummary.title,
            matchVenue: matchSummary.venue,
            matchKickoffLabel: matchSummary.kickoffLabel,
            tickets: sections,
            totalLabel: this.ticketRenderer.computeTotal(userTickets),
            ticketsUrl: `${this.mailConfig.baseUrl}/profile`,
            qrImageDataUrls,
          },
          correlationId: `ticket-confirmation:${paymentIntentId}:${userId}`,
        });

        const sentAt = new Date();
        await this.ticketRepository
          .createQueryBuilder()
          .update(Ticket)
          .set({ confirmationEmailSentAt: sentAt })
          .whereInIds(userTickets.map((t) => t.id))
          .execute();

        this.logger.log(
          `Confirmation email sent user=${userId} payment=${paymentIntentId} tickets=${userTickets.length}`,
        );
      } catch (error) {
        this.logger.error(
          `Confirmation email failed user=${userId} payment=${paymentIntentId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        await this.redis.del(lockKey).catch(() => undefined);
      }
    }
  }

  private async handlePaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
    const matchId = intent.metadata.matchId;
    const seatIds = (intent.metadata.seatIds ?? '').split(',').filter(Boolean);
    const ownerTokens = (intent.metadata.ownerTokens ?? '').split(',').filter(Boolean);
    if (!matchId || seatIds.length === 0) {
      return;
    }

    // KTE-037: extend each seat lock by 120 seconds so the user can retry.
    await Promise.all(
      seatIds.map((seatId, idx) => {
        const ownerToken = ownerTokens[idx];
        if (!ownerToken) {
          return Promise.resolve(false);
        }
        return this.seatLockService.extend(matchId, seatId, ownerToken, 120);
      }),
    );
    this.logger.warn(
      `payment_intent.payment_failed ${intent.id} — extended ${seatIds.length} seat lock(s) by 120s.`,
    );
  }

  /**
   * Validates that every seat in the request is still locked by the caller,
   * not yet sold, not season-pass-held, not inactive, and resolves their
   * server-authoritative price.
   *
   * Calls SeatsService.resolveAvailabilityForSeats so the rule lives in one
   * place. The DB + Redis queries run at payment time, guarding against races
   * that occurred after the initial seat lock.
   */
  private async assertSeatsAvailable(
    matchId: string,
    requested: PaymentIntentSeatDto[],
    match: Match,
  ): Promise<SeatLine[]> {
    const seatIds = requested.map((r) => r.seatId);
    const seats = await this.seatRepository.find({
      where: { id: In(seatIds) },
    });
    if (seats.length !== requested.length) {
      throw new BadRequestException('Egy vagy több szék nem található.');
    }

    const availability = await this.seatsService.resolveAvailabilityForSeats(matchId, seatIds);
    for (const seat of seats) {
      const seatStatus = availability.get(seat.id);
      if (seatStatus === SeatAvailability.DISABLED) {
        throw new ConflictException(
          `Ez a hely nem foglalható (${seat.section}-${seat.row}-${seat.number}).`,
        );
      }
      if (seatStatus === SeatAvailability.SOLD) {
        throw new ConflictException('Ez a hely már elkelt.');
      }
      if (seatStatus === SeatAvailability.SEASON_PASS) {
        throw new ConflictException('Ez a hely bérletes hely.');
      }
    }

    const lines: SeatLine[] = [];
    const basePrice = Number(match.basePrice);
    for (const item of requested) {
      const seat = seats.find((s) => s.id === item.seatId);
      if (!seat) {
        throw new BadRequestException(`Szék nem található: ${item.seatId}`);
      }

      const lockKey = RedisKeys.seatLock(matchId, item.seatId);
      const stored = await this.redis.get(lockKey);
      if (!stored) {
        throw new ConflictException(
          `A szék zárolása lejárt (${seat.section}-${seat.row}-${seat.number}).`,
        );
      }
      if (stored !== item.ownerToken) {
        throw new ConflictException(
          `A szék zárolása már másé (${seat.section}-${seat.row}-${seat.number}).`,
        );
      }

      const modifier = Number(seat.priceModifier);
      const price = Math.round(basePrice * modifier);
      this.logger.debug(
        `Seat ${seat.id} base=${basePrice} modifier=${modifier} unitPrice=${price}`,
      );
      lines.push({ seat, ownerToken: item.ownerToken, price });
    }
    return lines;
  }

  private toStripeAmount(huf: number): number {
    // Stripe's API treats HUF as a 2-decimal currency (smallest unit = fillér),
    // even though HUF is real-life zero-decimal. A 6 750 HUF charge must be
    // submitted as 675 000. Without the * 100 conversion Stripe interprets the
    // value as 67.50 HUF and rejects it (minimum charge is 175 HUF).
    return Math.round(huf) * 100;
  }
}
