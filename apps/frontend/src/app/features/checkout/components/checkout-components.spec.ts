import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CartItem } from '../../../shared/models/cart.model';
import { CheckoutStepsComponent } from '../../../shared/components/checkout-steps/checkout-steps.component';
import { holdRemainingText } from '../../../shared/utils/hold-duration';
import { CheckoutSummaryComponent } from './checkout-summary.component';
import { ExpiredHoldAlertComponent } from './expired-hold-alert.component';

registerLocaleData(localeHu);

function item(over: Partial<CartItem> = {}): CartItem {
  return {
    seatId: 's1',
    matchId: 'm1',
    homeTeam: 'Kecskeméti TE',
    awayTeam: 'Újpest FC',
    kickoffAt: '2026-11-09T19:00:00.000Z',
    section: 'A',
    row: '1',
    seatNumber: 3,
    category: 'standard',
    price: 5250,
    ownerToken: 't',
    lockExpiresAtMs: Date.now() + 120_000,
    addedAtMs: 0,
    ...over,
  };
}

describe('ExpiredHoldAlertComponent', () => {
  function render(lapsed: CartItem[], remaining: number) {
    const f = TestBed.createComponent(ExpiredHoldAlertComponent);
    f.componentRef.setInput('lapsed', lapsed);
    f.componentRef.setInput('remaining', remaining);
    f.componentRef.setInput('matchId', 'm1');
    f.detectChanges();
    return f;
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [ExpiredHoldAlertComponent], providers: [provideRouter([])] }));

  it('names the seat, says the payment never started and the card was not charged', () => {
    const f = render([item()], 1);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.textContent).toContain('Lejárt a foglalás');
    expect(el.querySelector('s')?.textContent).toContain('A szektor · 1. sor · 3. szék');
    expect(el.textContent).toContain('A fizetés nem indult el, a kártyádat nem terheltük.');
  });

  it('offers both real options while seats are still held', () => {
    const f = render([item()], 2);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.alert__remaining')?.textContent).toContain('Fizetés a megmaradt 2 helyre');
    expect(el.querySelector('.alert__choose')?.textContent).toContain('Másik szék választása');
  });

  it('with nothing left held, only offers choosing a new seat', () => {
    const f = render([item()], 0);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.alert__remaining')).toBeNull();
    expect(el.querySelector('.alert__choose')).not.toBeNull();
    expect(el.textContent).toContain('Már egy fenntartott helyed sincs');
  });

  it('emits payRemaining', () => {
    const f = render([item()], 1);
    let fired = 0;
    f.componentInstance.payRemaining.subscribe(() => (fired += 1));
    (f.nativeElement.querySelector('.alert__remaining') as HTMLButtonElement).click();
    expect(fired).toBe(1);
  });
});

describe('CheckoutSummaryComponent', () => {
  function render(over: Partial<CheckoutSummaryComponent> = {}) {
    const f = TestBed.createComponent(CheckoutSummaryComponent);
    f.componentRef.setInput('items', [item(), item({ seatId: 's2', seatNumber: 4, price: 3500 })]);
    f.componentRef.setInput('subtotal', 8750);
    f.componentRef.setInput('total', 8312);
    f.componentRef.setInput('canPay', true);
    Object.entries(over).forEach(([k, v]) => f.componentRef.setInput(k, v));
    f.detectChanges();
    return f;
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [CheckoutSummaryComponent] }));

  it('shows the fixture, a line per seat, the total and a "Fizetés · total" button', () => {
    const el = render({ venue: 'Széktói Stadion, Kecskemét' }).nativeElement as HTMLElement;
    expect(el.textContent).toContain('Kecskeméti TE – Újpest FC');
    expect(el.textContent).toContain('Széktói Stadion, Kecskemét');
    expect(el.querySelectorAll('[data-testid="summary-seat"]').length).toBe(2);
    expect(el.querySelector('.summary__pay')?.textContent).toMatch(/Fizetés · 8\s?312/);
  });

  it('states that the ticket is issued when Stripe confirms, not when the browser returns', () => {
    const el = render().nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="issue-note"]')?.textContent).toContain(
      'amikor a Stripe megerősíti a fizetést, nem amikor a böngésző visszatér',
    );
  });

  it('shows the loyalty discount in the tier look, and the points line only when known', () => {
    let el = render({ discount: { tier: 'silver', label: 'Ezüst', percent: 5, amount: 438 }, points: 100 }).nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="summary-discount"]')?.getAttribute('data-tier')).toBe('silver');
    expect(el.querySelector('[data-testid="summary-points"]')?.textContent).toContain('100 hűségpontot');

    el = render().nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="summary-discount"]')).toBeNull();
    expect(el.querySelector('[data-testid="summary-points"]')).toBeNull();
  });

  it('the pay button is disabled until payment can start', () => {
    const btn = (render({ canPay: false }).nativeElement as HTMLElement).querySelector('.summary__pay') as HTMLButtonElement;
    expect(btn.disabled).toBeTrue();
  });
});

describe('CheckoutStepsComponent on the payment step', () => {
  it('shows three steps: earlier done, payment current, ticket still ahead', () => {
    TestBed.configureTestingModule({ imports: [CheckoutStepsComponent] });
    const f = TestBed.createComponent(CheckoutStepsComponent);
    f.componentRef.setInput('steps', ['Helyválasztás', 'Fizetés', 'Jegy']);
    f.componentRef.setInput('current', 1);
    f.detectChanges();
    const items = Array.from((f.nativeElement as HTMLElement).querySelectorAll('li'));
    expect(items.length).toBe(3);
    expect(items[0].classList).toContain('steps__item--done');
    expect(items[1].getAttribute('aria-current')).toBe('step');
    expect(items[2].classList).not.toContain('steps__item--done');
  });
});

describe('holdRemainingText', () => {
  it('counts the server-granted hold down in plain Hungarian', () => {
    expect(holdRemainingText(192_000)).toBe('3 perc 12 másodpercig');
    expect(holdRemainingText(180_000)).toBe('3 percig');
    expect(holdRemainingText(45_000)).toBe('45 másodpercig');
    expect(holdRemainingText(0)).toBe('0 másodpercig');
  });
});
