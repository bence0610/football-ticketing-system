import { TestBed } from '@angular/core/testing';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { SeatStatus, SectorSummary } from '../../../shared/models/seat.model';
import { SeatDetailPanelComponent } from './seat-detail-panel/seat-detail-panel.component';
import { SeatGridComponent } from './seat-grid/seat-grid.component';
import { SectorSummaryComponent } from './sector-summary/sector-summary.component';
import { StadiumMapComponent } from './stadium-map/stadium-map.component';

const sector = (
  section: string,
  arc: 'upper' | 'lower',
  position: number,
  over: Partial<SectorSummary> = {},
): SectorSummary => ({
  section,
  name: section === 'VIP' ? 'VIP' : section === 'VENDÉG' ? 'Vendég szektor' : `${section} szektor`,
  arc,
  position,
  gate: 2,
  priceCategory: 'lower',
  isAway: false,
  covered: false,
  total: 200,
  available: 150,
  locked: 10,
  sold: 40,
  occupancyRatio: 0.25,
  minPrice: 3900,
  maxPrice: 3900,
  ...over,
});

// Out of order on purpose: the list and the map must follow the data's arc and position.
const DATA: SectorSummary[] = [
  sector('VIP', 'lower', 7, { priceCategory: 'vip', minPrice: 8750, maxPrice: 8750, gate: 1, covered: true }),
  sector('VENDÉG', 'lower', 1, { isAway: true, priceCategory: null, gate: 3, available: 0, sold: 0, locked: 0, occupancyRatio: 0 }),
  sector('D/1', 'upper', 1, { priceCategory: 'upper', minPrice: 2800, maxPrice: 2800, covered: true }),
  sector('C/2', 'upper', 4, { priceCategory: 'upper', minPrice: 2800, maxPrice: 2800, covered: true }),
  sector('K', 'lower', 5),
];

const text = (el: Element | null | undefined): string =>
  (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('the sector list (the map fallback)', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideAnimationsAsync()] }));

  function render(selected: string | null = null): { el: HTMLElement; picked: string[]; select: HTMLSelectElement } {
    const f = TestBed.createComponent(SectorSummaryComponent);
    const picked: string[] = [];
    f.componentRef.setInput('summaries', DATA);
    f.componentRef.setInput('selectedSection', selected);
    f.componentInstance.sectorSelected.subscribe((s: string) => picked.push(s));
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return { el, picked, select: el.querySelector('select') as HTMLSelectElement };
  }

  const options = (el: HTMLElement): HTMLOptionElement[] =>
    Array.from(el.querySelectorAll('option[data-section]'));

  it('is one labelled dropdown, not a wall of cards', () => {
    const { el, select } = render();
    expect(el.querySelectorAll('select').length).toBe(1);
    expect(el.querySelector('mat-card')).toBeNull();
    expect(el.querySelector('.kte-sector-card')).toBeNull();
    expect(text(el.querySelector(`label[for="${select.id}"]`))).toBe('Szektor kiválasztása a térkép nélkül');
  });

  it('groups the sectors by arc, upper arc first, each in west-to-east order', () => {
    const { el } = render();
    expect(Array.from(el.querySelectorAll('optgroup')).map((g) => g.label)).toEqual([
      'Felső ív',
      'Főépület oldala',
    ]);
    expect(options(el).map((o) => o.getAttribute('data-section'))).toEqual(['D/1', 'C/2', 'VENDÉG', 'K', 'VIP']);
  });

  it('shows each sector with its free seats and price', () => {
    const { el } = render();
    const by = (code: string): string => text(el.querySelector(`option[data-section="${CSS.escape(code)}"]`));
    expect(by('D/1')).toContain('D/1 szektor');
    expect(by('D/1')).toContain('150 szabad');
    expect(by('D/1').replace(/\s/g, '')).toContain('2800Ft');
    expect(by('VIP')).toContain('1-es kapu');
    expect(by('VIP').replace(/\s/g, '')).toContain('8750Ft');
    // the tier is named in plain words: three of them
    expect(by('D/1')).toContain('Felső ív');
    expect(by('K')).toContain('Alsó ív');
    expect(by('VIP')).toContain('VIP');
  });

  it('says a full sector is gone instead of quoting a price', () => {
    const f = TestBed.createComponent(SectorSummaryComponent);
    f.componentRef.setInput('summaries', [sector('K', 'lower', 5, { available: 0, sold: 190, occupancyRatio: 1 })]);
    f.detectChanges();
    const t = text((f.nativeElement as HTMLElement).querySelector('option[data-section="K"]'));
    expect(t).toContain('elfogyott');
    expect(t).not.toContain('Ft');
  });

  it('selects a sector when it is picked, and preselects the chosen one', () => {
    const { select, picked } = render('K');
    expect(select.value).toBe('K');
    select.value = 'VIP';
    select.dispatchEvent(new Event('change'));
    expect(picked).toEqual(['VIP']);
  });

  it('lists the away section as disabled, says why, and never selects it', () => {
    const { el, select, picked } = render();
    const away = el.querySelector('option[data-section="VENDÉG"]') as HTMLOptionElement;
    expect(away.disabled).toBeTrue();
    expect(text(away)).toContain('a portálon nem vásárolható');
    // no seat counts and no price for a section nobody can buy
    expect(text(away)).not.toContain('szabad');
    expect(text(away)).not.toContain('Ft');
    select.value = 'VENDÉG';
    select.dispatchEvent(new Event('change'));
    expect(picked).toEqual([]);
  });
});

describe('the stadium map', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideAnimationsAsync()] }));

  function render(selected: string | null = null): { el: HTMLElement; picked: string[] } {
    const f = TestBed.createComponent(StadiumMapComponent);
    const picked: string[] = [];
    f.componentRef.setInput('sectorSummary', DATA);
    f.componentRef.setInput('selectedSection', selected);
    f.componentInstance.sectorSelected.subscribe((s: string) => picked.push(s));
    f.detectChanges();
    return { el: f.nativeElement as HTMLElement, picked };
  }

  it('draws one shape per sector in the data, with its code', () => {
    const { el } = render();
    const codes = Array.from(el.querySelectorAll('.kte-map__sector')).map((g) => g.getAttribute('data-section'));
    expect(codes.sort()).toEqual(['C/2', 'D/1', 'K', 'VENDÉG', 'VIP']);
    expect(text(el.querySelector('[data-section="D/1"] .kte-map__code'))).toBe('D/1');
  });

  it('colours by price tier, not by how full the sector is', () => {
    const { el } = render();
    const fill = (code: string): string =>
      (el.querySelector(`[data-section="${code}"] path.kte-map__shape`) as SVGElement).style.fill;
    // three tiers, three different fills; the two upper-arc sectors share one
    expect(new Set([fill('VIP'), fill('C/2'), fill('K'), fill('D/1')]).size).toBe(3);
    expect(fill('C/2')).toBe(fill('D/1'));
  });

  it('outlines a full sector and leaves a quiet one plain', () => {
    const f = TestBed.createComponent(StadiumMapComponent);
    f.componentRef.setInput('sectorSummary', [
      sector('K', 'lower', 5, { available: 0, sold: 200, occupancyRatio: 1 }),
      sector('J', 'lower', 6),
    ]);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-section="K"] .kte-map__shape')?.getAttribute('data-outline')).toBe('full');
    expect(el.querySelector('[data-section="J"] .kte-map__shape')?.getAttribute('data-outline')).toBe('none');
  });

  it('selects a sector on click and on Enter', () => {
    const { el, picked } = render();
    const k = el.querySelector('[data-section="K"]') as HTMLElement;
    k.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    k.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    expect(picked).toEqual(['K', 'K']);
    expect(k.getAttribute('role')).toBe('button');
    expect(k.getAttribute('tabindex')).toBe('0');
  });

  it('shows the away section hatched, as not selectable, and says why in one line', () => {
    const { el, picked } = render();
    const away = el.querySelector('[data-section="VENDÉG"]') as HTMLElement;
    expect(away.getAttribute('data-away')).toBe('true');
    expect(away.getAttribute('role')).toBe('img');
    expect(away.getAttribute('tabindex')).toBeNull();
    expect(away.getAttribute('aria-label')).toContain('a portálon nem vásárolható');
    away.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    away.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
    expect(picked).toEqual([]);
    // the reason, in a line of its own
    expect(text(el.querySelector('[data-testid="away-note"]'))).toBe(
      'A Vendég szektor a vendégszurkolóké, a portálon nem vásárolható.',
    );
    expect(el.querySelector('[data-testid="legend-away"]')).not.toBeNull();
  });

  it('draws the four gates from the plan', () => {
    const { el } = render();
    const gates = Array.from(el.querySelectorAll('.kte-map__gates [data-gate]')).map((g) =>
      g.getAttribute('data-gate'),
    );
    expect(gates).toEqual(['1', '2', '3', '4']);
  });

  it('has a legend with the tiers that are on sale and their lowest price, never the away section', () => {
    const { el } = render();
    const tiers = Array.from(el.querySelectorAll('[data-testid="legend-tier"]')).map((li) => text(li));
    expect(tiers.length).toBe(3);
    expect(tiers[0]).toContain('VIP');
    expect(tiers[0].replace(/\s/g, '')).toContain('8750Ft');
    expect(tiers[1]).toContain('Alsó ív');
    expect(tiers[1].replace(/\s/g, '')).toContain('3900Ft');
    expect(tiers[2]).toContain('Felső ív');
    expect(tiers[2].replace(/\s/g, '')).toContain('2800Ft');
    // the away section is in no tier and not in the legend's tiers
    expect(tiers.join(' ')).not.toContain('Vendég');
  });

  it('is built from the data alone: a sector the map has never heard of is drawn too', () => {
    const f = TestBed.createComponent(StadiumMapComponent);
    f.componentRef.setInput('sectorSummary', [sector('Z/9', 'upper', 1)]);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-section="Z/9"]')).not.toBeNull();
  });
});

describe('the seat grid and the seat panel', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideAnimationsAsync()] }));

  it('the grid header names the sector, its arc and its gate', () => {
    const f = TestBed.createComponent(SeatGridComponent);
    f.componentRef.setInput('section', 'D/1');
    f.componentRef.setInput('sectorName', 'D/1 szektor');
    f.componentRef.setInput('arc', 'upper');
    f.componentRef.setInput('gate', 2);
    f.componentRef.setInput('seats', []);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(text(el.querySelector('h3'))).toContain('D/1 szektor');
    expect(text(el.querySelector('[data-testid="grid-arc"]'))).toBe('Felső ív');
    expect(text(el.querySelector('[data-testid="grid-gate"]'))).toBe('2-es kapu');
  });

  it('lists rows in numeric order: 1, 2, 10', () => {
    const seat = (row: string, id: string): SeatStatus => ({
      id,
      section: 'K',
      row,
      number: 1,
      category: 'standard',
      price: 3500,
      status: 'available',
      isAccessible: false,
    });
    const f = TestBed.createComponent(SeatGridComponent);
    f.componentRef.setInput('section', 'K');
    f.componentRef.setInput('seats', [seat('10', 'a'), seat('2', 'b'), seat('1', 'c')]);
    f.componentInstance.ngOnChanges({
      seats: { currentValue: [], previousValue: null, firstChange: true, isFirstChange: () => true },
      section: { currentValue: 'K', previousValue: null, firstChange: true, isFirstChange: () => true },
    });
    f.detectChanges();
    const labels = Array.from((f.nativeElement as HTMLElement).querySelectorAll('.kte-seat-grid__row-label')).map(
      (l) => text(l),
    );
    expect(labels).toEqual(['1. sor', '2. sor', '10. sor']);
  });

  it('the seat panel names the sector and the gate', () => {
    const seat: SeatStatus = {
      id: 's1',
      section: 'VIP',
      row: '1',
      number: 3,
      category: 'vip',
      price: 8750,
      status: 'available',
      isAccessible: false,
    };
    const f = TestBed.createComponent(SeatDetailPanelComponent);
    f.componentRef.setInput('seat', seat);
    f.componentRef.setInput('sectorName', 'VIP');
    f.componentRef.setInput('gate', 1);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(text(el.querySelector('.kte-seat-detail__chip'))).toBe('VIP');
    expect(text(el.querySelector('[data-testid="detail-gate"]'))).toBe('1-es kapu');
  });
});
