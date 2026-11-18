import { tierForPoints } from '../../modules/loyalty/loyalty.constants';
import { tierRank } from '../../modules/loyalty/loyalty-tier-keeping';
import { Competition, MatchStatus } from '../entities/match.entity';
import { LoyaltyTier } from '../entities/user.entity';
import { SEASON_PASS_TIER_PRICE, STADIUM_LAYOUT, priceModifierFor } from '../stadium-layout';
import { DemoDataset, DemoInput, LIFETIME_TICKET_CAP, buildDemoDataset } from './dataset';
import type { SeatRef, SectorRef } from './demand';
import { MIN_FREE_PASS_SEATS, MIN_FREE_PASS_SHARE } from './report';
import { DEMO_ID_PREFIX } from './rng';

const NOW = new Date('2026-11-16T19:24:00Z');

function stadium(): { seats: SeatRef[]; sectors: SectorRef[] } {
  const seats: SeatRef[] = [];
  const sectors: SectorRef[] = [];
  let n = 0;
  for (const s of STADIUM_LAYOUT) {
    sectors.push({
      code: s.code,
      arc: s.arc,
      position: s.position,
      isAway: s.isAway,
      isCovered: s.isCovered,
      priceCategory: s.priceCategory,
    });
    for (let r = 1; r <= s.rows; r += 1) {
      for (let k = 1; k <= s.seatsPerRow; k += 1) {
        seats.push({
          id: `seat-${n++}`,
          section: s.code,
          row: r,
          number: k,
          priceModifier: Number(priceModifierFor(s.priceCategory)),
          isAccessible: false,
        });
      }
    }
  }
  return { seats, sectors };
}

const RULES = {
  registrationPoints: 100,
  profileCompletionPoints: 50,
  attendancePoints: 50,
  discountTicketLimit: 2,
  seasonPassPoints: 500,
  passLoanPoints: 25,
  carryoverPercent: 70,
};

function input(): DemoInput {
  const { seats, sectors } = stadium();
  return {
    now: NOW,
    seats,
    sectors,
    season: {
      label: '2026/2027',
      validFrom: new Date('2026-07-01T00:00:00Z'),
      validUntil: new Date('2027-06-30T00:00:00Z'),
      prices: SEASON_PASS_TIER_PRICE,
    },
    passwordHash: '$2b$12$sharedHashForEveryDemoAccountXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    rules: RULES,
  };
}

describe('the demo dataset', () => {
  let d: DemoDataset;
  const inp = input();
  const seatById = new Map(inp.seats.map((s) => [s.id, s]));
  const sectorByCode = new Map(inp.sectors.map((s) => [s.code, s]));
  const sellable = inp.seats.filter((s) => !sectorByCode.get(s.section)!.isAway).length;

  beforeAll(() => {
    d = buildDemoDataset(inp);
  }, 120_000);

  const user = (key: string) => d.users.find((u) => u.email === `demo-${key}@kte-demo.test`)!;
  const matchById = (id: string) => d.matches.find((m) => m.id === id)!;
  const singles = () => d.tickets.filter((t) => t.source === 'single');

  it('has about 3,000 fans, the named accounts, and one shared password hash', () => {
    expect(d.users).toHaveLength(3015);
    expect(new Set(d.users.map((u) => u.passwordHash)).size).toBe(1);
    expect(new Set(d.users.map((u) => u.email)).size).toBe(d.users.length);
    expect(d.accounts.map((a) => a.email)).toEqual(
      expect.arrayContaining([
        'demo-admin@kte-demo.test',
        'demo-kapus@kte-demo.test',
        'demo-ures@kte-demo.test',
        'demo-berletes@kte-demo.test',
        'demo-legenda@kte-demo.test',
      ]),
    );
    expect(d.accounts).toHaveLength(15);
    expect(user('admin').role).toBe('admin');
    expect(user('kapus').role).toBe('gate');
  });

  it('gives every row an id with the demo prefix, and no id twice', () => {
    const ids = [
      ...d.users,
      ...d.matches,
      ...d.prices,
      ...d.passes,
      ...d.loans,
      ...d.tickets,
      ...d.ledger,
      ...d.waitlist,
    ].map((r) => r.id);
    expect(ids.every((id) => id.startsWith(`${DEMO_ID_PREFIX}-`))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('seats', () => {
    it('never puts a ticket or a pass in the away section', () => {
      const away = (seatId: string) => sectorByCode.get(seatById.get(seatId)!.section)!.isAway;
      expect(d.tickets.some((t) => away(t.seatId))).toBe(false);
      expect(d.passes.some((p) => away(p.seatId))).toBe(false);
    });

    it('holds one ticket per seat per match (uq_tickets_match_seat)', () => {
      const keys = d.tickets.map((t) => `${t.matchId}|${t.seatId}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('holds one pass per seat per season, and one pass per holder account per season', () => {
      const seatKeys = d.passes.map((p) => `${p.seatId}|${p.seasonLabel}`);
      expect(new Set(seatKeys).size).toBe(seatKeys.length);
      const holders = d.passes
        .filter((p) => p.holderUserId)
        .map((p) => `${p.holderUserId}|${p.seasonLabel}`);
      expect(new Set(holders).size).toBe(holders.length);
    });

    it('never sells a single ticket on a pass seat for a match that pass covers (league home matches)', () => {
      for (const label of ['2026/2027', '2025/2026']) {
        const passSeats = new Set(
          d.passes.filter((p) => p.seasonLabel === label).map((p) => p.seatId),
        );
        const bad = singles().filter((t) => {
          const k = matchById(t.matchId).kickoffAt.getTime();
          const inSeason = d.passes.some(
            (p) =>
              p.seasonLabel === label &&
              k >= p.validFrom.getTime() &&
              k < p.validUntil.getTime() + 86_400_000,
          );
          return inSeason && matchById(t.matchId).isSeasonPassEligible && passSeats.has(t.seatId);
        });
        expect(bad).toHaveLength(0);
      }
    });

    it("keeps a pass entry on its pass's seat and in its buyer's name", () => {
      const passById = new Map(d.passes.map((p) => [p.id, p]));
      for (const t of d.tickets.filter((x) => x.source !== 'single')) {
        const pass = passById.get(t.seasonPassId!)!;
        expect(t.seatId).toBe(pass.seatId);
        if (t.source === 'season_pass') expect(t.userId).toBe(pass.userId);
        expect(t.pricePaid).toBe('0.00');
      }
    });
  });

  describe('matches', () => {
    it('has the full league season and no cancelled match', () => {
      const league = d.matches.filter(
        (m) =>
          m.competition === Competition.NB2 &&
          m.kickoffAt >= new Date('2026-07-01') &&
          m.kickoffAt < new Date('2027-07-01'),
      );
      expect(league).toHaveLength(30);
      expect(league.filter((m) => m.homeTeam === 'Kecskeméti TE')).toHaveLength(15);
      expect(d.matches.some((m) => m.status === MatchStatus.CANCELLED)).toBe(false);
    });

    it('has a blurb on every match, naming the opponent', () => {
      for (const m of d.matches) {
        expect(m.description.length).toBeGreaterThan(40);
        const opponent = m.homeTeam === 'Kecskeméti TE' ? m.awayTeam : m.homeTeam;
        expect(m.description).toContain(opponent);
      }
    });

    it('gives every home match the sellable seats as its capacity', () => {
      const home = d.matches.filter((m) => m.homeTeam === 'Kecskeméti TE');
      expect(home.every((m) => m.capacity === sellable)).toBe(true);
    });

    it('sells nothing for away matches', () => {
      const away = d.matches.filter((m) => m.homeTeam !== 'Kecskeméti TE');
      expect(away).toHaveLength(15);
      for (const m of away) {
        expect(m.capacity).toBe(0);
        expect(d.tickets.some((t) => t.matchId === m.id)).toBe(false);
      }
    });

    it('buys every ticket before kickoff, before now, and after the account existed', () => {
      const created = new Map(d.users.map((u) => [u.id, u.createdAt.getTime()]));
      for (const t of singles()) {
        expect(t.createdAt.getTime()).toBeLessThan(matchById(t.matchId).kickoffAt.getTime());
        expect(t.createdAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
        expect(t.createdAt.getTime()).toBeGreaterThan(created.get(t.userId)!);
      }
    });
  });

  describe('tickets', () => {
    it('scans about 90% of the tickets of matches played this season, not all of them', () => {
      const played = singles().filter((t) => {
        const m = matchById(t.matchId);
        return (
          m.kickoffAt <= NOW &&
          m.kickoffAt >= new Date('2026-07-01') &&
          ['paid', 'used'].includes(t.status)
        );
      });
      const rate = played.filter((t) => t.status === 'used').length / played.length;
      expect(rate).toBeGreaterThan(0.87);
      expect(rate).toBeLessThan(0.93);
    });

    it('gives a scan time to exactly the used tickets', () => {
      for (const t of d.tickets) {
        expect(t.status === 'used').toBe(t.scannedAt !== null);
        expect(t.usedAt?.getTime()).toBe(t.scannedAt?.getTime());
      }
    });

    it('lets nobody own anything near a hundred tickets', () => {
      const per = new Map<string, number>();
      for (const t of singles()) per.set(t.userId, (per.get(t.userId) ?? 0) + 1);
      const named = new Set(d.users.filter((u) => u.email.startsWith('demo-')).map((u) => u.id));
      const crowdMax = Math.max(...[...per].filter(([id]) => !named.has(id)).map(([, n]) => n));
      expect(crowdMax).toBeLessThanOrEqual(LIFETIME_TICKET_CAP);
      expect(Math.max(...per.values())).toBeLessThan(100);
    });

    it('charges no more than the list price and never nothing', () => {
      for (const t of singles()) {
        const list = Math.round(
          Number(matchById(t.matchId).basePrice) * seatById.get(t.seatId)!.priceModifier,
        );
        expect(Number(t.pricePaid)).toBeGreaterThan(0);
        expect(Number(t.pricePaid)).toBeLessThanOrEqual(list);
      }
      expect(
        singles().some(
          (t) =>
            Number(t.pricePaid) <
            Math.round(
              Number(matchById(t.matchId).basePrice) * seatById.get(t.seatId)!.priceModifier,
            ),
        ),
      ).toBe(true);
    });

    it('fills the sectors beside the halfway line before the corners', () => {
      const played = new Set(
        d.matches
          .filter(
            (m) =>
              m.status === MatchStatus.FINISHED &&
              m.homeTeam === 'Kecskeméti TE' &&
              m.kickoffAt > new Date('2026-07-01'),
          )
          .map((m) => m.id),
      );
      const fill = new Map<string, number>();
      for (const t of singles().filter((x) => played.has(x.matchId))) {
        const code = seatById.get(t.seatId)!.section;
        fill.set(code, (fill.get(code) ?? 0) + 1);
      }
      const rate = (code: string): number =>
        (fill.get(code) ?? 0) / (inp.seats.filter((s) => s.section === code).length * played.size);
      expect(rate('C/2')).toBeGreaterThan(rate('D/1') * 2);
      expect(rate('B/1')).toBeGreaterThan(rate('A/2') * 2);
      expect(rate('J')).toBeGreaterThan(rate('N') * 1.5);
      expect(fill.get('VENDÉG') ?? 0).toBe(0);
    });
  });

  describe('no sold-out match, and a season pass can be bought in every tier', () => {
    const ticketed = (matchId: string): number =>
      d.tickets.filter(
        (t) => t.matchId === matchId && ['paid', 'used', 'pending_payment'].includes(t.status),
      ).length;

    it('has no sold-out match, no waitlist and no waitlist account', () => {
      expect(d.matches.some((m) => m.status === MatchStatus.SOLD_OUT)).toBe(false);
      for (const m of d.matches.filter((x) => x.capacity > 0))
        expect(ticketed(m.id)).toBeLessThan(m.capacity);
      expect(d.waitlist).toHaveLength(0);
      expect(d.accounts.some((a) => a.email.includes('varolistas'))).toBe(false);
    });

    it('makes the biggest upcoming league match clearly the fullest, about 85%, halfway sectors nearly full', () => {
      const m = matchById(d.fullestMatchId);
      expect(m.status).toBe(MatchStatus.ON_SALE);
      const upcoming = d.matches.filter(
        (x) => x.capacity > 0 && x.kickoffAt > NOW && x.isSeasonPassEligible,
      );
      const share = (x: { id: string }): number => ticketed(x.id) / sellable;
      expect(share(m)).toBeGreaterThan(0.8);
      expect(share(m)).toBeLessThan(0.9);
      for (const other of upcoming.filter((x) => x.id !== m.id))
        expect(share(other)).toBeLessThan(share(m) - 0.2);
      const fill = (code: string): number =>
        d.tickets.filter((t) => t.matchId === m.id && seatById.get(t.seatId)!.section === code)
          .length / inp.seats.filter((s) => s.section === code).length;
      expect(fill('C/2')).toBeGreaterThan(0.9);
    });

    it('leaves plenty of seats a season pass can still be issued for, in every tier', () => {
      const passSeats = new Set(
        d.passes.filter((p) => p.seasonLabel === '2026/2027').map((p) => p.seatId),
      );
      const seasonEnd = new Date('2027-07-01T00:00:00Z');
      const upcomingEligible = new Set(
        d.matches
          .filter((x) => x.isSeasonPassEligible && x.status !== 'cancelled')
          .filter((x) => x.kickoffAt > NOW && x.kickoffAt < seasonEnd)
          .map((x) => x.id),
      );
      const blocked = new Set(
        d.tickets.filter((t) => upcomingEligible.has(t.matchId)).map((t) => t.seatId),
      );
      for (const tier of ['vip', 'lower', 'upper']) {
        const seats = inp.seats.filter((s) => sectorByCode.get(s.section)!.priceCategory === tier);
        const free = seats.filter((s) => !passSeats.has(s.id) && !blocked.has(s.id)).length;
        expect(free).toBeGreaterThanOrEqual(
          Math.max(MIN_FREE_PASS_SEATS, Math.ceil(MIN_FREE_PASS_SHARE * seats.length)),
        );
      }
    });

    it('creates no season-pass entry ticket for a match still ahead', () => {
      const ahead = new Set(d.matches.filter((m) => m.kickoffAt > NOW).map((m) => m.id));
      expect(d.tickets.filter((t) => t.source === 'season_pass' && ahead.has(t.matchId))).toEqual(
        [],
      );
    });

    it('covers the home cup ties with the pass: eligible, no single ticket on a pass seat, pass entries on the played one', () => {
      const cups = d.matches.filter((m) => m.competition === 'magyar_kupa' && m.homeTeam === 'Kecskeméti TE');
      expect(cups.length).toBeGreaterThan(0);
      for (const c of cups) expect(c.isSeasonPassEligible).toBe(true);
      const cupIds = new Set(cups.map((c) => c.id));
      // a seat is a pass seat for a cup tie when a pass valid on that day holds it
      const coveredBy = (t: { matchId: string; seatId: string }): boolean => {
        const k = matchById(t.matchId).kickoffAt.getTime();
        return d.passes.some(
          (p) =>
            p.seatId === t.seatId &&
            k >= p.validFrom.getTime() &&
            k < p.validUntil.getTime() + 86_400_000,
        );
      };
      const singleOnPassSeat = d.tickets.filter(
        (t) => t.source === 'single' && cupIds.has(t.matchId) && coveredBy(t),
      );
      expect(singleOnPassSeat).toHaveLength(0);
      const played = cups.filter((c) => c.kickoffAt < NOW);
      expect(
        d.tickets.filter((t) => t.source === 'season_pass' && played.some((c) => c.id === t.matchId))
          .length,
      ).toBeGreaterThan(0);
    });
  });

  describe('season passes and loans', () => {
    it('has a few dozen passes across the three tiers, some bought for someone else', () => {
      const current = d.passes.filter((p) => p.seasonLabel === '2026/2027');
      expect(current).toHaveLength(36);
      const tier = (p: (typeof d.passes)[number]) =>
        sectorByCode.get(seatById.get(p.seatId)!.section)!.priceCategory;
      expect(current.filter((p) => tier(p) === 'vip')).toHaveLength(4);
      expect(current.filter((p) => tier(p) === 'lower')).toHaveLength(12);
      expect(current.filter((p) => tier(p) === 'upper')).toHaveLength(20);
      expect(current.every((p) => p.status === 'active')).toBe(true);
      expect(current.filter((p) => p.holderUserId !== p.userId).length).toBeGreaterThanOrEqual(8);
      expect(
        d.passes.filter((p) => p.seasonLabel === '2025/2026').every((p) => p.status === 'expired'),
      ).toBe(true);
      expect(d.passes.some((p) => p.seasonLabel === '2025/2026')).toBe(true);
    });

    it('has loans in every state the application produces, and none it does not', () => {
      expect(d.loans.map((l) => l.status).sort()).toEqual([
        'accepted',
        'cancelled',
        'cancelled',
        'completed',
        'expired',
        'pending',
        'pending',
        'used',
        'used',
        'used',
      ]);
      expect(d.loans.some((l) => l.status === 'revoked')).toBe(false);
    });

    it("replaces the owner's entry with the borrower's for an accepted, used or completed loan", () => {
      for (const l of d.loans.filter((x) => ['accepted', 'used', 'completed'].includes(x.status))) {
        const pass = d.passes.find((p) => p.id === l.seasonPassId)!;
        const entries = d.tickets.filter(
          (t) => t.matchId === l.matchId && t.seatId === pass.seatId,
        );
        expect(entries).toHaveLength(1);
        expect(entries[0].source).toBe('loan');
        expect(entries[0].userId).toBe(l.borrowerUserId);
        expect(entries[0].status === 'used').toBe(l.status === 'used');
      }
    });

    it('never lends a pass to its own buyer or holder', () => {
      for (const l of d.loans) {
        const pass = d.passes.find((p) => p.id === l.seasonPassId)!;
        expect([pass.userId, pass.holderUserId]).not.toContain(l.borrowerUserId);
      }
    });

    it('sets up the named borrowing accounts', () => {
      const lent = d.loans.find(
        (l) => l.lenderUserId === user('kolcsonzo').id && l.status === 'used',
      )!;
      expect(lent.borrowerUserId).toBe(user('kolcsonvevo').id);
      const pending = d.loans.find((l) => l.borrowerUserId === user('meghivott').id)!;
      expect(pending.status).toBe('pending');
      expect(pending.expiresAt.getTime()).toBeGreaterThan(NOW.getTime());
      expect(pending.invitationToken).toHaveLength(48);
      expect(pending.lenderUserId).toBe(user('berletes').id);
    });

    it('has a pass bought for someone else by one named account and held by another', () => {
      const pass = d.passes.find((p) => p.userId === user('vevo').id)!;
      expect(pass.holderUserId).toBe(user('birtokos').id);
    });
  });

  describe('loyalty', () => {
    const rowsOf = (userId: string) => d.ledger.filter((l) => l.userId === userId);

    it("keeps each account's points equal to its ledger, and its tier at or above what its points give", () => {
      for (const u of d.users) {
        const rows = rowsOf(u.id);
        expect(u.loyaltyPoints).toBe(rows.reduce((a, r) => a + r.points, 0));
        const derived = tierRank(tierForPoints(u.loyaltyPoints).tier);
        expect(tierRank(u.loyaltyTier)).toBeGreaterThanOrEqual(derived);
        // a tier above the points is a kept tier, and carries when it was reached
        if (tierRank(u.loyaltyTier) > derived) expect(u.loyaltyTierReachedAt).not.toBeNull();
      }
    });

    it('credits every person who entered a match the attendance points once for it, and buying earns nothing', () => {
      // whose entry it is: a single ticket, its buyer; a pass entry, the holder; a loan, the borrower
      const holderOf = new Map(d.passes.map((p) => [p.id, p.holderUserId]));
      const entered = new Set<string>();
      for (const t of d.tickets.filter((x) => x.status === 'used')) {
        const who = t.source === 'season_pass' ? holderOf.get(t.seasonPassId!) : t.userId;
        if (who) entered.add(`match:${t.matchId}:${who}`);
      }
      const attendance = d.ledger.filter((l) => l.source === 'attendance');
      expect(attendance.map((l) => l.referenceId).sort()).toEqual([...entered].sort());
      expect(attendance.every((l) => l.points === 50)).toBe(true);
      expect(
        attendance.every(
          (l) => l.referenceId === `match:${l.referenceId.split(':')[1]}:${l.userId}`,
        ),
      ).toBe(true);
      // buying a ticket writes no ledger row, and the old per-entry pass award is gone
      expect(
        d.ledger.filter((l) => ['ticket_purchase', 'pass_attendance'].includes(l.source)),
      ).toEqual([]);
    });

    it('credits a borrower for the match they entered, and gives the lender only the loan points', () => {
      const used = d.loans.filter((l) => l.status === 'used');
      expect(used.length).toBeGreaterThan(0);
      for (const l of used) {
        const borrowed = d.tickets.find(
          (t) =>
            t.source === 'loan' && t.seasonPassId === l.seasonPassId && t.matchId === l.matchId,
        )!;
        const refs = d.ledger.filter((r) => r.source === 'attendance').map((r) => r.referenceId);
        expect(refs).toContain(`match:${borrowed.matchId}:${borrowed.userId}`);
        const lender = rowsOf(l.lenderUserId ?? '').filter((r) => r.source === 'pass_loan');
        expect(lender.length).toBeGreaterThan(0);
      }
    });

    it('a person with several tickets and a pass entry for one match earned once for it', () => {
      const perMatch = new Map<string, number>();
      for (const l of d.ledger.filter((x) => x.source === 'attendance')) {
        perMatch.set(l.referenceId, (perMatch.get(l.referenceId) ?? 0) + 1);
      }
      expect([...perMatch.values()].every((n) => n === 1)).toBe(true);
    });

    it('keeps a running balance that never goes below zero, with no two rows in one second', () => {
      const byUser = new Map<string, typeof d.ledger>();
      for (const r of d.ledger) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
      for (const rows of byUser.values()) {
        rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        let balance = 0;
        let last = -Infinity;
        for (const r of rows) {
          expect(r.createdAt.getTime()).toBeGreaterThan(last);
          last = r.createdAt.getTime();
          balance = Math.max(balance + r.points, 0);
          expect(r.balanceAfter).toBe(balance);
        }
      }
    });

    it('uses each (source, reference) once, and every pass and finished loan paid exactly once', () => {
      const keys = d.ledger.map((r) => `${r.source}|${r.referenceId}`);
      expect(new Set(keys).size).toBe(keys.length);
      const refs = new Set(d.ledger.map((r) => r.referenceId));
      // the pass points go to the HOLDER's account; a pass for a holder without one credits nobody
      for (const p of d.passes) {
        const row = d.ledger.find((r) => r.referenceId === `season_pass:${p.id}`);
        if (p.holderUserId) expect(row?.userId).toBe(p.holderUserId);
        else expect(row).toBeUndefined();
      }
      for (const l of d.loans.filter((x) => ['used', 'completed'].includes(x.status))) {
        expect(refs.has(`loan:${l.id}`)).toBe(true);
      }
    });

    it('converts the balance at each season turn, keeping 70% as the carry-over job does', () => {
      const rows = rowsOf(user('arany').id);
      const conversions = rows.filter((r) => r.source === 'season_carryover');
      expect(conversions.length).toBeGreaterThanOrEqual(1);
      for (const carry of conversions) {
        const before = rows
          .filter((r) => r.createdAt < carry.createdAt)
          .reduce((a, r) => a + r.points, 0);
        expect(carry.points).toBe(-Math.floor((before * 30) / 100));
        expect(carry.type).toBe('expiry');
        expect(carry.referenceId).toMatch(new RegExp(`^season:\\d{4}-06-30:${user('arany').id}$`));
      }
      expect(new Set(conversions.map((c) => c.referenceId)).size).toBe(conversions.length);
    });

    it('gets KTE Legenda by attending, not by buying: a pass in every season, every home match, three conversions', () => {
      const legenda = user('legenda');
      const rows = rowsOf(legenda.id);
      expect(legenda.loyaltyTier).toBe(LoyaltyTier.PLATINUM);
      // no purchase points at all: the points are registration, profile, passes and attendance
      expect(rows.filter((r) => r.source === 'ticket_purchase')).toHaveLength(0);
      const bySource = (src: string) => rows.filter((r) => r.source === src).length;
      expect(bySource('season_pass_purchase')).toBeGreaterThanOrEqual(4);
      expect(bySource('attendance')).toBeGreaterThan(50);
      expect(bySource('season_carryover')).toBeGreaterThanOrEqual(3);
      // the pass covers every home match, the cup ties included: no single ticket of this account
      const bought = d.tickets.filter((t) => t.userId === legenda.id && t.source === 'single');
      expect(bought).toHaveLength(0);
    });

    it('puts one named account in each tier, by real points', () => {
      expect(user('lila').loyaltyTier).toBe(LoyaltyTier.BRONZE);
      expect(user('ezust').loyaltyTier).toBe(LoyaltyTier.SILVER);
      expect(user('arany').loyaltyTier).toBe(LoyaltyTier.GOLD);
      expect(user('legenda').loyaltyTier).toBe(LoyaltyTier.PLATINUM);
    });

    it('spreads the crowd over all four tiers: most fans are Lila (they attend a few matches), a few reach the top', () => {
      // Loyalty measures attendance: 50 points a match, at most about 1,300 a season even with a pass,
      // so the tiers above Ezüst are rare by design.
      const fans = d.users.filter((u) => u.role === 'fan');
      const count = (tier: LoyaltyTier) => fans.filter((u) => u.loyaltyTier === tier).length;
      expect(count(LoyaltyTier.BRONZE) / fans.length).toBeLessThan(0.92);
      expect(count(LoyaltyTier.SILVER) / fans.length).toBeGreaterThan(0.05);
      expect(count(LoyaltyTier.GOLD)).toBeGreaterThanOrEqual(1);
      expect(count(LoyaltyTier.PLATINUM)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('the other named accounts', () => {
    it('has a fan with nothing, one with an upcoming ticket and one with used tickets', () => {
      const own = (key: string) => d.tickets.filter((t) => t.userId === user(key).id);
      expect(own('ures')).toHaveLength(0);
      expect(user('ures').loyaltyPoints).toBe(100);
      const upcoming = own('jegyes');
      expect(upcoming.length).toBeGreaterThan(0);
      expect(
        upcoming.every((t) => t.status === 'paid' && matchById(t.matchId).kickoffAt > NOW),
      ).toBe(true);
      const used = own('hasznalt');
      expect(used.length).toBeGreaterThan(0);
      expect(used.every((t) => t.status === 'used' && t.scannedAt !== null)).toBe(true);
    });

    it('has a pass holder with entries behind her', () => {
      const pass = d.passes.find(
        (p) => p.userId === user('berletes').id && p.seasonLabel === '2026/2027',
      )!;
      expect(pass).toBeDefined();
      expect(
        d.tickets.filter((t) => t.seasonPassId === pass.id && t.status === 'used').length,
      ).toBeGreaterThan(3);
    });
  });

  it('builds the same data again from the same seed', () => {
    const again = buildDemoDataset(input());
    expect(again.tickets).toHaveLength(d.tickets.length);
    expect(again.tickets[0].id).toBe(d.tickets[0].id);
    expect(again.ledger[ledgerMid(again)].id).toBe(d.ledger[ledgerMid(d)].id);
  }, 120_000);
});

function ledgerMid(x: DemoDataset): number {
  return Math.floor(x.ledger.length / 2);
}
