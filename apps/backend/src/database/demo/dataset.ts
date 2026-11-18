import { LoyaltyTier, UserRole } from '../entities/user.entity';
import { seatUnitPrice } from '../../modules/seats/seat-pricing';
import { formatFullName } from '../../common/format-name';
import { TIER_LABEL } from '../stadium-layout';
import { blurbFor } from './blurbs';
import {
  BASE_OCCUPANCY,
  FULLEST_SHARE,
  UPCOMING_VIP_CAP,
  SeatPool,
  SeatRef,
  SectorRef,
  Stadium,
  placeOrders,
  sampleLeadDays,
  sectorWeights,
  soldShareAt,
} from './demand';
import { LedgerRow, LoyaltyEvent, LoyaltyRules, simulateLoyalty } from './ledger';
import { planLoans } from './loans';
import type {
  DemoLoan,
  DemoPass,
  DemoUser,
  ForcedOrder,
  LoanRow,
  MatchRow,
  NamedAccount,
  PassRow,
  PassTier,
  PriceRow,
  TicketRow,
  UserRow,
  WaitlistRow,
} from './model';
import { PASS_TIERS, buildPasses } from './passes';
import { Rng } from './rng';
import {
  MatchPlan,
  awayTeamOf,
  buildSchedule,
  homeTeamOf,
  olderSeasons,
  venueFor,
} from './schedule';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  dayNumberOf,
  dayNumberOfDateColumn,
  monthOf,
  wallClockToUtc,
} from './time';
import { CLASS_WEIGHT, buildUsers } from './users';

export const DEFAULT_CROWD_SIZE = 3000;
export const DEFAULT_SEED = 20261116;
/** Nobody owns a hundred tickets: no crowd account is given more than this in one season... */
export const SEASON_TICKET_CAP = 50;
/** ...or in the two seasons together. */
export const LIFETIME_TICKET_CAP = 85;
/**
 * The portal was newer last season, so fewer of the crowd's tickets went through it: the
 * previous season sells this share of what a current-season match of the same pull would.
 */
export const PREVIOUS_SEASON_SHARE = 0.8;
/**
 * Two seasons before last season: the lifelong supporter's history. Three seasons are not enough to
 * reach KTE Legenda by attending (a pass bought for a guest credits nobody), four are.
 */
export const OLDER_SEASONS = 2;
/** The invitation lifetime the application uses (LOAN_INVITATION_TTL_HOURS). */
const LOAN_TTL_HOURS = 72;

/** Last season's pass prices: a little lower, so the two seasons differ. */
const PREVIOUS_PRICES: Record<PassTier, number> = { vip: 40000, lower: 27000, upper: 20000 };

export interface DemoInput {
  now: Date;
  seats: SeatRef[];
  sectors: SectorRef[];
  season: {
    label: string;
    validFrom: Date;
    validUntil: Date;
    prices: Record<PassTier, number>;
  };
  /** One bcrypt hash, shared by every demo account. */
  passwordHash: string;
  /** Seats held by passes that are not demo data: no single ticket may be put on them. */
  foreignPassSeatIds?: ReadonlySet<string>;
  rules: LoyaltyRules;
  crowdSize?: number;
  seed?: number;
}

export interface DemoDataset {
  users: UserRow[];
  matches: MatchRow[];
  prices: PriceRow[];
  passes: PassRow[];
  loans: LoanRow[];
  tickets: TicketRow[];
  ledger: LedgerRow[];
  waitlist: WaitlistRow[];
  accounts: NamedAccount[];
  /** The biggest upcoming match (about 85% full, never sold out). */
  fullestMatchId: string;
  /** Matches by key, for the report. */
  matchKeys: Map<string, string>;
  notes: string[];
}

interface Order {
  id: string;
  plan: MatchPlan;
  user: DemoUser;
  seats: SeatRef[];
  at: Date;
  scanned: boolean[];
  stripeId: string;
  ticketIds: string[];
}

const floorSecond = (ms: number): Date => new Date(Math.floor(ms / 1000) * 1000);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function previousSeasonLabel(label: string): string {
  const m = /^(\d{4})\/(\d{4})$/.exec(label);
  if (!m) throw new Error(`Unexpected season label "${label}" (expected 2026/2027).`);
  return `${Number(m[1]) - 1}/${Number(m[2]) - 1}`;
}

function shiftYear(date: Date, years: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

/** The first 04:00 (stadium time) at or after `after`: when the nightly expiry sweep would run. */
function nextSweepAfter(after: Date): Date {
  const day = dayNumberOf(after);
  const sameDay = wallClockToUtc(day, 4, 0);
  return sameDay.getTime() >= after.getTime() ? sameDay : wallClockToUtc(day + 1, 4, 0);
}

/** When seat `i` of an order was scanned at the gate (a little before kickoff). */
function scanTimeOf(o: Order, i: number): Date {
  return floorSecond(
    o.plan.kickoffAt.getTime() -
      (8 + ((o.at.getTime() / 1000) % 60) + (i % 3)) * MINUTE_MS -
      i * 11_000,
  );
}

function scanFlags(
  plan: MatchPlan,
  size: number,
  override: boolean | undefined,
  rng: Rng,
): boolean[] {
  if (plan.phase === 'upcoming') return new Array<boolean>(size).fill(false);
  if (override !== undefined) return new Array<boolean>(size).fill(override);
  // Groups mostly arrive together; a few no-shows, a few split parties. About 90% overall.
  const arrives = plan.phase === 'live' ? 0.8 : 0.885;
  const r = rng.next();
  if (r < arrives) return new Array<boolean>(size).fill(true);
  if (r < arrives + 0.075) return new Array<boolean>(size).fill(false);
  return Array.from({ length: size }, () => rng.chance(0.5));
}

function purchaseTime(plan: MatchPlan, user: DemoUser, now: Date, rng: Rng): Date {
  const kickoff = plan.kickoffAt.getTime();
  const latest = Math.min(kickoff, now.getTime()) - 20 * MINUTE_MS;
  let t: number;
  if (plan.phase === 'upcoming') {
    t = plan.fullest
      ? now.getTime() - 8 * HOUR_MS - Math.pow(rng.next(), 1.4) * 11 * DAY_MS
      : now.getTime() - rng.exponential(3.5) * DAY_MS;
  } else {
    t = kickoff - sampleLeadDays(rng) * DAY_MS;
  }
  const earliest = user.createdAt.getTime() + HOUR_MS;
  return floorSecond(clamp(t, Math.min(earliest, latest), latest));
}

interface OrderContext {
  now: Date;
  stadium: Stadium;
  users: readonly DemoUser[];
  plans: readonly MatchPlan[];
  blockedByPlan: (plan: MatchPlan) => ReadonlySet<string>;
  rng: Rng;
}

function generateOrders(ctx: OrderContext): Order[] {
  const { now, stadium, users, rng } = ctx;
  const crowd = users.filter((u) => CLASS_WEIGHT[u.fanClass] > 0);
  // The older seasons have no crowd: only the history of the one account that attended them (a
  // pass, entered at the gate), so no single tickets are generated for them.
  const homePlans = ctx.plans
    .filter((p) => p.home && p.season !== 'older')
    .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());
  const planKeys = new Set(homePlans.map((p) => p.key));

  const forcedByMatch = new Map<string, Array<{ user: DemoUser; order: ForcedOrder }>>();
  for (const user of users) {
    for (const order of user.forced) {
      if (!planKeys.has(order.matchKey)) {
        throw new Error(`${user.email}: forced order for unknown home match ${order.matchKey}`);
      }
      const list = forcedByMatch.get(order.matchKey) ?? [];
      list.push({ user, order });
      forcedByMatch.set(order.matchKey, list);
    }
  }

  const seasonTickets = new Map<string, number>();
  const lifetimeTickets = new Map<string, number>();
  const orders: Order[] = [];

  const make = (plan: MatchPlan, user: DemoUser, seats: SeatRef[], scanned?: boolean): Order => {
    const at = purchaseTime(plan, user, now, rng);
    const key = `${user.id}|${plan.season}`;
    seasonTickets.set(key, (seasonTickets.get(key) ?? 0) + seats.length);
    lifetimeTickets.set(user.id, (lifetimeTickets.get(user.id) ?? 0) + seats.length);
    return {
      id: rng.uuid(),
      plan,
      user,
      seats,
      at,
      scanned: scanFlags(plan, seats.length, scanned, rng),
      stripeId: `pi_demo_${rng.token(24)}`,
      ticketIds: seats.map(() => rng.uuid()),
    };
  };

  for (const plan of homePlans) {
    const pool = new SeatPool(stadium, ctx.blockedByPlan(plan));
    const free = pool.totalFree();
    const month = monthOf(dayNumberOf(plan.kickoffAt));
    const weights = sectorWeights(stadium, {
      draw: plan.opponent.draw,
      cold: month >= 11 || month <= 3,
    });
    const share = plan.fullest
      ? FULLEST_SHARE
      : clamp(
          BASE_OCCUPANCY *
            plan.opponent.draw *
            plan.timeFactor *
            (plan.season === 'previous' ? PREVIOUS_SEASON_SHARE : 1) *
            rng.between(0.92, 1.08),
          0.06,
          0.85,
        );
    let total = Math.round(free * share);
    // The fullest match is already at its level (it sold early); the others are still selling.
    if (plan.phase === 'upcoming' && !plan.fullest) {
      total = Math.round(total * soldShareAt((plan.kickoffAt.getTime() - now.getTime()) / DAY_MS));
    }

    const forced = forcedByMatch.get(plan.key) ?? [];
    // A match still ahead leaves the VIP stand mostly open (see UPCOMING_VIP_CAP).
    const caps = new Map<string, number>();
    if (plan.phase === 'upcoming') {
      for (const sector of stadium.sectors)
        if (sector.priceCategory === 'vip') caps.set(sector.code, UPCOMING_VIP_CAP);
    }
    const placed = placeOrders(
      pool,
      weights,
      total,
      rng,
      forced.map((f) => f.order.size),
      caps,
    );
    forced.forEach((f, i) =>
      orders.push(make(plan, f.user, placed.forced[i], f.order.scanned ?? true)),
    );

    const bySize: SeatRef[][][] = [[], [], [], [], [], [], []];
    for (const g of placed.groups) bySize[g.length].push(g);

    const used = new Set(forced.map((f) => f.user.id));
    const cutoff = Math.min(plan.kickoffAt.getTime(), now.getTime()) - 6 * HOUR_MS;
    const eligible = crowd.filter((u) => u.createdAt.getTime() <= cutoff);

    for (let k = 6; k >= 1; k -= 1) {
      const groups = bySize[k];
      if (groups.length === 0) continue;
      const keyed: Array<{ user: DemoUser; key: number }> = [];
      for (const u of eligible) {
        if (used.has(u.id)) continue;
        if ((seasonTickets.get(`${u.id}|${plan.season}`) ?? 0) + k > SEASON_TICKET_CAP) continue;
        if ((lifetimeTickets.get(u.id) ?? 0) + k > LIFETIME_TICKET_CAP) continue;
        const gap = Math.abs(u.groupPref - k);
        const fit = gap === 0 ? 1 : gap === 1 ? 0.45 : 0.2;
        const presale =
          plan.phase === 'upcoming' && (u.fanClass === 'devoted' || u.fanClass === 'regular')
            ? 1.8
            : 1;
        const weight = CLASS_WEIGHT[u.fanClass] * fit * (u.passHolder ? 0.4 : 1) * presale;
        keyed.push({ user: u, key: rng.exponential(1) / weight });
      }
      keyed.sort((a, b) => a.key - b.key);
      let next = 0;
      for (const c of keyed) {
        if (next >= groups.length) break;
        if (used.has(c.user.id)) continue;
        used.add(c.user.id);
        orders.push(make(plan, c.user, groups[next], undefined));
        next += 1;
      }
      if (next < groups.length) {
        throw new Error(
          `Not enough accounts to buy the ${groups.length} orders of ${k} seats for ${plan.key}; raise the crowd size.`,
        );
      }
    }
  }
  return orders;
}

/** What the invitation for a loan looked like, and the entry it produced. */
function loanRowsAndTickets(
  loans: readonly DemoLoan[],
  planByKey: ReadonlyMap<string, MatchPlan>,
  matchIdByKey: ReadonlyMap<string, string>,
  stewardId: string,
  now: Date,
  rng: Rng,
): { rows: LoanRow[]; tickets: TicketRow[]; events: LoyaltyEvent[] } {
  const rows: LoanRow[] = [];
  const tickets: TicketRow[] = [];
  const events: LoyaltyEvent[] = [];
  const nowMs = now.getTime();
  const hours = (h: number): number => h * HOUR_MS;

  for (const loan of loans) {
    const match = planByKey.get(loan.matchKey) as MatchPlan;
    const kickoff = match.kickoffAt.getTime();
    const passFloor = loan.pass.createdAt.getTime() + 2 * DAY_MS;
    let createdMs: number;
    switch (loan.outcome) {
      case 'used':
      case 'completed':
        createdMs = kickoff - rng.between(2, 6) * DAY_MS;
        break;
      case 'expired':
        createdMs = kickoff - rng.between(6, 9) * DAY_MS;
        break;
      case 'cancelled_pending':
        createdMs = nowMs - rng.between(3, 6) * DAY_MS;
        break;
      case 'cancelled_accepted':
        createdMs = nowMs - rng.between(6, 9) * DAY_MS;
        break;
      case 'accepted':
        createdMs = nowMs - rng.between(2, 4) * DAY_MS;
        break;
      default:
        createdMs = nowMs - rng.between(20, 40) * HOUR_MS;
    }
    createdMs = Math.max(createdMs, passFloor);
    if (createdMs > kickoff - DAY_MS || createdMs > nowMs - HOUR_MS) {
      throw new Error(`Loan ${loan.matchKey}/${loan.outcome} would be sent after it could matter.`);
    }
    const createdAt = floorSecond(createdMs);
    const expiresAt = floorSecond(createdMs + hours(LOAN_TTL_HOURS));
    const accepted = ['used', 'completed', 'accepted', 'cancelled_accepted'].includes(loan.outcome);
    const acceptedAt = accepted ? floorSecond(createdMs + hours(rng.between(1, 20))) : null;
    const qrJti = accepted ? rng.token(21) : null;

    let status = loan.outcome as string;
    let completedAt: Date | null = null;
    let cancelledAt: Date | null = null;
    let qrRevokedAt: Date | null = null;
    let reason: string | null = null;
    if (loan.outcome === 'cancelled_pending' || loan.outcome === 'cancelled_accepted') {
      status = 'cancelled';
      const base = acceptedAt ? acceptedAt.getTime() : createdMs;
      cancelledAt = floorSecond(
        loan.outcome === 'cancelled_accepted'
          ? base + rng.between(1, 2) * DAY_MS
          : base + hours(rng.between(1, 30)),
      );
      reason =
        loan.outcome === 'cancelled_accepted'
          ? 'Közbejött egy családi program, így visszavonom a kölcsönzést.'
          : 'Mégsem tudom átadni, a belépőt magam használom.';
      if (loan.outcome === 'cancelled_accepted') qrRevokedAt = cancelledAt;
    }
    if (loan.outcome === 'used' || loan.outcome === 'completed') {
      completedAt = floorSecond(kickoff + hours(rng.between(2, 3)));
      if (loan.outcome === 'completed') qrRevokedAt = completedAt;
      // The lender is paid only when the borrowed entry was scanned (used), not for an unused loan.
      if (loan.outcome === 'used') {
        events.push({ kind: 'loan', userId: loan.lenderId, at: completedAt, loanId: loan.id });
      }
    }
    rows.push({
      id: loan.id,
      seasonPassId: loan.pass.id,
      lenderUserId: loan.lenderId,
      borrowerUserId: loan.borrowerId,
      matchId: matchIdByKey.get(loan.matchKey) as string,
      borrowerEmail: loan.borrowerEmail,
      status,
      invitationToken: rng.token(48),
      expiresAt,
      acceptedAt,
      qrJti,
      qrRevokedAt,
      cancelledAt,
      cancellationReason: reason,
      completedAt,
      createdAt,
      updatedAt: completedAt ?? cancelledAt ?? acceptedAt ?? createdAt,
      version: 1,
    });

    // The borrowed entry exists only while the loan stands (a withdrawn one is deleted).
    if (loan.outcome === 'used' || loan.outcome === 'completed' || loan.outcome === 'accepted') {
      const used = loan.outcome === 'used';
      const scannedAt = used ? floorSecond(kickoff - rng.between(10, 50) * MINUTE_MS) : null;
      const expiredAt =
        loan.outcome === 'completed' ? nextSweepAfter(new Date(kickoff + DAY_MS)) : null;
      tickets.push({
        id: rng.uuid(),
        matchId: matchIdByKey.get(loan.matchKey) as string,
        seatId: loan.pass.seat.id,
        userId: loan.borrowerId as string,
        seasonPassId: loan.pass.id,
        status: used ? 'used' : loan.outcome === 'completed' ? 'expired' : 'paid',
        source: 'loan',
        pricePaid: '0.00',
        currency: 'HUF',
        qrCode: `KTE-LOAN-${rng.uuid()}`,
        qrJti: rng.token(21),
        stripePaymentIntentId: null,
        usedAt: scannedAt,
        scannedAt,
        scannedByUserId: used ? stewardId : null,
        expiredAt,
        confirmationEmailSentAt: null,
        createdAt: acceptedAt as Date,
        updatedAt: scannedAt ?? expiredAt ?? (acceptedAt as Date),
        version: 1,
      });
    }
  }
  return { rows, tickets, events };
}

/** The entries season-pass holders opened: one per match they attended (never one for a match still ahead). */
function passTickets(
  passes: readonly DemoPass[],
  plans: readonly MatchPlan[],
  matchIdByKey: ReadonlyMap<string, string>,
  lent: ReadonlySet<string>,
  stewardId: string,
  rng: Rng,
): TicketRow[] {
  const out: TicketRow[] = [];
  const leaguePlans = plans.filter((p) => p.home && p.passEligible);
  for (const pass of passes) {
    for (const plan of leaguePlans) {
      if (plan.seasonLabel !== pass.seasonLabel) continue;
      const kickoff = plan.kickoffAt.getTime();
      if (kickoff < pass.createdAt.getTime() + HOUR_MS) continue;
      if (lent.has(`${pass.id}|${plan.key}`)) continue;
      const base = {
        id: rng.uuid(),
        matchId: matchIdByKey.get(plan.key) as string,
        seatId: pass.seat.id,
        userId: pass.buyerId,
        seasonPassId: pass.id,
        source: 'season_pass',
        pricePaid: '0.00',
        currency: 'HUF',
        qrCode: `KTE-SP-${rng.uuid()}`,
        qrJti: rng.token(21),
        stripePaymentIntentId: null,
        expiredAt: null,
        confirmationEmailSentAt: null,
        version: 1,
      };
      // No entry ticket for a match that is still ahead, whatever the seat: the application
      // creates it only when the holder opens the QR page or is scanned at the gate, which can
      // happen from a few hours before kickoff. (The admin overview counts the passes valid for
      // the match instead.)
      if (plan.phase === 'upcoming') continue;
      const comes = pass.alwaysAttends || rng.chance(plan.season === 'current' ? 0.85 : 0.8);
      if (!comes) continue;
      const scannedAt = floorSecond(kickoff - rng.between(8, 70) * MINUTE_MS);
      const createdAt = floorSecond(scannedAt.getTime() - rng.between(15, 300) * MINUTE_MS);
      out.push({
        ...base,
        status: 'used',
        usedAt: scannedAt,
        scannedAt,
        scannedByUserId: stewardId,
        createdAt: new Date(Math.max(createdAt.getTime(), pass.createdAt.getTime() + HOUR_MS)),
        updatedAt: scannedAt,
      });
    }
  }
  return out;
}

export function buildDemoDataset(input: DemoInput): DemoDataset {
  const root = new Rng(input.seed ?? DEFAULT_SEED);
  const rUsers = root.fork('users');
  const rMatches = root.fork('matches');
  const rPasses = root.fork('passes');
  const rLoans = root.fork('loans');
  const rOrders = root.fork('orders');
  const rExtra = root.fork('extra');
  const rLedger = root.fork('ledger');
  const now = input.now;
  const notes: string[] = [];

  const previousLabel = previousSeasonLabel(input.season.label);
  const previousWindow = {
    label: previousLabel,
    validFrom: shiftYear(input.season.validFrom, -1),
    validUntil: shiftYear(input.season.validUntil, -1),
    prices: PREVIOUS_PRICES,
  };
  // One window per older season, nearest first, shifted back a year at a time.
  const olderWindows: Array<{ label: string; validFrom: Date; validUntil: Date }> = [];
  {
    let label = previousLabel;
    for (let k = 1; k <= OLDER_SEASONS; k += 1) {
      label = previousSeasonLabel(label);
      olderWindows.push({
        label,
        validFrom: shiftYear(input.season.validFrom, -1 - k),
        validUntil: shiftYear(input.season.validUntil, -1 - k),
      });
    }
  }
  const schedule = buildSchedule(now, input.season, previousLabel);
  // Seasons before last season, for the account that has held a pass and been to every match for
  // years (see olderSeasons): four seasons are what reaching KTE Legenda by attending takes.
  const olderPlans = olderSeasons(schedule.previous, previousSeasonLabel, OLDER_SEASONS);
  const plans = [...schedule.current, ...schedule.previous, ...olderPlans];
  const planByKey = new Map(plans.map((p) => [p.key, p]));
  const stadium = new Stadium(input.seats, input.sectors);
  const sellable = stadium.sellableSeats().length;

  const users = buildUsers(
    { now, seasonStart: input.season.validFrom, crowdSize: input.crowdSize ?? DEFAULT_CROWD_SIZE },
    rUsers,
  );
  const byKey = new Map(users.filter((u) => u.key).map((u) => [u.key as string, u]));
  const steward = byKey.get('kapus') as DemoUser;

  // Matches.
  const matchIdByKey = new Map<string, string>();
  const matches: MatchRow[] = [];
  for (const plan of [...plans].sort((a, b) => a.key.localeCompare(b.key))) {
    const id = rMatches.uuid();
    matchIdByKey.set(plan.key, id);
    matches.push({
      id,
      homeTeam: homeTeamOf(plan),
      awayTeam: awayTeamOf(plan),
      competition: plan.competition,
      venue: venueFor(plan),
      kickoffAt: plan.kickoffAt,
      status: plan.status,
      // Away matches have no stock here. A home match's capacity is the sellable seats: the
      // away section is never sold, so a capacity that counted it could never be reached
      // (and the waitlist rule, active tickets reaching capacity, could never hold).
      capacity: plan.home ? sellable : 0,
      basePrice: plan.basePrice.toFixed(2),
      description: blurbFor(plan),
      isSeasonPassEligible: plan.passEligible,
      createdAt: floorSecond(
        Math.min(plan.kickoffAt.getTime() - 60 * DAY_MS, now.getTime() - DAY_MS),
      ),
      updatedAt: floorSecond(
        Math.min(plan.kickoffAt.getTime() - 60 * DAY_MS, now.getTime() - DAY_MS),
      ),
      version: 1,
    });
  }

  // Season passes and loans.
  const foreign = input.foreignPassSeatIds ?? new Set<string>();
  const passes = buildPasses(
    {
      stadium,
      users,
      now,
      season: input.season,
      previous: previousWindow,
      older: olderWindows,
      foreignPassSeatIds: foreign,
    },
    rPasses,
  );
  const currentPasses = passes.filter((p) => p.season === 'current');
  const passSeats = {
    current: new Set(currentPasses.map((p) => p.seat.id)),
    previous: new Set(passes.filter((p) => p.season === 'previous').map((p) => p.seat.id)),
  };
  const loans = planLoans(
    users,
    currentPasses,
    new Map(schedule.current.map((m) => [m.key, m])),
    rLoans,
  );
  const lent = new Set(
    loans
      .filter((l) => ['used', 'completed', 'accepted'].includes(l.outcome))
      .map((l) => `${l.pass.id}|${l.matchKey}`),
  );

  // Single tickets. A seat held by an active pass (or by a pass that was not made here) is
  // not offered for sale on a match the pass is valid for: that is how the seat map treats it.
  const orders = generateOrders({
    now,
    stadium,
    users,
    plans,
    blockedByPlan: (plan) => {
      // A pass seat is the holder's only on a match the pass covers. On a cup tie the holder has no
      // entry, so the seat stays empty and is sold like any other (the seat map does the same).
      const blocked = new Set<string>();
      if (!plan.passEligible) return blocked;
      for (const id of foreign) blocked.add(id);
      for (const id of plan.season === 'current' ? passSeats.current : passSeats.previous)
        blocked.add(id);
      return blocked;
    },
    rng: rOrders,
  });

  const loanOut = loanRowsAndTickets(loans, planByKey, matchIdByKey, steward.id, now, rExtra);
  const entryTickets = passTickets(passes, plans, matchIdByKey, lent, steward.id, rExtra);

  // No waitlist: it exists only for a sold-out match, and the demo has none (a fully ticketed
  // league match would leave no seat to sell as a season pass).
  const waitlist: WaitlistRow[] = [];

  // Loyalty: replay every event in time order for the points, tiers and prices paid.
  const events: LoyaltyEvent[] = [];
  for (const u of users) {
    if (u.role !== UserRole.FAN) continue;
    events.push({ kind: 'registration', userId: u.id, at: u.createdAt });
    if (u.profileCompletedAt)
      events.push({ kind: 'profile', userId: u.id, at: u.profileCompletedAt });
  }
  for (const o of orders) {
    events.push({
      kind: 'order',
      userId: o.user.id,
      at: o.at,
      orderId: o.id,
      ticketIds: o.ticketIds,
      unitPrices: o.seats.map((s) => seatUnitPrice(o.plan.basePrice, s.priceModifier)),
    });
  }
  // The pass points go to the pass HOLDER's account; a pass for a holder without one credits nobody.
  for (const p of passes) {
    if (p.holderId)
      events.push({ kind: 'pass', userId: p.holderId, at: p.createdAt, passId: p.id });
  }
  // Attendance: the first time a person enters a match they earn the attendance points, once per
  // person per match. Whose entry it is: a single ticket, its buyer; a pass entry, the pass HOLDER's
  // account (a holder without one has nobody to credit); a borrowed entry, the borrower.
  const firstEntry = new Map<string, { userId: string; matchId: string; at: Date }>();
  const entered = (userId: string, matchId: string, at: Date): void => {
    const key = `${userId}|${matchId}`;
    const seen = firstEntry.get(key);
    if (!seen || at.getTime() < seen.at.getTime()) firstEntry.set(key, { userId, matchId, at });
  };
  for (const o of orders) {
    o.seats.forEach((_seat, i) => {
      if (o.scanned[i])
        entered(o.user.id, matchIdByKey.get(o.plan.key) as string, scanTimeOf(o, i));
    });
  }
  const holderByPass = new Map(passes.map((p) => [p.id, p.holderId]));
  for (const t of entryTickets) {
    const holder = t.seasonPassId ? holderByPass.get(t.seasonPassId) : null;
    if (t.source === 'season_pass' && t.status === 'used' && holder && t.scannedAt) {
      entered(holder, t.matchId, t.scannedAt);
    }
  }
  for (const t of loanOut.tickets) {
    if (t.source === 'loan' && t.status === 'used' && t.scannedAt)
      entered(t.userId, t.matchId, t.scannedAt);
  }
  for (const e of firstEntry.values()) {
    events.push({ kind: 'attend', userId: e.userId, at: e.at, matchId: e.matchId });
  }
  events.push(...loanOut.events);
  // The season-end conversion of every season boundary, oldest first (30 June 03:00 each year).
  const carryoverAts = [
    input.season.validFrom,
    previousWindow.validFrom,
    ...olderWindows.map((w) => w.validFrom),
  ]
    .map((from) => wallClockToUtc(dayNumberOfDateColumn(from) - 1, 3, 0))
    .sort((a, b) => a.getTime() - b.getTime());
  const outcome = simulateLoyalty(events, input.rules, carryoverAts, rLedger, now);

  for (const u of users) {
    if (!u.expectedTier) continue;
    const got = outcome.balances.get(u.id);
    if (!got || got.tier !== u.expectedTier) {
      throw new Error(
        `${u.email} should be ${u.expectedTier} but the ledger gives ${got?.tier} (${got?.points} points).`,
      );
    }
  }

  // Rows.
  const singleTickets: TicketRow[] = [];
  for (const o of orders) {
    const prices = outcome.orderPrices.get(o.id) as number[];
    const kickoff = o.plan.kickoffAt;
    o.seats.forEach((seat, i) => {
      const scannedAt = o.scanned[i] ? scanTimeOf(o, i) : null;
      const expired = !scannedAt && o.plan.season === 'previous';
      const expiredAt = expired ? nextSweepAfter(new Date(kickoff.getTime() + DAY_MS)) : null;
      singleTickets.push({
        id: o.ticketIds[i],
        matchId: matchIdByKey.get(o.plan.key) as string,
        seatId: seat.id,
        userId: o.user.id,
        seasonPassId: null,
        status: scannedAt ? 'used' : expired ? 'expired' : 'paid',
        source: 'single',
        pricePaid: prices[i].toFixed(2),
        currency: 'HUF',
        qrCode: `KTE-${rOrders.uuid()}`,
        qrJti: rOrders.token(21),
        stripePaymentIntentId: o.stripeId,
        usedAt: scannedAt,
        scannedAt,
        scannedByUserId: scannedAt ? steward.id : null,
        expiredAt,
        confirmationEmailSentAt: floorSecond(o.at.getTime() + 3000),
        createdAt: o.at,
        updatedAt: scannedAt ?? expiredAt ?? o.at,
        version: 1,
      });
    });
  }

  const userRows: UserRow[] = users.map((u) => {
    const balance = outcome.balances.get(u.id);
    return {
      id: u.id,
      email: u.email,
      passwordHash: input.passwordHash,
      firstName: u.firstName,
      lastName: u.lastName,
      phoneNumber: u.phoneNumber,
      dateOfBirth: u.dateOfBirth,
      role: u.role,
      loyaltyTier: balance?.tier ?? LoyaltyTier.BRONZE,
      loyaltyTierReachedAt: balance?.reachedAt ?? null,
      loyaltyPoints: balance?.points ?? 0,
      emailVerified: true,
      twoFactorEnabled: false,
      lastLoginAt: u.lastLoginAt,
      profileCompletedAt: u.profileCompletedAt,
      isActive: true,
      createdAt: u.createdAt,
      updatedAt: u.lastLoginAt ?? u.createdAt,
      version: 1,
    };
  });

  const passRows: PassRow[] = passes.map((p) => ({
    id: p.id,
    userId: p.buyerId,
    holderName: p.holderName,
    holderUserId: p.holderId,
    seatId: p.seat.id,
    seasonLabel: p.seasonLabel,
    validFrom: p.validFrom,
    validUntil: p.validUntil,
    status: p.status,
    pricePaid: p.price.toFixed(2),
    currency: 'HUF',
    qrCode: p.qrCode,
    autoRenew: false,
    stripePaymentIntentId: `pi_demo_pass_${rExtra.token(20)}`,
    createdAt: p.createdAt,
    updatedAt: p.createdAt,
    version: 1,
  }));

  const priceRows: PriceRow[] = [previousWindow, ...olderWindows].flatMap((w) =>
    PASS_TIERS.map((tier) => ({
      id: rExtra.uuid(),
      section: tier,
      sectionLabel: TIER_LABEL[tier],
      seasonLabel: w.label,
      price: PREVIOUS_PRICES[tier],
      currency: 'HUF',
      validFrom: w.validFrom,
      validUntil: w.validUntil,
      isActive: false,
      createdAt: floorSecond(w.validFrom.getTime() - 20 * DAY_MS),
      updatedAt: floorSecond(w.validFrom.getTime() - 20 * DAY_MS),
      version: 1,
    })),
  );

  const accounts: NamedAccount[] = users
    .filter((u) => u.key)
    .map((u) => ({
      email: u.email,
      name: formatFullName(u),
      role: u.role,
      purpose: u.purpose as string,
    }));

  return {
    users: userRows,
    matches,
    prices: priceRows,
    passes: passRows,
    loans: loanOut.rows,
    tickets: [...singleTickets, ...entryTickets, ...loanOut.tickets],
    ledger: outcome.ledger,
    waitlist,
    accounts,
    fullestMatchId: matchIdByKey.get((plans.find((p) => p.fullest) as MatchPlan).key) as string,
    matchKeys: matchIdByKey,
    notes,
  };
}
