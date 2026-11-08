import { TestBed } from '@angular/core/testing';
import { SeatStatus, SectorSummary } from '../../../shared/models/seat.model';
import { coverDescription, coverLabel } from '../../../shared/utils/sector-cover';
import { SeatDetailPanelComponent } from './seat-detail-panel/seat-detail-panel.component';
import { SeatGridComponent } from './seat-grid/seat-grid.component';
import { SectorSummaryComponent } from './sector-summary/sector-summary.component';
import { StadiumMapComponent } from './stadium-map/stadium-map.component';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

function summary(section: string, covered: boolean | null): SectorSummary {
  return { section, covered, total: 100, available: 60, locked: 10, sold: 30, occupancyRatio: 0.4, minPrice: 3500, maxPrice: 3500 };
}

const SUMMARIES: SectorSummary[] = [summary('A', false), summary('B', true), summary('C', false), summary('VIP', true)];

describe('sector coverage wording', () => {
  it('names a flag, and says nothing for no data', () => {
    expect(coverLabel(true)).toBe('Fedett');
    expect(coverLabel(false)).toBe('Nyitott');
    expect(coverLabel(null)).toBeNull();
    expect(coverLabel(undefined)).toBeNull();
    expect(coverDescription(true)).toContain('fedett');
    expect(coverDescription(false)).toContain('nem fedett');
    expect(coverDescription(null)).toBeNull();
  });
});

describe('coverage in the sector selection', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideAnimationsAsync()] }));

  it('sector cards show Fedett / Nyitott from the flag (VIP and B covered; A and C open)', () => {
    const f = TestBed.createComponent(SectorSummaryComponent);
    f.componentRef.setInput('summaries', SUMMARIES);
    f.detectChanges();
    const chips = Array.from((f.nativeElement as HTMLElement).querySelectorAll('[data-testid="sector-cover"]')).map((e) => e.textContent?.trim());
    expect(chips).toEqual(['Nyitott', 'Fedett', 'Nyitott', 'Fedett']);
  });

  it('a sector card with no data shows no chip', () => {
    const f = TestBed.createComponent(SectorSummaryComponent);
    f.componentRef.setInput('summaries', [summary('X', null)]);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="sector-cover"]')).toBeNull();
  });

  it('the map labels each sector and puts it in the accessible name', () => {
    const f = TestBed.createComponent(StadiumMapComponent);
    f.componentRef.setInput('sectorSummary', SUMMARIES);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const labels = Array.from(el.querySelectorAll('[data-testid="map-cover"]')).map((e) => e.textContent?.trim());
    expect(labels.sort()).toEqual(['Fedett', 'Fedett', 'Nyitott', 'Nyitott']);
    const names = Array.from(el.querySelectorAll('.kte-map__sector')).map((g) => g.getAttribute('aria-label') ?? '');
    expect(names.some((n) => n.includes('fedett szektor'))).toBeTrue();
    expect(names.some((n) => n.includes('nyitott szektor'))).toBeTrue();
  });

  it('the seat grid header shows the selected sector\'s coverage, and nothing when unknown', () => {
    const f = TestBed.createComponent(SeatGridComponent);
    f.componentRef.setInput('section', 'B');
    f.componentRef.setInput('seats', []);
    f.componentRef.setInput('covered', true);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="grid-cover"]')?.textContent?.trim()).toBe('Fedett');

    f.componentRef.setInput('covered', false);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="grid-cover"]')?.textContent?.trim()).toBe('Nyitott');

    f.componentRef.setInput('covered', null);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="grid-cover"]')).toBeNull();
  });

  it('the seat panel shows it before the user locks the seat', () => {
    const seat: SeatStatus = { id: 's1', section: 'A', row: '1', number: 3, category: 'premium', price: 5250, status: 'available', isAccessible: false };
    const f = TestBed.createComponent(SeatDetailPanelComponent);
    f.componentRef.setInput('seat', seat);
    f.componentRef.setInput('covered', false);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="detail-cover"]')?.textContent?.trim()).toBe('Nyitott');
  });
});
