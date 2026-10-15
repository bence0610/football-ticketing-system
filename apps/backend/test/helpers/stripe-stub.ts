import { randomBytes } from 'crypto';
import Stripe from 'stripe';
import { TEST_WEBHOOK_SECRET } from '../setup/test-env';

export interface StripeStubMetadata {
  userId?: string;
  matchId?: string;
  seatIds?: string;
  ownerTokens?: string;
  [key: string]: string | undefined;
}

export interface StubbedPaymentIntent {
  id: string;
  object: 'payment_intent';
  client_secret: string;
  status: 'requires_payment_method' | 'succeeded';
  amount: number;
  currency: string;
  metadata: StripeStubMetadata;
  description?: string;
}

type CreateArgs = Stripe.PaymentIntentCreateParams;

/**
 * In-memory stand-in for the Stripe SDK. Mirrors the subset of the API
 * `PaymentsService` touches:
 *   - `paymentIntents.create` (idempotent on the second param's key)
 *   - `paymentIntents.retrieve` (returns status === 'succeeded')
 *   - `webhooks.constructEvent` (delegates to the real Stripe verifier)
 *
 * The real signature verifier is reused so the webhook endpoint still
 * exercises its full validation path — only the HTTP call to Stripe is
 * stubbed out.
 */
export class StripeStub {
  private readonly intentsById = new Map<string, StubbedPaymentIntent>();
  private readonly intentsByIdempotencyKey = new Map<string, StubbedPaymentIntent>();

  public readonly paymentIntentsCreateMock = jest.fn(
    async (params: CreateArgs, options?: Stripe.RequestOptions): Promise<StubbedPaymentIntent> => {
      const idempotencyKey = options?.idempotencyKey;
      if (idempotencyKey) {
        const cached = this.intentsByIdempotencyKey.get(idempotencyKey);
        if (cached) {
          return cached;
        }
      }

      const id = `pi_test_${randomBytes(12).toString('hex')}`;
      const intent: StubbedPaymentIntent = {
        id,
        object: 'payment_intent',
        client_secret: `${id}_secret_${randomBytes(8).toString('hex')}`,
        status: 'requires_payment_method',
        amount: params.amount ?? 0,
        currency: params.currency ?? 'huf',
        metadata: this.coerceMetadata(params.metadata),
        description: params.description,
      };

      this.intentsById.set(id, intent);
      if (idempotencyKey) {
        this.intentsByIdempotencyKey.set(idempotencyKey, intent);
      }
      return intent;
    },
  );

  public readonly paymentIntentsRetrieveMock = jest.fn(
    async (id: string): Promise<StubbedPaymentIntent> => {
      const stored = this.intentsById.get(id);
      if (!stored) {
        throw new Error(`No such payment_intent: ${id}`);
      }
      return { ...stored, status: 'succeeded' };
    },
  );

  public readonly paymentIntents = {
    create: this.paymentIntentsCreateMock,
    retrieve: this.paymentIntentsRetrieveMock,
  };

  public readonly webhooks = {
    constructEvent: (
      rawBody: Buffer | string,
      signature: string | Buffer,
      secret: string,
    ): Stripe.Event => {
      // Delegate to the real Stripe signature verifier so the webhook
      // endpoint still rejects tampered payloads.
      return Stripe.webhooks.constructEvent(rawBody, signature, secret);
    },
  };

  /**
   * Returns the PaymentIntent snapshot that the service stored for the
   * given id. Tests use this to build a matching Stripe webhook payload
   * (so the metadata — userId, matchId, seat ids, owner tokens — matches
   * what the finalisation path expects).
   */
  getStoredIntent(id: string): StubbedPaymentIntent | undefined {
    return this.intentsById.get(id);
  }

  /**
   * Mutates a stored intent so the test can mark it as succeeded before
   * constructing the webhook event payload.
   */
  markSucceeded(id: string): StubbedPaymentIntent {
    const intent = this.intentsById.get(id);
    if (!intent) {
      throw new Error(`markSucceeded: no stored intent ${id}`);
    }
    intent.status = 'succeeded';
    return intent;
  }

  private coerceMetadata(metadata: Stripe.MetadataParam | null | undefined): StripeStubMetadata {
    if (!metadata) {
      return {};
    }
    const result: StripeStubMetadata = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value == null) {
        continue;
      }
      result[key] = String(value);
    }
    return result;
  }
}

/**
 * Builds a Stripe signature header for the given raw payload against the
 * configured webhook secret. Delegates to Stripe's own helper so the
 * resulting header is byte-for-byte compatible with real production
 * traffic.
 */
export function buildStripeWebhookHeader(
  rawBody: string | Buffer,
  secret: string = TEST_WEBHOOK_SECRET,
): string {
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
}

/**
 * Produces a canonical `payment_intent.succeeded` event body for the
 * stored PaymentIntent. Mirrors the fields the service reads
 * (`id`, `metadata`, `status`).
 */
export function buildPaymentIntentSucceededEvent(intent: StubbedPaymentIntent): Stripe.Event {
  const event = {
    id: `evt_test_${randomBytes(12).toString('hex')}`,
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: intent.id,
        object: 'payment_intent',
        amount: intent.amount,
        currency: intent.currency,
        status: 'succeeded',
        metadata: intent.metadata,
        description: intent.description,
      },
    },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    type: 'payment_intent.succeeded',
  } as unknown as Stripe.Event;
  return event;
}
