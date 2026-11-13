import { OverviewMatch, SeatSale } from '../../../shared/models/admin.model';
import {
  barHeights,
  csvField,
  headerSubtitle,
  heatmapInterpretation,
  matchesCsv,
  niceMax,
  occupancyTone,
  periodOptions,
  sectionSummaries,
  takenPercent,
} from './admin-logic';

const match = (over: Partial<OverviewMatch> = {}): OverviewMatch => ({
  matchId: 'm1',
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Újpest FC',
  kickoffAt: '2026-07-12T16:00:00.000Z',
  status: 'finished',
  final: true,
  ticketCount: 10,
  passEntryCount: 2,
  occupiedSeats: 12,
  capacity: 20,
  occupancyPercent: 60,
  revenue: 35000,
  ...over,
});

describe('occupancyTone', () => {
  it('marks a sell-out, a low house and everything between', () => {
    expect(occupancyTone(100)).toBe('full');
    expect(occupancyTone(49)).toBe('low');
    expect(occupancyTone(50)).toBe('normal');
    expect(occupancyTone(99)).toBe('normal');
  });
});

describe('header text', () => {
  it('names the season, and the refresh time when known', () => {
    expect(periodOptions('2026/2027')[0].label).toBe('2026/2027 szezon');
    expect(headerSubtitle('2026/2027', null)).toBe('2026/2027 szezon');
    expect(headerSubtitle(null, null)).toBe('Nincs aktív szezon');
    expect(headerSubtitle('2026/2027', '2026-11-13T13:32:00.000Z')).toMatch(
      /^2026\/2027 szezon · frissítve \d{2}:\d{2}$/,
    );
  });
});

describe('CSV', () => {
  it('defuses spreadsheet formulas and quotes separators', () => {
    expect(csvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvField('+36 1')).toBe("'+36 1");
    expect(csvField('a;b')).toBe('"a;b"');
    expect(csvField(35000)).toBe('35000');
  });

  it('writes a header and one row per match, separated by semicolons', () => {
    const lines = matchesCsv([match(), match({ final: false, revenue: 0 })])
      .trimEnd()
      .split('\r\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(
      'Mérkőzés;Kezdés;Végleges;Eladott jegy;Bérletes belépő;Foglaltság (%);Bevétel (Ft)',
    );
    expect(lines[1]).toBe('Kecskeméti TE – Újpest FC;2026-07-12T16:00:00.000Z;igen;10;2;60;35000');
    expect(lines[2]).toContain(';nem;');
  });
});

describe('bar chart scale', () => {
  it('rounds the axis up to a readable number', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(35000)).toBe(50000);
    expect(niceMax(100000)).toBe(100000);
    expect(niceMax(1)).toBe(1);
  });

  it('draws each bar in proportion to what was charged', () => {
    const bars = barHeights([match({ revenue: 25000 }), match({ revenue: 50000 })], 200, 50000);
    expect(bars.map((b) => b.height)).toEqual([100, 200]);
  });
});

describe('seat heatmap', () => {
  const seat = (section: string, number: number, taken: number): SeatSale => ({
    section,
    row: '1',
    number,
    taken,
  });

  it('turns a count into a share of the played matches', () => {
    expect(takenPercent(3, 4)).toBe(75);
    expect(takenPercent(5, 4)).toBe(100);
    expect(takenPercent(1, 0)).toBe(0);
  });

  const sectors = [
    { code: 'F', name: 'F szektor', arc: 'lower', position: 10, isAway: false },
    { code: 'D/1', name: 'D/1 szektor', arc: 'upper', position: 1, isAway: false },
    { code: 'VENDÉG', name: 'Vendég szektor', arc: 'lower', position: 1, isAway: true },
  ] as const;

  it('averages per section, in stadium order, and reads the result out in one line', () => {
    const seats = [
      seat('F', 1, 4),
      seat('F', 2, 4),
      seat('D/1', 1, 0),
      seat('D/1', 2, 2),
    ];
    const summaries = sectionSummaries(seats, 4, sectors);
    // D/1 (upper arc) comes before F (lower arc), whatever the order of the seats
    expect(summaries.map((s) => s.section)).toEqual(['D/1', 'F']);
    expect(summaries.map((s) => s.averagePercent)).toEqual([25, 100]);
    expect(summaries.map((s) => s.name)).toEqual(['D/1 szektor', 'F szektor']);

    const line = heatmapInterpretation(summaries, 4);
    // "az F szektor", not "a F szektor": F is spoken "ef"
    expect(line).toContain('Az F szektor ülései fogynak leggyakrabban (átlagosan 100%)');
    // "a D/1 szektor": D is spoken "dé"
    expect(line).toContain('a D/1 szektor ülései legritkábban (25%)');
    expect(line).not.toContain('A F ');
    expect(line).not.toContain('a F ');
  });

  it('leaves the away section out of the reading: it sells nothing because it cannot be bought', () => {
    const seats = [seat('F', 1, 4), seat('D/1', 1, 2), seat('VENDÉG', 1, 0)];
    const summaries = sectionSummaries(seats, 4, sectors);
    expect(summaries.find((s) => s.section === 'VENDÉG')?.isAway).toBe(true);
    const line = heatmapInterpretation(summaries, 4);
    expect(line).not.toContain('Vendég');
    expect(line).toContain('legritkábban (50%)');
  });

  it('falls back to the code when the server sends no sector list', () => {
    const summaries = sectionSummaries([seat('A', 1, 4), seat('B', 1, 0)], 4);
    expect(summaries.map((s) => s.name)).toEqual(['A szektor', 'B szektor']);
  });

  it('says nothing when there is nothing to interpret', () => {
    expect(heatmapInterpretation([], 0)).toBe('');
    expect(
      heatmapInterpretation(
        [{ section: 'A', name: 'A szektor', isAway: false, seatCount: 1, averagePercent: 0 }],
        0,
      ),
    ).toBe('');
  });
});
