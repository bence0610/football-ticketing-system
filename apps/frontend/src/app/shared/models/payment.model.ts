export interface PaymentIntentSeatLine {
  readonly seatId: string;
  readonly section: string;
  readonly row: string;
  readonly seatNumber: number;
  readonly price: number;
}

export interface PaymentIntentResponse {
  readonly paymentIntentId: string;
  readonly clientSecret: string;
  readonly currency: string;
  /** HUF actually charged (server-computed, after the loyalty discount). Display this; never compute it. */
  readonly amount: number;
  /** HUF list-price sum before the discount (server-computed; amount + discountAmount). */
  readonly subtotal: number;
  /** Loyalty tier discount in percent, as applied by the server. */
  readonly discountPercent: number;
  /** HUF taken off the subtotal by the server. */
  readonly discountAmount: number;
  readonly lineItems: readonly PaymentIntentSeatLine[];
}

export interface CreatePaymentIntentRequest {
  readonly matchId: string;
  readonly seats: readonly { seatId: string; ownerToken: string }[];
}

export interface ConfirmPaymentResponse {
  /** True if the Stripe webhook already finalized this PaymentIntent. */
  readonly alreadyProcessed: boolean;
  /** Ticket ids belonging to the PaymentIntent (existing or freshly created). */
  readonly ticketIds: readonly string[];
}

export type PaymentStatusKind = 'issued' | 'processing' | 'failed';

/** GET /payments/:paymentIntentId/status - amount and points come from the server's records. */
export interface PaymentStatusResponse {
  readonly status: PaymentStatusKind;
  readonly ticketIds: readonly string[];
  /** HUF actually paid; 0 until issued. */
  readonly amountPaid: number;
  readonly currency: string;
  /** Points credited for these tickets (loyalty ledger); 0 until credited. */
  readonly pointsCredited: number;
  /**
   * When the confirmation email was handed to the mail server. Null until it
   * has been sent (it goes out shortly AFTER the tickets are issued, and may
   * never go out): only a set value allows saying an email was sent.
   */
  readonly confirmationEmailSentAt?: string | null;
  readonly match: {
    readonly id: string;
    readonly homeTeam: string;
    readonly awayTeam: string;
    readonly venue: string;
    readonly kickoffAt: string;
  } | null;
  readonly seats: readonly {
    readonly section: string;
    readonly row: string;
    readonly number: number;
    readonly price: number;
  }[];
}

export interface MatchWeatherForecast {
  readonly matchId: string;
  readonly city: string;
  readonly forecastFor: string;
  readonly summary: string;
  /** The numbers are null when there is no forecast (`fallback: true`). */
  readonly temperatureCelsius: number | null;
  readonly precipitationMmPerHour: number | null;
  readonly precipitationProbability: number | null;
  readonly windSpeedMs: number | null;
  readonly rainWarning: boolean;
  readonly icon?: string;
  /** True when there is no usable forecast; see `unavailableReason`. */
  readonly fallback: boolean;
  readonly unavailableReason?: WeatherUnavailableReason;
}

/** too_far: kickoff is beyond the forecast range; past: already started; no_data: provider has none. */
export type WeatherUnavailableReason = 'too_far' | 'past' | 'no_data';
