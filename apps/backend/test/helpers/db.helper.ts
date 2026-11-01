import { randomUUID } from 'crypto';
import { hash } from 'bcrypt';
import { DataSource } from 'typeorm';
import {
  Competition,
  LoyaltyTier,
  Match,
  MatchStatus,
  Seat,
  SeatCategory,
  SeasonPass,
  SeasonPassStatus,
  User,
  UserRole,
} from '../../src/database/entities';

/**
 * Order matters: parent rows (users, matches, seats) must be removed last
 * so FK constraints on their children (tickets, loyalty_transactions,
 * pass_loans, season_passes, waitlist) do not reject the DELETE.
 *
 * We use `DELETE` + `SET FOREIGN_KEY_CHECKS = 0` wrapping around the
 * whole operation because `TRUNCATE` cannot run while FKs reference the
 * table, and the production schema has several FKs that would require a
 * careful dance of TRUNCATE statements. DELETE performs well enough for
 * the per-test cleanup budget.
 */
const DATA_TABLES: readonly string[] = [
  'loyalty_transactions',
  'pass_loans',
  'tickets',
  'season_passes',
  'season_pass_prices',
  'waitlist',
  'users',
  'seats',
  'matches',
];

export async function truncateAll(dataSource: DataSource): Promise<void> {
  // All commands must run on the SAME connection so that the session-level
  // FOREIGN_KEY_CHECKS=0 actually applies to the subsequent DELETEs.
  // Using the shared pool would route each query to an arbitrary connection
  // where FK checks are still enabled, causing DELETE to fail on tables
  // that are referenced by others (e.g. seats ← tickets).
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  try {
    await qr.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of DATA_TABLES) {
      await qr.query(`DELETE FROM \`${table}\``);
    }
  } finally {
    await qr.query('SET FOREIGN_KEY_CHECKS = 1');
    await qr.release();
  }
}

export interface MinimalFixture {
  match: Match;
  seatA: Seat;
  seatB: Seat;
}

/**
 * Inserts the smallest viable fixture for a purchase flow:
 *   - one `on_sale` match priced at 5000 HUF
 *   - two active, standard-category seats on the same section/row.
 *
 * The seats share a `priceModifier` of 1.00 so the server-computed
 * total matches the match's `basePrice` exactly, which lets the suite
 * assert on an unambiguous `amount` field in the PaymentIntent response.
 */
export async function seedMinimalFixture(dataSource: DataSource): Promise<MinimalFixture> {
  const matchRepo = dataSource.getRepository(Match);
  const seatRepo = dataSource.getRepository(Seat);

  const kickoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const match = await matchRepo.save(
    matchRepo.create({
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'E2E Rivals',
      competition: Competition.NB1,
      venue: 'Széktói Stadion',
      kickoffAt: kickoff,
      status: MatchStatus.ON_SALE,
      capacity: 2,
      basePrice: '5000.00',
      isSeasonPassEligible: false,
    }),
  );

  const seatA = await seatRepo.save(
    seatRepo.create({
      section: 'A',
      row: '1',
      number: 1,
      category: SeatCategory.STANDARD,
      priceModifier: '1.00',
      isAccessible: false,
      isActive: true,
    }),
  );
  const seatB = await seatRepo.save(
    seatRepo.create({
      section: 'A',
      row: '1',
      number: 2,
      category: SeatCategory.STANDARD,
      priceModifier: '1.00',
      isAccessible: false,
      isActive: true,
    }),
  );

  return { match, seatA, seatB };
}

export interface SeasonPassFixture {
  pass: SeasonPass;
}

/**
 * Creates an ACTIVE season pass directly in the DB, linked to the given
 * user and seat. Used by E2E tests that need to skip the Stripe payment flow.
 */
export async function seedSeasonPass(
  dataSource: DataSource,
  options: {
    userId: string;
    seatId: string;
    holderName?: string;
    /** Defaults to the buyer; pass `null` for a holder without an account. */
    holderUserId?: string | null;
  },
): Promise<SeasonPass> {
  const repo = dataSource.getRepository(SeasonPass);
  return repo.save(
    repo.create({
      userId: options.userId,
      holderName: options.holderName ?? 'Teszt Felhasználó',
      holderUserId: options.holderUserId === undefined ? options.userId : options.holderUserId,
      seatId: options.seatId,
      seasonLabel: '2026/2027',
      validFrom: new Date('2026-07-01'),
      validUntil: new Date('2027-06-30'),
      status: SeasonPassStatus.ACTIVE,
      pricePaid: '30000.00',
      currency: 'HUF',
      qrCode: `KTE-SP-${randomUUID()}`,
      autoRenew: false,
    }),
  );
}

export interface GateUserFixture {
  user: User;
  plainPassword: string;
}

/**
 * Creates a gate operator user directly in the DB (bypassing the fan-only
 * registration endpoint) so the scan tests can authenticate as `gate`.
 * Returns the plain password so callers can POST /api/auth/login with it.
 */
export async function createGateUser(
  dataSource: DataSource,
  overrides: Partial<Pick<User, 'email' | 'firstName' | 'lastName'>> = {},
): Promise<GateUserFixture> {
  const userRepo = dataSource.getRepository(User);
  const plainPassword = 'GatePass123';
  const passwordHash = await hash(plainPassword, 10);

  const user = await userRepo.save(
    userRepo.create({
      email: overrides.email ?? 'gate@kte.hu',
      passwordHash,
      firstName: overrides.firstName ?? 'Gate',
      lastName: overrides.lastName ?? 'Operator',
      role: UserRole.GATE,
      loyaltyTier: LoyaltyTier.BRONZE,
      loyaltyPoints: 0,
      emailVerified: true,
      twoFactorEnabled: false,
      isActive: true,
    }),
  );
  return { user, plainPassword };
}
