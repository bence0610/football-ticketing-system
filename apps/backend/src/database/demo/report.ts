import { EntityManager } from 'typeorm';
import { TIER_DEFINITIONS } from '../../modules/loyalty/loyalty.constants';
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
      "no single-match ticket on a pass seat during that pass's validity (seat occupancy rule)",
      "SELECT COUNT(*) n FROM tickets t JOIN season_passes sp ON sp.seat_id = t.seat_id JOIN matches m ON m.id = t.match_id WHERE t.source = 'single' AND t.id LIKE ? AND m.kickoff_at >= sp.valid_from AND m.kickoff_at < DATE_ADD(sp.valid_until, INTERVAL 1 DAY)",
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
      'the waitlist is only on a match whose seats are all taken',
      "SELECT COUNT(*) n FROM waitlist w JOIN matches m ON m.id = w.match_id WHERE w.id LIKE ? AND (SELECT COUNT(*) FROM tickets t WHERE t.match_id = m.id AND t.status IN ('pending_payment','paid','used')) < m.capacity",
      [P],
    ],
    [
      'nobody on the waitlist already has a place on that match',
      'SELECT COUNT(*) n FROM waitlist w JOIN tickets t ON t.match_id = w.match_id AND t.user_id = w.user_id WHERE w.id LIKE ?',
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
  const wait = await rows<{ status: string; n: string }>(
    'SELECT status, COUNT(*) n FROM waitlist WHERE id LIKE ? GROUP BY status',
    [P],
  );
  out.push(`Waitlist (sold-out match): ${wait.map((w) => `${w.status} ${w.n}`).join(', ')}`);
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
  const [soldOut] = await rows<{ sold: string; cap: string }>(
    "SELECT COUNT(t.id) sold, MAX(m.capacity) cap FROM matches m LEFT JOIN tickets t ON t.match_id = m.id AND t.status IN ('pending_payment','paid','used') WHERE m.id LIKE ? AND m.status = 'sold_out'",
    [P],
  );
  if (soldOut) out.push(`Sold-out match: ${soldOut.sold} of ${soldOut.cap} seats taken`);

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
