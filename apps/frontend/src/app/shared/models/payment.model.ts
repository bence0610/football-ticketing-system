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
  readonly temperatureCelsius: number;
  readonly precipitationMmPerHour: number;
  readonly precipitationProbability: number;
  readonly windSpeedMs: number;
  readonly rainWarning: boolean;
  readonly icon?: string;
  readonly fallback: boolean;
}
