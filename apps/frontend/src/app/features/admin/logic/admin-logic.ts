import {
  OverviewMatch,
  OverviewPeriod,
  SeatSale,
  SeatSaleSector,
} from '../../../shared/models/admin.model';
import { hungarianArticle } from '../../../shared/utils/hungarian-article';
import { sectorName } from '../../../shared/utils/sector-name';

/** An occupancy below this is flagged amber in the table. */
export const LOW_OCCUPANCY_PERCENT = 50;

export type OccupancyTone = 'full' | 'low' | 'normal';

export function occupancyTone(percent: number): OccupancyTone {
  if (percent >= 100) return 'full';
  if (percent < LOW_OCCUPANCY_PERCENT) return 'low';
  return 'normal';
}

export interface PeriodOption {
  readonly value: OverviewPeriod;
  readonly label: string;
}

export function periodOptions(seasonLabel: string | null): readonly PeriodOption[] {
  return [
    { value: 'season', label: seasonLabel ? `${seasonLabel} szezon` : 'Szezon' },
    { value: '90d', label: 'Elmúlt 90 nap és a közelgők' },
    { value: '30d', label: 'Elmúlt 30 nap és a közelgők' },
  ];
}

/** "2026/2027 szezon · frissítve 14:32" - the page header subtitle. */
export function headerSubtitle(seasonLabel: string | null, generatedAt: string | null): string {
  const season = seasonLabel ? `${seasonLabel} szezon` : 'Nincs aktív szezon';
  if (!generatedAt) return season;
  const when = new Date(generatedAt);
  if (Number.isNaN(when.getTime())) return season;
  const time = when.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  return `${season} · frissítve ${time}`;
}

export function fixtureLabel(match: Pick<OverviewMatch, 'homeTeam' | 'awayTeam'>): string {
  return `${match.homeTeam} – ${match.awayTeam}`;
}

// ---- CSV ---------------------------------------------------------------------

/** One CSV field. A leading = + - @ would be run as a formula by a spreadsheet, so it is defused. */
export function csvField(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The match table as CSV: `;`-separated, because Hungarian spreadsheets expect it. */
export function matchesCsv(matches: readonly OverviewMatch[]): string {
  const header = [
    'Mérkőzés',
    'Kezdés',
    'Végleges',
    'Eladott jegy',
    'Bérletes belépő',
    'Foglaltság (%)',
    'Bevétel (Ft)',
  ];
  const rows = matches.map((m) => [
    fixtureLabel(m),
    m.kickoffAt,
    m.final ? 'igen' : 'nem',
    m.ticketCount,
    m.passEntryCount,
    m.occupancyPercent,
    m.revenue,
  ]);
  return [header, ...rows].map((r) => r.map(csvField).join(';')).join('\r\n') + '\r\n';
}

// ---- Bar chart ---------------------------------------------------------------

/** The top of the value axis: the next "round" number above the largest value. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

export interface Bar {
  readonly match: OverviewMatch;
  /** Height in the same unit as `plotHeight`. */
  readonly height: number;
}

export function barHeights(
  matches: readonly OverviewMatch[],
  plotHeight: number,
  axisMax: number,
): readonly Bar[] {
  return matches.map((match) => ({
    match,
    height: axisMax > 0 ? Math.round((match.revenue / axisMax) * plotHeight) : 0,
  }));
}

// ---- Seat heatmap ------------------------------------------------------------

/** How often a seat was taken, 0..100. */
export function takenPercent(taken: number, matchCount: number): number {
  if (matchCount <= 0) return 0;
  return Math.min(100, Math.round((taken / matchCount) * 100));
}

export interface SectionSummary {
  readonly section: string;
  /** Display name from the sectors table. */
  readonly name: string;
  /** The away section: not part of the scale, never named in the reading. */
  readonly isAway: boolean;
  readonly seatCount: number;
  readonly averagePercent: number;
}

/**
 * Per-sector averages, in stadium order when the server sends the sectors (upper
 * arc first, each arc west to east), else by code. A seat whose sector is not
 * listed is still counted, under its code.
 */
export function sectionSummaries(
  seats: readonly SeatSale[],
  matchCount: number,
  sectors: readonly SeatSaleSector[] = [],
): readonly SectionSummary[] {
  const bySection = new Map<string, { seats: number; taken: number }>();
  for (const s of seats) {
    const entry = bySection.get(s.section) ?? { seats: 0, taken: 0 };
    entry.seats += 1;
    entry.taken += s.taken;
    bySection.set(s.section, entry);
  }
  // Stadium order from each sector's own arc and position (upper arc first, west to east),
  // so the result does not depend on the order the list arrives in.
  const meta = new Map(
    sectors.map((s) => [s.code, { sector: s, rank: (s.arc === 'upper' ? 0 : 1000) + s.position }]),
  );
  return [...bySection.entries()]
    .map(([section, e]) => ({
      section,
      name: meta.get(section)?.sector.name ?? sectorName(section),
      isAway: meta.get(section)?.sector.isAway ?? false,
      seatCount: e.seats,
      averagePercent: takenPercent(e.taken, e.seats * matchCount),
    }))
    .sort(
      (a, b) =>
        (meta.get(a.section)?.rank ?? Number.MAX_SAFE_INTEGER) -
          (meta.get(b.section)?.rank ?? Number.MAX_SAFE_INTEGER) ||
        a.section.localeCompare(b.section, 'hu'),
    );
}

/** "Az F szektor": the article agrees with how the name is spoken ("az F", "a D/1", "a VIP"). */
function withArticleCapital(name: string): string {
  const article = hungarianArticle(name);
  return `${article === 'az' ? 'Az' : 'A'} ${name}`;
}

/**
 * One line on what the map shows; empty when there is nothing to interpret. The
 * away section is left out: it is never sold through the portal, so "it sells
 * least" would say nothing about demand.
 */
export function heatmapInterpretation(
  summaries: readonly SectionSummary[],
  matchCount: number,
): string {
  const sellable = summaries.filter((s) => !s.isAway);
  if (matchCount <= 0 || sellable.length === 0) return '';
  const sorted = [...sellable].sort((a, b) => b.averagePercent - a.averagePercent);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (top.averagePercent === bottom.averagePercent) {
    return `Minden szektor hasonlóan fogy: átlagosan ${top.averagePercent}%-uk kel el.`;
  }
  return (
    `${withArticleCapital(top.name)} ülései fogynak leggyakrabban (átlagosan ${top.averagePercent}%), ` +
    `${hungarianArticle(bottom.name)} ${bottom.name} ülései legritkábban (${bottom.averagePercent}%). ` +
    `Az arány ${matchCount} lejátszott meccsre vonatkozik.`
  );
}
