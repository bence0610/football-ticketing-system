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
  readonly amount: number;
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
