import { EntityManager } from 'typeorm';
import { TIER_DEFINITIONS } from '../../modules/loyalty/loyalty.constants';
import {
  PASS_SEAT_FROM_SQL,
  SEAT_FREE_FOR_PASS_SQL,
} from '../../modules/season-passes/season-pass-seat-rule';
import { PRICE_MODIFIER } from '../stadium-layout';
import { HOME_TEAM } from './data';
import { DEMO_ID_PREFIX } from './rng';

const P = `${DEMO_ID_PREFIX}-%`;

export interface AuditResult {
  name: string;
  violations: number;
}

async function count(manager: EntityManager, sql: string, params: unknown[] = []): Promise<number> {
  const rows = (await manager.query(sql, params)) as Array<{ n: string | number }>;
  return Number(rows[0]?.n ?? 0);
}

/** The pass tiers, in the order the season-pass page shows them. */
export const PASS_TIER_CODES = ['vip', 'lower', 'upper'] as const;

/**
 * "Plenty" of free seats for a season pass in a tier: this share of the tier's seats, and at
 * least this many. The demo must always leave a visitor something to buy.
 */
export const MIN_FREE_PASS_SHARE = 0.05;
export const MIN_FREE_PASS_SEATS = 20;

/** Free seats per pass tier by THE pass-seat rule (season-pass-seat-rule.ts), read from the database. */
export async function freePassSeatsByTier(
  manager: EntityManager,
): Promise<Array<{ tier: string; total: number; free: number }>> {
  const label = (await manager.query(
    'SELECT season_label AS label FROM season_pass_prices WHERE is_active = 1 AND id NOT LIKE ? ORDER BY valid_until DESC LIMIT 1',
    [P],
  )) as Array<{ label: string }>;
  if (label.length === 0) return [];
  const rows = (await manager.query(
    `SELECT c.price_category AS tier, COUNT(*) AS total, SUM(${SEAT_FREE_FOR_PASS_SQL}) AS free ${PASS_SEAT_FROM_SQL} ` +
      'WHERE c.price_category IS NOT NULL AND c.is_away = 0 AND s.is_active = 1 GROUP BY c.price_category',
    [label[0].label, label[0].label],
  )) as Array<{ tier: string; total: string; free: string | null }>;
  return PASS_TIER_CODES.map((tier) => {
    const r = rows.find((x) => x.tier === tier);
    return { tier, total: Number(r?.total ?? 0), free: Number(r?.free ?? 0) };
  });
}

/**
 * What the season-pass page's savings panel works from, read from the database the way the
 * service does: per tier, the home matches still to come that the pass covers, bought one by
 * one at the tier's seat price, against the (fixed, never prorated) pass price.
 */
export async function savingsByTier(
  manager: EntityManager,
): Promise<Array<{ tier: string; matches: number; separate: number; pass: number }>> {
  const prices = (await manager.query(
    'SELECT section AS tier, price, season_label AS label, valid_until AS validUntil FROM season_pass_prices WHERE is_active = 1 AND id NOT LIKE ?',
    [P],
  )) as Array<{ tier: string; price: string | number; label: string; validUntil: Date }>;
  if (prices.length === 0) return [];
  const latest = prices.reduce((a, b) => (b.validUntil > a.validUntil ? b : a));
  const ofSeason = prices.filter((p) => p.label === latest.label);
  const upcoming = (await manager.query(
    "SELECT base_price AS basePrice FROM matches WHERE id LIKE ? AND home_team = ? AND is_season_pass_eligible = 1 AND status <> 'cancelled' AND kickoff_at > NOW() AND kickoff_at < DATE_ADD(?, INTERVAL 1 DAY)",
    [P, HOME_TEAM, latest.validUntil],
  )) as Array<{ basePrice: string | number }>;
  return PASS_TIER_CODES.map((tier) => {
    const modifier = Number(PRICE_MODIFIER[tier]);
    const separate = upcoming.reduce(
      (sum, m) => sum + Math.round(Number(m.basePrice) * modifier),
      0,
    );
    const pass = Number(ofSeason.find((p) => p.tier === tier)?.price ?? 0);
    return { tier, matches: upcoming.length, separate, pass };
  });
}

const tierCase = (column: string): string =>
  'CASE ' +
  [...TIER_DEFINITIONS]
    .reverse()
    .map((t) => `WHEN ${column} >= ${t.minPoints} THEN '${t.tier}'`)
    .join(' ') +
  ' END';

/**
 * Checks, from the database and not from the generator's own model, that nothing written
 * breaks a rule the application relies on. Every check counts violations: 0 is a pass.
 */
export async function auditDemoData(manager: EntityManager): Promise<AuditResult[]> {
  const checks: Array<[string, string, unknown[]]> = [
    [
      'no ticket on an away-section seat (the portal never sells it)',
      'SELECT COUNT(*) n FROM tickets t JOIN seats s ON s.id = t.seat_id JOIN sectors c ON c.code = s.section WHERE c.is_away = 1 AND t.id LIKE ?',
      [P],
    ],
    [
      'no season pass on an away-section seat',
      'SELECT COUNT(*) n FROM season_passes sp JOIN seats s ON s.id = sp.seat_id JOIN sectors c ON c.code = s.section WHERE c.is_away = 1 AND sp.id LIKE ?',
      [P],
    ],
    [
      'no single-match ticket on a pass seat for a match the pass is valid for (a cup tie is not covered, so its pass seats are sold like any other)',
      "SELECT COUNT(*) n FROM tickets t JOIN season_passes sp ON sp.seat_id = t.seat_id JOIN matches m ON m.id = t.match_id WHERE t.source = 'single' AND t.id LIKE ? AND m.is_season_pass_eligible = 1 AND m.kickoff_at >= sp.valid_from AND m.kickoff_at < DATE_ADD(sp.valid_until, INTERVAL 1 DAY)",
      [P],
    ],
    [
      'one pass per seat per season',
      'SELECT COUNT(*) n FROM (SELECT seat_id FROM season_passes WHERE id LIKE ? GROUP BY seat_id, season_label HAVING COUNT(*) > 1) x',
      [P],
    ],
    [
      'one pass per account per season (holders)',
      'SELECT COUNT(*) n FROM (SELECT holder_user_id FROM season_passes WHERE id LIKE ? AND holder_user_id IS NOT NULL GROUP BY holder_user_id, season_label HAVING COUNT(*) > 1) x',
      [P],
    ],
    [
      "every account's points equal the sum of its loyalty ledger",
      'SELECT COUNT(*) n FROM users u LEFT JOIN (SELECT user_id, SUM(points) s FROM loyalty_transactions GROUP BY user_id) l ON l.user_id = u.id WHERE u.id LIKE ? AND COALESCE(l.s, 0) <> u.loyalty_points',
      [P],
    ],
    [
      "every account's tier matches its points",
      `SELECT COUNT(*) n FROM users u WHERE u.id LIKE ? AND u.loyalty_tier <> ${tierCase('u.loyalty_points')}`,
      [P],
    ],
    [
      'ledger running balance: each balance_after = previous balance + points (never below 0)',
      'SELECT COUNT(*) n FROM (SELECT balance_after, points, LAG(balance_after, 1, 0) OVER (PARTITION BY user_id ORDER BY created_at, id) prev FROM loyalty_transactions WHERE user_id LIKE ?) x WHERE x.balance_after <> GREATEST(x.prev + x.points, 0)',
      [P],
    ],
    [
      'every single ticket earned its points exactly once (ticket:<id>)',
      "SELECT COUNT(*) n FROM tickets t LEFT JOIN loyalty_transactions l ON l.source = 'ticket_purchase' AND l.reference_id = CONCAT('ticket:', t.id) WHERE t.id LIKE ? AND t.source = 'single' AND l.id IS NULL",
      [P],
    ],
    [
      'no ticket-purchase points without a ticket',
      "SELECT COUNT(*) n FROM loyalty_transactions l LEFT JOIN tickets t ON l.reference_id = CONCAT('ticket:', t.id) WHERE l.source = 'ticket_purchase' AND l.user_id LIKE ? AND t.id IS NULL",
      [P],
    ],
    [
      'every pass earned its points; every used/completed loan paid its lender',
      "SELECT (SELECT COUNT(*) FROM season_passes sp LEFT JOIN loyalty_transactions l ON l.source = 'season_pass_purchase' AND l.reference_id = CONCAT('season_pass:', sp.id) WHERE sp.id LIKE ? AND l.id IS NULL) + (SELECT COUNT(*) FROM pass_loans pl LEFT JOIN loyalty_transactions l ON l.source = 'pass_loan' AND l.reference_id = CONCAT('loan:', pl.id) WHERE pl.id LIKE ? AND pl.status IN ('used','completed') AND l.id IS NULL) n",
      [P, P],
    ],
    [
      'a used ticket has a scan time; no other ticket has one',
      "SELECT COUNT(*) n FROM tickets WHERE id LIKE ? AND ((status = 'used' AND scanned_at IS NULL) OR (status <> 'used' AND scanned_at IS NOT NULL))",
      [P],
    ],
    [
      'no purchase after kickoff, in the future, or before the account existed',
      "SELECT COUNT(*) n FROM tickets t JOIN matches m ON m.id = t.match_id JOIN users u ON u.id = t.user_id WHERE t.id LIKE ? AND t.source = 'single' AND (t.created_at >= m.kickoff_at OR t.created_at > NOW() OR t.created_at < u.created_at)",
      [P],
    ],
    [
      'no ticket costs more than the list price, or nothing',
      "SELECT COUNT(*) n FROM tickets t JOIN matches m ON m.id = t.match_id JOIN seats s ON s.id = t.seat_id WHERE t.id LIKE ? AND t.source = 'single' AND (t.price_paid <= 0 OR t.price_paid > ROUND(m.base_price * s.price_modifier))",
      [P],
    ],
    [
      'every accepted/used/completed loan has its borrowed entry, and every borrowed entry its loan',
      "SELECT (SELECT COUNT(*) FROM pass_loans l LEFT JOIN tickets t ON t.season_pass_id = l.season_pass_id AND t.match_id = l.match_id AND t.source = 'loan' WHERE l.id LIKE ? AND l.status IN ('accepted','used','completed') AND t.id IS NULL) + (SELECT COUNT(*) FROM tickets t WHERE t.id LIKE ? AND t.source = 'loan' AND NOT EXISTS (SELECT 1 FROM pass_loans l WHERE l.season_pass_id = t.season_pass_id AND l.match_id = t.match_id AND l.status IN ('accepted','used','completed'))) n",
      [P, P],
    ],
    [
      "a used loan's borrowed entry is used, and only then",
      "SELECT COUNT(*) n FROM pass_loans l JOIN tickets t ON t.season_pass_id = l.season_pass_id AND t.match_id = l.match_id AND t.source = 'loan' WHERE l.id LIKE ? AND ((l.status = 'used') <> (t.status = 'used'))",
      [P],
    ],
    [
      'no waitlist (it exists only for a sold-out match, and there is none)',
      'SELECT COUNT(*) n FROM waitlist WHERE id LIKE ? OR user_id LIKE ?',
      [P, P],
    ],
    [
      'no sold-out match: none has the status, and no home match has every seat taken',
      "SELECT COUNT(*) n FROM matches m WHERE m.id LIKE ? AND (m.status = 'sold_out' OR (m.capacity > 0 AND (SELECT COUNT(*) FROM tickets t WHERE t.match_id = m.id AND t.status IN ('pending_payment','paid','used')) >= m.capacity))",
      [P],
    ],
    [
      'no season-pass entry ticket for a match still ahead (the application creates it only when the holder opens the QR or is scanned)',
      "SELECT COUNT(*) n FROM tickets t JOIN matches m ON m.id = t.match_id WHERE t.id LIKE ? AND t.source = 'season_pass' AND m.kickoff_at > NOW()",
      [P],
    ],
    [
      'away matches have no tickets and no stock',
      'SELECT COUNT(*) n FROM matches m LEFT JOIN tickets t ON t.match_id = m.id WHERE m.id LIKE ? AND m.home_team <> ? AND (t.id IS NOT NULL OR m.capacity <> 0)',
      [P, HOME_TEAM],
    ],
    [
      'no cancelled match (that flow is not built)',
      "SELECT COUNT(*) n FROM matches WHERE id LIKE ? AND status = 'cancelled'",
      [P],
    ],
    [
      'no demo row points at a missing parent',
      'SELECT (SELECT COUNT(*) FROM tickets t LEFT JOIN seats s ON s.id = t.seat_id WHERE t.id LIKE ? AND s.id IS NULL) + (SELECT COUNT(*) FROM season_passes p LEFT JOIN seats s ON s.id = p.seat_id WHERE p.id LIKE ? AND s.id IS NULL) n',
      [P, P],
    ],
  ];
  const out: AuditResult[] = [];
  for (const [name, sql, params] of checks) {
    out.push({ name, violations: await count(manager, sql, params) });
  }
  // A season pass must be buyable in every tier: each keeps plenty of free seats by the pass rule.
  const tiers = await freePassSeatsByTier(manager);
  const short = PASS_TIER_CODES.filter((code) => {
    const t = tiers.find((x) => x.tier === code);
    return !t || t.free < Math.max(MIN_FREE_PASS_SEATS, Math.ceil(MIN_FREE_PASS_SHARE * t.total));
  });
  out.push({
    name: `every pass tier has plenty of free seats (at least ${MIN_FREE_PASS_SEATS} and ${100 * MIN_FREE_PASS_SHARE}% of the tier, by the pass-seat rule)`,
    violations: short.length,
  });
  // The savings panel must show a saving in every tier, with only part of the season left.
  const savings = await savingsByTier(manager);
  out.push({
    name: 'buying the remaining home matches one by one costs more than the pass, in every tier',
    violations: PASS_TIER_CODES.filter((code) => {
      const s = savings.find((x) => x.tier === code);
      return !s || s.pass <= 0 || s.separate <= s.pass;
    }).length,
  });
  return out;
}

const pct = (part: number, whole: number): string =>
  whole === 0 ? '-' : `${((100 * part) / whole).toFixed(1)}%`;

function percentile(sorted: number[], q: number): number {
  return sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/** The headline figures, read back from the database. */
export async function demoFigures(
  manager: EntityManager,
  season: { validFrom: string; validUntil: string },
): Promise<string[]> {
  const out: string[] = [];
  const rows = async <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await manager.query(sql, params)) as T[];
  const win = [season.validFrom, season.validUntil];

  const users = await rows<{ role: string; n: string }>(
    'SELECT role, COUNT(*) n FROM users WHERE id LIKE ? GROUP BY role',
    [P],
  );
  out.push(`Accounts: ${users.map((u) => `${u.n} ${u.role}`).join(', ')}`);

  const matches = await rows<{ status: string; n: string }>(
    'SELECT status, COUNT(*) n FROM matches WHERE id LIKE ? GROUP BY status',
    [P],
  );
  out.push(`Matches: ${matches.map((m) => `${m.n} ${m.status}`).join(', ')}`);
  const league = await rows<{ home: string; n: string }>(
    "SELECT (home_team = ?) home, COUNT(*) n FROM matches WHERE id LIKE ? AND competition = 'NB2' AND kickoff_at >= ? AND kickoff_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY home",
    [HOME_TEAM, P, ...win],
  );
  const homeN = league.find((l) => Number(l.home) === 1)?.n ?? 0;
  const awayN = league.find((l) => Number(l.home) === 0)?.n ?? 0;
  out.push(
    `League season ${season.validFrom.slice(0, 4)}/${season.validUntil.slice(0, 4)}: ${homeN} home + ${awayN} away = ${Number(homeN) + Number(awayN)} rounds`,
  );

  const bySource = await rows<{ source: string; status: string; n: string }>(
    'SELECT source, status, COUNT(*) n FROM tickets WHERE id LIKE ? GROUP BY source, status ORDER BY source, status',
    [P],
  );
  const totalTickets = bySource.reduce((a, r) => a + Number(r.n), 0);
  out.push(`Tickets in total: ${totalTickets}`);
  out.push(`  ${bySource.map((r) => `${r.source}/${r.status} ${r.n}`).join(', ')}`);

  const passes = await rows<{ label: string; tier: string; n: string }>(
    "SELECT sp.season_label label, COALESCE(c.price_category, '?') tier, COUNT(*) n FROM season_passes sp JOIN seats s ON s.id = sp.seat_id JOIN sectors c ON c.code = s.section WHERE sp.id LIKE ? GROUP BY label, tier ORDER BY label, tier",
    [P],
  );
  out.push(`Season passes: ${passes.map((p) => `${p.label} ${p.tier} ${p.n}`).join(', ')}`);
  const loans = await rows<{ status: string; n: string }>(
    'SELECT status, COUNT(*) n FROM pass_loans WHERE id LIKE ? GROUP BY status',
    [P],
  );
  out.push(`Loans: ${loans.map((l) => `${l.status} ${l.n}`).join(', ')}`);
  out.push(
    `Loyalty ledger rows: ${await count(manager, 'SELECT COUNT(*) n FROM loyalty_transactions WHERE user_id LIKE ?', [P])}`,
  );

  // Occupancy of the home matches already played (the live one included).
  const [seatCounts] = await rows<{ sellable: string; total: string }>(
    'SELECT SUM(c.is_away = 0) sellable, COUNT(*) total FROM seats s JOIN sectors c ON c.code = s.section WHERE s.is_active = 1',
  );
  const sellable = Number(seatCounts.sellable);
  const played = await rows<{ id: string; occupied: string }>(
    "SELECT m.id, COUNT(t.id) occupied FROM matches m LEFT JOIN tickets t ON t.match_id = m.id AND t.status IN ('pending_payment','paid','used') WHERE m.id LIKE ? AND m.home_team = ? AND m.competition = 'NB2' AND m.kickoff_at <= NOW() AND m.kickoff_at >= ? AND m.kickoff_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY m.id",
    [P, HOME_TEAM, ...win],
  );
  if (played.length > 0) {
    const share = played.map((p) => Number(p.occupied) / sellable);
    const avg = share.reduce((a, b) => a + b, 0) / share.length;
    out.push(
      `Average occupancy of the ${played.length} league home matches played so far: ${(100 * avg).toFixed(1)}% of the ${sellable} sellable seats ` +
        `(range ${(100 * Math.min(...share)).toFixed(0)}-${(100 * Math.max(...share)).toFixed(0)}%)`,
    );
  }
  const [fullest] = await rows<{ sold: string; cap: string; opponent: string }>(
    "SELECT COUNT(t.id) sold, MAX(m.capacity) cap, MAX(m.away_team) opponent FROM matches m LEFT JOIN tickets t ON t.match_id = m.id AND t.status IN ('pending_payment','paid','used') WHERE m.id LIKE ? AND m.home_team = ? AND m.kickoff_at > NOW() AND m.is_season_pass_eligible = 1 GROUP BY m.id ORDER BY COUNT(t.id) DESC LIMIT 1",
    [P, HOME_TEAM],
  );
  if (fullest)
    out.push(
      `Fullest upcoming league match (v ${fullest.opponent}): ${fullest.sold} of ${fullest.cap} seats ticketed = ${pct(Number(fullest.sold), Number(fullest.cap))}`,
    );
  for (const s of await savingsByTier(manager)) {
    out.push(
      `Pass saving, ${s.tier}: ${s.matches} remaining home matches one by one ${s.separate} Ft vs pass ${s.pass} Ft = ${s.separate - s.pass >= 0 ? '+' : ''}${s.separate - s.pass} Ft`,
    );
  }
  for (const t of await freePassSeatsByTier(manager)) {
    out.push(
      `Free season-pass seats, ${t.tier}: ${t.free} of ${t.total} (${pct(t.free, t.total)})`,
    );
  }

  const [redemption] = await rows<{ used: string; total: string }>(
    "SELECT SUM(t.status = 'used') used, COUNT(*) total FROM tickets t JOIN matches m ON m.id = t.match_id WHERE t.id LIKE ? AND t.source = 'single' AND t.status IN ('paid','used') AND m.kickoff_at <= NOW() AND m.kickoff_at >= ? AND m.kickoff_at < DATE_ADD(?, INTERVAL 1 DAY)",
    [P, ...win],
  );
  out.push(
    `Redemption (current season, single tickets, matches played): ${redemption.used} of ${redemption.total} scanned = ${pct(Number(redemption.used), Number(redemption.total))}`,
  );

  const tiers = await rows<{ tier: string; n: string }>(
    "SELECT loyalty_tier tier, COUNT(*) n FROM users WHERE id LIKE ? AND role = 'fan' GROUP BY loyalty_tier",
    [P],
  );
  const fans = tiers.reduce((a, t) => a + Number(t.n), 0);
  out.push(
    'Loyalty tiers (fans): ' +
      TIER_DEFINITIONS.map((t) => {
        const n = Number(tiers.find((x) => x.tier === t.tier)?.n ?? 0);
        return `${t.label} ${n} (${pct(n, fans)})`;
      }).join(', '),
  );

  const perAccount = await rows<{ n: string }>(
    "SELECT COUNT(*) n FROM tickets WHERE id LIKE ? AND source = 'single' GROUP BY user_id",
    [P],
  );
  const counts = perAccount.map((r) => Number(r.n)).sort((a, b) => a - b);
  out.push(
    `Single tickets per buying account: ${counts.length} accounts, median ${percentile(counts, 0.5)}, 90th percentile ${percentile(counts, 0.9)}, most ${counts[counts.length - 1] ?? 0}`,
  );

  // Which sectors filled: the halfway-line rule, read back.
  const sectors = await rows<{
    section: string;
    arc: string;
    position: number;
    sold: string;
    seats: string;
  }>(
    "SELECT c.code section, c.arc arc, c.position position, COALESCE(x.sold, 0) sold, COUNT(s.id) seats FROM sectors c JOIN seats s ON s.section = c.code LEFT JOIN (SELECT st.section, COUNT(*) sold FROM tickets t JOIN seats st ON st.id = t.seat_id JOIN matches m ON m.id = t.match_id WHERE t.id LIKE ? AND t.source = 'single' AND t.status IN ('paid','used') AND m.competition = 'NB2' AND m.status = 'finished' AND m.kickoff_at >= ? AND m.kickoff_at < DATE_ADD(?, INTERVAL 1 DAY) GROUP BY st.section) x ON x.section = c.code WHERE c.is_away = 0 GROUP BY c.code, c.arc, c.position, x.sold ORDER BY c.arc, c.position",
    [P, ...win],
  );
  const finished = await count(
    manager,
    "SELECT COUNT(*) n FROM matches WHERE id LIKE ? AND home_team = ? AND competition = 'NB2' AND status = 'finished' AND kickoff_at >= ? AND kickoff_at < DATE_ADD(?, INTERVAL 1 DAY)",
    [P, HOME_TEAM, ...win],
  );
  if (finished > 0) {
    for (const arc of ['upper', 'lower']) {
      out.push(
        `Sector fill over the ${finished} finished league home matches, ${arc} arc west to east: ` +
          sectors
            .filter((s) => s.arc === arc)
            .map(
              (s) =>
                `${s.section} ${((100 * Number(s.sold)) / (Number(s.seats) * finished)).toFixed(0)}%`,
            )
            .join('  '),
      );
    }
  }
  return out;
}
