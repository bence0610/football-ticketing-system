import { OverviewMatch, OverviewPeriod, SeatSale } from '../../../shared/models/admin.model';

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
  readonly seatCount: number;
  readonly averagePercent: number;
}

export function sectionSummaries(
  seats: readonly SeatSale[],
  matchCount: number,
): readonly SectionSummary[] {
  const bySection = new Map<string, { seats: number; taken: number }>();
  for (const s of seats) {
    const entry = bySection.get(s.section) ?? { seats: 0, taken: 0 };
    entry.seats += 1;
    entry.taken += s.taken;
    bySection.set(s.section, entry);
  }
  return [...bySection.entries()]
    .map(([section, e]) => ({
      section,
      seatCount: e.seats,
      averagePercent: takenPercent(e.taken, e.seats * matchCount),
    }))
    .sort((a, b) => a.section.localeCompare(b.section, 'hu'));
}

/** One line on what the map shows; empty when there is nothing to interpret. */
export function heatmapInterpretation(
  summaries: readonly SectionSummary[],
  matchCount: number,
): string {
  if (matchCount <= 0 || summaries.length === 0) return '';
  const sorted = [...summaries].sort((a, b) => b.averagePercent - a.averagePercent);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  if (top.averagePercent === bottom.averagePercent) {
    return `Minden szektor hasonlóan fogy: átlagosan ${top.averagePercent}%-uk kel el.`;
  }
  return (
    `A ${top.section} szektor ülései fogynak leggyakrabban (átlagosan ${top.averagePercent}%), ` +
    `a ${bottom.section} szektoré legritkábban (${bottom.averagePercent}%). ` +
    `Az arány ${matchCount} lejátszott meccsre vonatkozik.`
  );
}
