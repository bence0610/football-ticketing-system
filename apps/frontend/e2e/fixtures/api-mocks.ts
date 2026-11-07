/**
 * Canonical API mock payloads for KTE Jegyportál E2E tests.
 *
 * Keeping all fixtures in one place makes it trivial to update them when
 * the DTOs change — test files import from here instead of defining
 * inline payloads.
 *
 * Updated for Iteration 3: auth, cart, payment, and weather fixtures added.
 * Updated for Iteration 4: loyalty, ticket QR, season pass, and loan fixtures added.
 */
import {
  LoyaltySnapshotResponse,
  LoyaltyTierResponse,
  LoyaltyTransactionResponse,
  TIER_COLORS,
  TIER_LABELS,
} from '../../src/app/core/models/loyalty.models';


// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export const MATCH_ID_1 = 'aaaaaaaa-0000-4000-8000-000000000001';
export const MATCH_ID_2 = 'aaaaaaaa-0000-4000-8000-000000000002';

export const FUTURE_KICKOFF_1 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
export const FUTURE_KICKOFF_2 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

export const SEAT_ID_AVAILABLE = 'cccccccc-0000-4000-8000-000000000001';
export const SEAT_ID_LOCKED = 'cccccccc-0000-4000-8000-000000000002';
export const SEAT_ID_SOLD = 'cccccccc-0000-4000-8000-000000000003';
export const SEAT_ID_ACCESSIBLE = 'cccccccc-0000-4000-8000-000000000004';
export const SEAT_ID_NON_ACCESSIBLE = 'cccccccc-0000-4000-8000-000000000005';

// ---------------------------------------------------------------------------
// Lock responses
// ---------------------------------------------------------------------------

export const OWNER_TOKEN = 'dddddddd-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const USER_ID = 'eeeeeeee-0000-4000-8000-000000000001';

export const AUTH_USER = {
  id: USER_ID,
  email: 'test@kte.hu',
  firstName: 'Teszt',
  lastName: 'Felhasználó',
  role: 'fan',
  loyaltyTier: 'bronze',
  loyaltyPoints: 120,
};

/** Full AuthResponse returned by /auth/login and /auth/register */
export const AUTH_RESPONSE = {
  accessToken: 'fake-access-token',
  refreshToken: 'fake-refresh-token',
  expiresIn: 900,
  user: AUTH_USER,
};

// ---------------------------------------------------------------------------
// Cart (pre-seeded session state for cart/checkout tests)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export const PAYMENT_INTENT_ID = 'pi_test_000000000000001';

export const PAYMENT_INTENT_RESPONSE = {
  paymentIntentId: PAYMENT_INTENT_ID,
  clientSecret: 'pi_test_000000000000001_secret_abc',
  currency: 'huf',
  amount: 3500,
  lineItems: [
    {
      seatId: SEAT_ID_AVAILABLE,
      section: 'A',
      row: '1',
      seatNumber: 5,
      price: 3500,
    },
  ],
};

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export const WEATHER_RAIN_WARNING = {
  matchId: MATCH_ID_1,
  city: 'Kecskemét',
  forecastFor: FUTURE_KICKOFF_1,
  summary: 'Eső várható',
  temperatureCelsius: 14,
  precipitationMmPerHour: 3.2,
  precipitationProbability: 0.85,
  windSpeedMs: 5.1,
  rainWarning: true,
  icon: 'rain',
  fallback: false,
};

export const WEATHER_CLEAR = {
  matchId: MATCH_ID_1,
  city: 'Kecskemét',
  forecastFor: FUTURE_KICKOFF_1,
  summary: 'Derült',
  temperatureCelsius: 22,
  precipitationMmPerHour: 0,
  precipitationProbability: 0.05,
  windSpeedMs: 2.0,
  rainWarning: false,
  icon: 'clear',
  fallback: false,
};

// ---------------------------------------------------------------------------
// Iteration 4: Loyalty (KTE-044 / KTE-045 / KTE-046)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Iteration 4: Auth variants for discount tests (KTE-046)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Iteration 4: Ticket QR endpoint (KTE-041)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Iteration 4: Season Passes & Loans (KTE-049 / KTE-051 / KTE-054)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Iteration 5: Waitlist (KTE-057)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Iteration 5: Chatbot (KTE-059)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Iteration 5: Admin (KTE-061, KTE-062, KTE-063)
// ---------------------------------------------------------------------------