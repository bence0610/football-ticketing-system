import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { TestBed } from '@angular/core/testing';
import { CartItem } from '../../../../shared/models/cart.model';
import { SeatSummaryComponent } from './seat-summary.component';

registerLocaleData(localeHu);

const item = (seatNumber: number, price: number, over: Partial<CartItem> = {}): CartItem => ({
  seatId: `seat-${seatNumber}`,
  matchId: 'm1',
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Ellenfél',
  kickoffAt: new Date(Date.now() + 86_400_000).toISOString(),
  section: 'C/2',
  sectorName: 'C/2 szektor',
  row: '3',
  seatNumber,
  category: 'standard',
  price,
  ownerToken: 't',
  lockExpiresAtMs: Date.now() + 300_000,
  addedAtMs: Date.now(),
  ...over,
});

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SeatSummaryComponent', () => {
  function make(items: CartItem[], busy = false) {
    const f = TestBed.createComponent(SeatSummaryComponent);
    f.componentRef.setInput('items', items);
    f.componentRef.setInput('busy', busy);
    f.detectChanges();
    return f;
  }
  const el = (f: { nativeElement: unknown }): HTMLElement => f.nativeElement as HTMLElement;

  it('says so when nothing is chosen, and the button onwards is off', () => {
    const f = make([]);
    expect(el(f).querySelector('[data-testid="summary-empty"]')).not.toBeNull();
    expect(text(el(f).querySelector('[data-testid="summary-count"]'))).toBe('0 / 6');
    expect((el(f).querySelector('[data-testid="summary-proceed"]') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('lists each chosen seat with its sector, row, seat and price, and the total', () => {
    const f = make([item(5, 2800), item(6, 2800), item(7, 3900)]);
    const rows = Array.from(el(f).querySelectorAll('[data-testid="summary-item"]')).map((r) => text(r));
    expect(rows.length).toBe(3);
    expect(rows[0]).toContain('C/2 szektor');
    expect(rows[0]).toContain('3. sor, 5. szék');
    expect(rows[0].replace(/\s/g, '')).toContain('2800Ft');
    expect(text(el(f).querySelector('[data-testid="summary-count"]'))).toBe('3 / 6');
    expect(text(el(f).querySelector('[data-testid="summary-total"]')).replace(/\s/g, '')).toBe('9500Ft');
  });

  it('puts a seat back with its own named 44 px button', () => {
    const f = make([item(5, 2800)]);
    document.body.appendChild(el(f)); // 44 px is a layout fact: it needs a laid-out page
    (el(f).querySelector('.kte-summary__toggle') as HTMLButtonElement).click(); // on a phone the list is folded until opened
    f.detectChanges();
    const removed: string[] = [];
    f.componentInstance.remove.subscribe((id) => removed.push(id));
    const btn = el(f).querySelector('.kte-summary__remove') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toContain('5. szék elvétele');
    expect(btn.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    btn.click();
    expect(removed).toEqual(['seat-5']);
    el(f).remove();
  });

  it('goes onwards from the button, unless a lock is still in flight', () => {
    const f = make([item(5, 2800)]);
    let went = 0;
    f.componentInstance.proceed.subscribe(() => went++);
    (el(f).querySelector('[data-testid="summary-proceed"]') as HTMLButtonElement).click();
    expect(went).toBe(1);

    f.componentRef.setInput('busy', true);
    f.detectChanges();
    expect((el(f).querySelector('[data-testid="summary-proceed"]') as HTMLButtonElement).disabled).toBeTrue();
  });
});
