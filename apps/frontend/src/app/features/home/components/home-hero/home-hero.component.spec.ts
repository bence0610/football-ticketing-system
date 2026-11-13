import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatchListItem } from '../../../../shared/models/match.model';
import { SectorSummary } from '../../../../shared/models/seat.model';
import { HomeHeroComponent } from './home-hero.component';

const match: MatchListItem = {
  id: 'm1',
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Ferencváros',
  competition: 'NB1',
  venue: 'Széktói Stadion',
  kickoffAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  status: 'on_sale',
  basePrice: 2800,
  capacity: 5468,
  availableSeats: 1000,
  isHome: true,
  isSeasonPassEligible: true,
};

const sector = (section: string, over: Partial<SectorSummary>): SectorSummary => ({
  section,
  name: `${section} szektor`,
  arc: 'lower',
  position: 1,
  gate: 2,
  priceCategory: 'lower',
  isAway: false,
  covered: false,
  total: 100,
  available: 50,
  locked: 0,
  sold: 50,
  occupancyRatio: 0.5,
  minPrice: 3920,
  maxPrice: 3920,
  ...over,
});

describe('HomeHeroComponent price panel', () => {
  it('lists three tiers, not one row per sector, named as the rest of the app names them', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideNoopAnimations()] });
    const f = TestBed.createComponent(HomeHeroComponent);
    f.componentRef.setInput('match', match);
    f.componentRef.setInput('sectors', [
      ...['D/1', 'D/2', 'C/1', 'C/2', 'B/1', 'B/2', 'A/1', 'A/2'].map((c) =>
        sector(c, { arc: 'upper', priceCategory: 'upper', minPrice: 2800, maxPrice: 2800 }),
      ),
      ...['N', 'M', 'L', 'K', 'J', 'H', 'G', 'F', 'E'].map((c) => sector(c, {})),
      sector('VIP', { priceCategory: 'vip', minPrice: 7000, maxPrice: 7000 }),
    ]);
    f.detectChanges();
    const rows = Array.from((f.nativeElement as HTMLElement).querySelectorAll('[data-testid="hero-tier"]')).map(
      (r) => (r.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(rows.length).toBe(3);
    expect(rows[0]).toContain('VIP');
    expect(rows[0].replace(/\s/g, '')).toContain('7000Ft');
    expect(rows[1]).toContain('Alsó ív');
    expect(rows[1].replace(/\s/g, '')).toContain('3920Ft');
    expect(rows[2]).toContain('Felső ív');
    expect(rows[2].replace(/\s/g, '')).toContain('2800Ft');
  });
});
