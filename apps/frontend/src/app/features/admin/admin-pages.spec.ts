import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Overview, OverviewMatch, SeatSales } from '../../shared/models/admin.model';
import { AdminApiService } from '../../shared/services/admin.api.service';
import { AdminShellComponent } from './admin-shell.component';
import { ADMIN_NAV } from './admin-nav';
import { SeatHeatmapPageComponent } from './heatmap/seat-heatmap.page';
import { RevenueStatsPageComponent } from './revenue/revenue-stats.page';

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const match = (over: Partial<OverviewMatch>): OverviewMatch => ({
  matchId: 'm',
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Újpest FC',
  kickoffAt: '2026-07-12T16:00:00.000Z',
  status: 'finished',
  final: true,
  isHome: true,
  ticketCount: 10,
  passesValid: null,
  passEntered: 0,
  occupiedSeats: 10,
  capacity: 20,
  occupancyPercent: 50,
  revenue: 35000,
  ...over,
});

function overview(over: Partial<Overview> = {}): Overview {
  return {
    season: { label: '2026/2027', validFrom: '2026-07-01', validUntil: '2027-06-30' },
    period: 'season',
    generatedAt: '2026-11-13T13:32:00.000Z',
    metrics: {
      revenue: 62500,
      ticketsSold: 17,
      passEntries: 3,
      averageOccupancyPercent: 75,
      finalMatchCount: 2,
      redemptionPercent: 60,
      scannedTickets: 6,
      playedTickets: 10,
    },
    seasonPasses: { basis: 'season', revenue: 0, passCount: 0, byTier: [] },
    matches: [
      match({ matchId: 'm1', occupancyPercent: 100, revenue: 35000 }),
      match({ matchId: 'm2', awayTeam: 'Paksi FC', occupancyPercent: 30, revenue: 12500 }),
      match({
        matchId: 'm3',
        awayTeam: 'Diósgyőr',
        final: false,
        status: 'on_sale',
        occupancyPercent: 60,
        revenue: 15000,
        passesValid: 36,
        passEntered: null,
      }),
    ],
    ...over,
  };
}

describe('AdminShellComponent', () => {
  function render(email = 'admin@kte.hu'): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AdminShellComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: { user: signal({ email }) } }],
    });
    const fixture = TestBed.createComponent(AdminShellComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists only the pages that exist, under "Áttekintés"', () => {
    const el = render();
    const links = Array.from(el.querySelectorAll('.admin__link')).map((a) => text(a));
    expect(links.some((l) => l.includes('Bevétel'))).toBe(true);
    expect(links.some((l) => l.includes('Ülés-hőtérkép'))).toBe(true);
    expect(links.length).toBe(2);
    expect(text(el.querySelector('.admin__group-label'))).toBe('Áttekintés');
  });

  it('has no dead links: the management pages that do not exist are not offered', () => {
    const el = render();
    for (const missing of ['Kezelés', 'Mérkőzések', 'Felhasználók', 'Beléptetési napló']) {
      expect(text(el)).not.toContain(missing);
    }
    // every entry in the config points at a route registered for the admin area
    expect(ADMIN_NAV.flatMap((g) => g.items.map((i) => i.route)).sort()).toEqual([
      '/admin/heatmap',
      '/admin/revenue',
    ]);
  });

  it('shows the signed-in admin address and the read-only notice', () => {
    const el = render('boss@kte.hu');
    expect(text(el.querySelector('[data-testid="admin-email"]'))).toBe('boss@kte.hu');
    const notice = text(el.querySelector('[data-testid="readonly-notice"]'));
    expect(notice).toContain('Csak olvasható');
    expect(notice).toContain('nem módosítható ár');
    expect(notice).toContain('nem törölhető mérkőzés');
    expect(notice).toContain('nem vonható vissza jegy');
    expect(notice).toContain('audit log');
    expect(notice).toContain('tudatos döntés');
  });
});

describe('RevenueStatsPageComponent', async () => {
  async function render(data: Overview): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [RevenueStatsPageComponent],
      providers: [{ provide: AdminApiService, useValue: { overview: () => of(data) } }],
    });
    const fixture = TestBed.createComponent(RevenueStatsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable(); // the period stream starts from an effect
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the four metric cards with their context, from the server figures', async () => {
    const el = await render(overview());
    const cards = Array.from(el.querySelectorAll('.metric'));
    expect(cards.length).toBe(4);
    expect(text(cards[0])).toContain('62 500');
    expect(text(cards[0])).toContain('ténylegesen terhelt');
    expect(text(cards[1])).toContain('17');
    expect(text(cards[1])).toContain('3 belépett bérletes');
    expect(text(cards[2])).toContain('75%');
    expect(text(cards[2])).toContain('2 lejátszott meccs');
    expect(text(cards[3])).toContain('60%');
    expect(text(cards[3])).toContain('6 / 10');
  });

  it('shows a dash and says why when there is no played match yet', async () => {
    const base = overview();
    const el = await render(
      overview({
        metrics: {
          ...base.metrics,
          averageOccupancyPercent: null,
          redemptionPercent: null,
          finalMatchCount: 0,
          playedTickets: 0,
          scannedTickets: 0,
        },
      }),
    );
    expect(text(el.querySelector('[data-testid="metric-occupancy"] [data-testid="metric-value"]'))).toBe('—');
    expect(text(el.querySelector('[data-testid="metric-redemption"] [data-testid="metric-context"]'))).toBe(
      'Még nem volt lejátszott meccs',
    );
  });

  it('draws a bar per match, grey and marked when the match is not final', async () => {
    const el = await render(overview());
    const bars = Array.from(el.querySelectorAll('[data-testid="revenue-bar"]'));
    expect(bars.length).toBe(3);
    expect(bars.map((b) => b.getAttribute('class'))).toEqual([
      'bar bar--final',
      'bar bar--final',
      'bar bar--open',
    ]);
    expect(text(el.querySelector('.legend'))).toContain('Jegybevétel');
    expect(text(el.querySelector('.legend'))).toContain('még tart az értékesítés');
    expect(el.querySelectorAll('.xlabel--open').length).toBe(1);
  });

  it('tabulates the matches, flagging a sell-out, a low house and a match not final', async () => {
    const el = await render(overview());
    const rows = Array.from(el.querySelectorAll('[data-testid="match-row"]'));
    expect(rows.length).toBe(3);
    const tones = rows.map((r) => r.querySelector('[data-testid="occupancy"]')?.getAttribute('data-tone'));
    expect(tones).toEqual(['full', 'low', 'normal']);
    expect(text(rows[0])).toContain('35 000');
    expect(text(rows[2])).toContain('36 érvényes bérlet');
    expect(el.querySelectorAll('[data-testid="not-final"]').length).toBe(1);
  });

  describe('an away match in the list', () => {
    const away = match({
      matchId: 'away-1',
      homeTeam: 'Szeged',
      awayTeam: 'Kecskeméti TE',
      isHome: false,
      ticketCount: null,
      passesValid: null,
      passEntered: null,
      occupiedSeats: null,
      capacity: null,
      occupancyPercent: null,
      revenue: null,
    });
    const withAway = (): Overview => {
      const base = overview();
      return { ...base, matches: [...base.matches, away] };
    };

    it('stays in the table, with a dash for tickets, occupancy and revenue, and is labelled', async () => {
      const el = await render(withAway());
      const rows = Array.from(el.querySelectorAll('[data-testid="match-row"]'));
      expect(rows.length).toBe(4);
      const row = rows[3];
      expect(text(row)).toContain('Szeged – Kecskeméti TE');
      expect(text(row.querySelector('[data-testid="away"]'))).toBe('idegenben');
      for (const id of ['no-tickets', 'no-occupancy', 'no-revenue']) {
        expect(text(row.querySelector(`[data-testid="${id}"]`))).toBe('–');
      }
      expect(row.querySelector('[data-testid="occupancy"]')).toBeNull();
      expect(text(row)).not.toContain('0%');
      expect(text(row)).not.toContain('Ft');
    });

    it('draws no bar for it, and the revenue tile counts home matches only', async () => {
      const el = await render(withAway());
      expect(el.querySelectorAll('[data-testid="revenue-bar"]').length).toBe(3);
      expect(text(el.querySelector('[data-testid="metric-revenue"]'))).toContain('3 hazai meccs');
    });
  });

  it('names the season and refresh time in the header and offers a CSV export', async () => {
    const el = await render(overview());
    expect(text(el.querySelector('[data-testid="admin-subtitle"]'))).toMatch(
      /^2026\/2027 szezon · frissítve \d{2}:\d{2}$/,
    );
    const button = el.querySelector('[data-testid="csv-export"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(el.querySelector('[data-testid="period-select"]')).not.toBeNull();
  });

  describe('season-pass revenue', () => {
    const passes: Overview['seasonPasses'] = {
      basis: 'season',
      revenue: 690000,
      passCount: 9,
      byTier: [
        { tier: 'vip', label: 'VIP', passCount: 2, revenue: 300000 },
        { tier: 'lower', label: 'Alsó karéj', passCount: 4, revenue: 260000 },
        { tier: 'upper', label: 'Felső karéj', passCount: 3, revenue: 130000 },
      ],
    };

    it('shows its own section with total, count, per-tier rows and the separation note', async () => {
      const el = await render(overview({ seasonPasses: passes }));
      const section = el.querySelector('[data-testid="season-passes"]');
      expect(section).not.toBeNull();
      expect(text(section?.querySelector('#passes-title'))).toBe('Bérletbevétel');
      expect(text(section?.querySelector('[data-testid="passes-note"]'))).toBe(
        'Egy bérlet egyetlen fizetés az egész szezonra, ezért nem osztjuk szét meccsekre.',
      );
      expect(text(section?.querySelector('[data-testid="passes-basis"]'))).toBe('Az aktív szezon összes bérlete');
      expect(text(section?.querySelector('[data-testid="passes-revenue"]'))).toContain('690 000');
      expect(text(section?.querySelector('[data-testid="passes-count"]'))).toContain('9');
      const rows = Array.from(section?.querySelectorAll('[data-testid="pass-tier-row"]') ?? []);
      expect(rows.length).toBe(3);
      expect(text(rows[0])).toContain('VIP');
      expect(text(rows[0])).toContain('2');
      expect(text(rows[0])).toContain('300 000');
      expect(text(rows[2])).toContain('Felső karéj');
      expect(text(rows[2])).toContain('130 000');
      expect(section?.querySelector('[data-testid="passes-empty"]')).toBeNull();
    });

    it('leaves the match revenue card, rows and bars untouched when passes are present', async () => {
      const el = await render(overview({ seasonPasses: passes }));
      const revenueValue = text(el.querySelector('[data-testid="metric-revenue"] [data-testid="metric-value"]'));
      expect(revenueValue).toContain('62 500');
      expect(revenueValue).not.toContain('752 500');
      expect(el.querySelectorAll('.metric').length).toBe(4);
      const rows = Array.from(el.querySelectorAll('[data-testid="match-row"]'));
      expect(rows.length).toBe(3);
      expect(text(rows[0])).toContain('35 000');
      expect(text(rows[1])).toContain('12 500');
      expect(text(rows[2])).toContain('15 000');
      // the season-pass section is not inside the match table
      expect(el.querySelector('[data-testid="matches-table"] [data-testid="pass-tier-row"]')).toBeNull();
      expect(el.querySelectorAll('[data-testid="revenue-bar"]').length).toBe(3);
    });

    it('says no pass was sold, and draws no tier table, when the count is zero', async () => {
      const el = await render(overview());
      const section = el.querySelector('[data-testid="season-passes"]');
      expect(text(section?.querySelector('[data-testid="passes-empty"]'))).toBe(
        'Ebben az időszakban nem adtak el bérletet.',
      );
      expect(section?.querySelector('[data-testid="passes-table"]')).toBeNull();
      expect(section?.querySelector('[data-testid="passes-revenue"]')).toBeNull();
      // the separation note stays, so the admin knows why passes are never in the match figures
      expect(section?.querySelector('[data-testid="passes-note"]')).not.toBeNull();
    });

    it('explains the different basis for a 30/90-day period', async () => {
      const el = await render(
        overview({ period: '30d', seasonPasses: { ...passes, basis: 'purchased_in_period' } }),
      );
      expect(text(el.querySelector('[data-testid="passes-basis"]'))).toBe(
        'Az időszakban megvásárolt bérletek (a meccsbevétel a mérkőzés időpontja szerint számít, ezért a két összeg alapja eltérő)',
      );
    });
  });
});

describe('SeatHeatmapPageComponent', async () => {
  async function render(data: SeatSales): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [SeatHeatmapPageComponent],
      providers: [{ provide: AdminApiService, useValue: { seatSales: () => of(data) } }],
    });
    const fixture = TestBed.createComponent(SeatHeatmapPageComponent);
    fixture.detectChanges();
    await fixture.whenStable(); // the period stream starts from an effect
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const sales = (matchCount: number): SeatSales => ({
    season: { label: '2026/2027', validFrom: '2026-07-01', validUntil: '2027-06-30' },
    generatedAt: '2026-11-13T13:32:00.000Z',
    matchCount,
    sectors: [
      { code: 'A', name: 'A szektor', arc: 'upper', position: 1, isAway: false },
      { code: 'B', name: 'B szektor', arc: 'upper', position: 2, isAway: false },
    ],
    seats: [
      { section: 'A', row: '1', number: 1, taken: 4 },
      { section: 'A', row: '1', number: 2, taken: 4 },
      { section: 'B', row: '1', number: 1, taken: 0 },
      { section: 'B', row: '1', number: 2, taken: 2 },
    ],
  });

  it('paints every seat by how often it sold, with a legend and one line of reading', async () => {
    const el = await render(sales(4));
    const cells = Array.from(el.querySelectorAll('[data-testid="heat-cell"]'));
    expect(cells.map((c) => c.getAttribute('data-percent'))).toEqual(['100', '100', '0', '50']);
    expect(el.querySelectorAll('[data-testid="heat-section"]').length).toBe(2);
    const legend = text(el.querySelector('.legend'));
    expect(legend).toContain('ritkán');
    expect(legend).toContain('mindig');
    expect(text(el.querySelector('[data-testid="heatmap-interpretation"]'))).toContain('A szektor');
  });

  it('says so, and draws nothing, before any match has been played', async () => {
    const el = await render(sales(0));
    expect(el.querySelector('[data-testid="heatmap-empty"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="heat-cell"]').length).toBe(0);
  });
});
