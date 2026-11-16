import { TIER_DEFINITIONS } from '../../modules/loyalty/loyalty.constants';
import { HOME_TEAM } from './data';
import type { DemoDataset } from './dataset';
import type { SeatRef, SectorRef } from './demand';

const pct = (part: number, whole: number): string =>
  whole === 0 ? '-' : `${((100 * part) / whole).toFixed(1)}%`;

function percentile(sorted: number[], q: number): number {
  return sorted.length === 0
    ? 0
    : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

/**
 * The headline figures computed from the dataset in memory: what `--dry-run` prints, and
 * the same numbers `--report` reads back from the database after a real run.
 */
export function summaryLines(
  data: DemoDataset,
  context: {
    now: Date;
    seats: readonly SeatRef[];
    sectors: readonly SectorRef[];
    seasonFrom: Date;
    seasonUntil: Date;
  },
): string[] {
  const out: string[] = [];
  const seatById = new Map(context.seats.map((s) => [s.id, s]));
  const sectorByCode = new Map(context.sectors.map((s) => [s.code, s]));
  const matchById = new Map(data.matches.map((m) => [m.id, m]));
  const from = context.seasonFrom.getTime();
  const until = context.seasonUntil.getTime() + 86_400_000;
  const now = context.now.getTime();
  const inSeason = (id: string): boolean => {
    const k = (matchById.get(id) as { kickoffAt: Date }).kickoffAt.getTime();
    return k >= from && k < until;
  };
  const sellable = context.seats.filter((s) => !sectorByCode.get(s.section)?.isAway).length;
  const bySource = new Map<string, number>();
  for (const t of data.tickets)
    bySource.set(`${t.source}/${t.status}`, (bySource.get(`${t.source}/${t.status}`) ?? 0) + 1);

  out.push(`Tickets in total: ${data.tickets.length}`);
  out.push(
    `  ${[...bySource]
      .sort()
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')}`,
  );

  const home = data.matches.filter(
    (m) =>
      m.homeTeam === HOME_TEAM &&
      m.competition === 'NB2' &&
      inSeason(m.id) &&
      m.kickoffAt.getTime() <= now,
  );
  const sold = new Map<string, number>();
  for (const t of data.tickets) {
    if (['paid', 'used', 'pending_payment'].includes(t.status))
      sold.set(t.matchId, (sold.get(t.matchId) ?? 0) + 1);
  }
  const shares = home.map((m) => (sold.get(m.id) ?? 0) / sellable);
  if (shares.length > 0) {
    const avg = shares.reduce((a, b) => a + b, 0) / shares.length;
    out.push(
      `Average occupancy of the ${home.length} league home matches played so far: ${(100 * avg).toFixed(1)}% of the ${sellable} sellable seats ` +
        `(range ${(100 * Math.min(...shares)).toFixed(0)}-${(100 * Math.max(...shares)).toFixed(0)}%)`,
    );
  }
  const soldOut = data.matches.find((m) => m.id === data.soldOutMatchId);
  if (soldOut)
    out.push(`Sold-out match: ${sold.get(soldOut.id) ?? 0} of ${soldOut.capacity} seats taken`);

  const played = data.tickets.filter(
    (t) =>
      t.source === 'single' &&
      ['paid', 'used'].includes(t.status) &&
      inSeason(t.matchId) &&
      (matchById.get(t.matchId) as { kickoffAt: Date }).kickoffAt.getTime() <= now,
  );
  const scanned = played.filter((t) => t.status === 'used').length;
  out.push(
    `Redemption (current season, single tickets, matches played): ${scanned} of ${played.length} scanned = ${pct(scanned, played.length)}`,
  );

  const fans = data.users.filter((u) => u.role === 'fan');
  out.push(
    'Loyalty tiers (fans): ' +
      TIER_DEFINITIONS.map((t) => {
        const n = fans.filter((u) => u.loyaltyTier === t.tier).length;
        return `${t.label} ${n} (${pct(n, fans.length)})`;
      }).join(', '),
  );

  const per = new Map<string, number>();
  for (const t of data.tickets)
    if (t.source === 'single') per.set(t.userId, (per.get(t.userId) ?? 0) + 1);
  const counts = [...per.values()].sort((a, b) => a - b);
  out.push(
    `Single tickets per buying account: ${counts.length} accounts, median ${percentile(counts, 0.5)}, 90th percentile ${percentile(counts, 0.9)}, most ${counts[counts.length - 1] ?? 0}`,
  );

  const finished = data.matches.filter(
    (m) =>
      m.homeTeam === HOME_TEAM &&
      m.competition === 'NB2' &&
      m.status === 'finished' &&
      inSeason(m.id),
  );
  const finishedIds = new Set(finished.map((m) => m.id));
  const fill = new Map<string, number>();
  for (const t of data.tickets) {
    if (
      t.source !== 'single' ||
      !finishedIds.has(t.matchId) ||
      !['paid', 'used'].includes(t.status)
    )
      continue;
    const code = (seatById.get(t.seatId) as SeatRef).section;
    fill.set(code, (fill.get(code) ?? 0) + 1);
  }
  if (finished.length > 0) {
    for (const arc of ['upper', 'lower'] as const) {
      const cells = context.sectors
        .filter((s) => s.arc === arc && !s.isAway)
        .sort((a, b) => a.position - b.position)
        .map((s) => {
          const seats = context.seats.filter((x) => x.section === s.code).length;
          return `${s.code} ${((100 * (fill.get(s.code) ?? 0)) / (seats * finished.length)).toFixed(0)}%`;
        });
      out.push(
        `Sector fill over the ${finished.length} finished league home matches, ${arc} arc west to east: ${cells.join('  ')}`,
      );
    }
  }
  return out;
}
