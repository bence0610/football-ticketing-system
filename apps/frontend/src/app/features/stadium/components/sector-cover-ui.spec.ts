import { TestBed } from '@angular/core/testing';
import { SeatStatus, SectorSummary } from '../../../shared/models/seat.model';
import { coverDescription, coverLabel } from '../../../shared/utils/sector-cover';
import { SeatDetailPanelComponent } from './seat-detail-panel/seat-detail-panel.component';
import { SeatGridComponent } from './seat-grid/seat-grid.component';
import { SectorSummaryComponent } from './sector-summary/sector-summary.component';
import { StadiumMapComponent } from './stadium-map/stadium-map.component';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

function summary(
  section: string,
  covered: boolean | null,
  over: Partial<SectorSummary> = {},
): SectorSummary {
  return {
    section,
    name: section === 'VIP' ? 'VIP' : `${section} szektor`,
    arc: 'upper',
    position: 1,
    gate: 2,
    priceCategory: 'upper',
    isAway: false,
    covered,
    total: 100,
    available: 60,
    locked: 10,
    sold: 30,
    occupancyRatio: 0.4,
    minPrice: 3500,
    maxPrice: 3500,
    ...over,
  };
}

// Real sectors: the whole upper arc and VIP are covered, the rest of the lower arc is open.
const SUMMARIES: SectorSummary[] = [
  summary('D/1', true, { arc: 'upper', position: 1 }),
  summary('K', false, { arc: 'lower', position: 5 }),
  summary('VIP', true, { arc: 'lower', position: 7, priceCategory: 'vip', gate: 1 }),
  summary('E', false, { arc: 'lower', position: 11, gate: 1 }),
];

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

  it('sector list options say fedett / nyitott from the flag, in stadium order (upper arc first)', () => {
    const f = TestBed.createComponent(SectorSummaryComponent);
    f.componentRef.setInput('summaries', SUMMARIES);
    f.detectChanges();
    const options = Array.from((f.nativeElement as HTMLElement).querySelectorAll('option[data-section]'));
    // D/1 (upper arc), then K, VIP, E on the lower arc
    expect(options.map((o) => o.getAttribute('data-section'))).toEqual(['D/1', 'K', 'VIP', 'E']);
    expect(options.map((o) => /\bfedett\b/.test(o.textContent ?? ''))).toEqual([true, false, true, false]);
    expect(options.map((o) => /\bnyitott\b/.test(o.textContent ?? ''))).toEqual([false, true, false, true]);
  });

  it('a sector option with no data claims neither a roof nor a gate', () => {
    const f = TestBed.createComponent(SectorSummaryComponent);
    f.componentRef.setInput('summaries', [summary('X', null, { arc: null, position: null, gate: null })]);
    f.detectChanges();
    const t = (f.nativeElement as HTMLElement).querySelector('option[data-section="X"]')?.textContent ?? '';
    expect(t).not.toMatch(/fedett|nyitott|kapu/);
  });

  it('the map marks covered sectors with a roof and puts the coverage in the accessible name', () => {
    const f = TestBed.createComponent(StadiumMapComponent);
    f.componentRef.setInput('sectorSummary', SUMMARIES);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    // one roof per covered sector: D/1 and VIP
    expect(el.querySelectorAll('[data-testid="map-cover"]').length).toBe(2);
    const names = Array.from(el.querySelectorAll('.kte-map__sector')).map(
      (g) => g.getAttribute('aria-label') ?? '',
    );
    expect(names.some((n) => n.includes('fedett szektor'))).toBeTrue();
    expect(names.some((n) => n.includes('nyitott szektor'))).toBeTrue();
  });

  it("the seat grid header shows the selected sector's coverage, and nothing when unknown", () => {
    const f = TestBed.createComponent(SeatGridComponent);
    f.componentRef.setInput('section', 'B/1');
    f.componentRef.setInput('seats', []);
    f.componentRef.setInput('covered', true);
    f.detectChanges();
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-testid="grid-cover"]')?.textContent?.trim(),
    ).toBe('Fedett');

    f.componentRef.setInput('covered', false);
    f.detectChanges();
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-testid="grid-cover"]')?.textContent?.trim(),
    ).toBe('Nyitott');

    f.componentRef.setInput('covered', null);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="grid-cover"]')).toBeNull();
  });

  it('the seat panel shows it before the user locks the seat', () => {
    const seat: SeatStatus = {
      id: 's1',
      section: 'J',
      row: '1',
      number: 3,
      category: 'standard',
      price: 3900,
      status: 'available',
      isAccessible: false,
    };
    const f = TestBed.createComponent(SeatDetailPanelComponent);
    f.componentRef.setInput('seat', seat);
    f.componentRef.setInput('covered', false);
    f.detectChanges();
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-testid="detail-cover"]')?.textContent?.trim(),
    ).toBe('Nyitott');
  });
});
