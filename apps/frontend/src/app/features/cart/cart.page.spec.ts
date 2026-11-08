import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store, provideStore } from '@ngrx/store';
import { CartItem } from '../../shared/models/cart.model';
import { CartActions } from '../../state/cart/cart.actions';
import { cartReducer } from '../../state/cart/cart.reducer';
import { CART_FEATURE_KEY } from '../../state/cart/cart.selectors';
import { MATCHES_FEATURE_KEY, matchesReducer } from '../../state/matches';
import { SEAT_TAKEN_MESSAGE } from '../../shared/utils/lock-error';
import { CartPageComponent } from './cart.page';

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
    seatNumber: 5,
    category: 'standard',
    price: 3500,
    ownerToken: 't',
    lockExpiresAtMs: Date.now() + 120_000,
    lockTtlSeconds: 300,
    addedAtMs: 0,
    ...over,
  };
}

describe('CartPageComponent', () => {
  let fixture: ComponentFixture<CartPageComponent>;
  let store: Store;
  let http: HttpTestingController;
  let snack: jasmine.Spy;

  // the lock call travels through several promise hops; wait a macrotask for it to land
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve));
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const q = (sel: string) => (fixture.nativeElement as HTMLElement).querySelector(sel) as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CartPageComponent, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideStore({ [CART_FEATURE_KEY]: cartReducer, [MATCHES_FEATURE_KEY]: matchesReducer }),
      ],
    }).compileComponents();
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
    snack = spyOn(TestBed.inject(MatSnackBar), 'open');
    sessionStorage.clear();
    fixture = TestBed.createComponent(CartPageComponent);
  });

  function load(items: CartItem[], expired: CartItem[] = []): void {
    store.dispatch(CartActions.hydrateFromStorage({ items, matchId: items[0]?.matchId ?? null, expired }));
    fixture.detectChanges();
  }

  it('groups seats under their match with a live hold pill', () => {
    load([item({ seatId: 'a' }), item({ seatId: 'b', seatNumber: 6, lockExpiresAtMs: Date.now() + 90_000 })]);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="cart-match"]').length).toBe(1);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="cart-seat"]').length).toBe(2);
    expect(q('.kte-cart__countdown')?.textContent).toMatch(/^\s*01:(2\d|30)\s*$/); // the shorter hold
    expect(text()).toContain('Kecskeméti TE – Újpest FC');
    expect(q('.match--urgent')).toBeNull();
  });

  it('turns the match strip amber under one minute', () => {
    load([item({ lockExpiresAtMs: Date.now() + 30_000 })]);
    expect(q('.match--urgent')).not.toBeNull();
  });

  it('keeps an expired hold as its own card with the seat, a clear note and two actions', () => {
    load([], [item({ seatId: 'gone' })]);
    const card = q('[data-testid="cart-expired"]')!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain('A foglalás lejárt');
    expect(card.querySelector('s')?.textContent).toContain('A szektor · 1. sor · 5. szék');
    expect(card.textContent).toContain('Nem történt terhelés');
    expect(card.textContent).toContain('Újra lefoglalom');
    expect(card.textContent).toContain('Elvetem');
  });

  it('"Elvetem" discards the expired card', () => {
    load([], [item({ seatId: 'gone' })]);
    (q('.expired__dismiss') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(q('[data-testid="cart-expired"]')).toBeNull();
  });

  it('"Újra lefoglalom" on a seat someone else took gives the seat map\'s message', async () => {
    load([], [item({ seatId: 'gone' })]);
    (q('.expired__relock') as HTMLButtonElement).click();

    const req = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/matches/m1/seats/gone/lock'));
    req.flush({ message: 'Seat gone is already locked.' }, { status: 409, statusText: 'Conflict' });
    await settle();

    expect(snack).toHaveBeenCalledWith(SEAT_TAKEN_MESSAGE, 'Bezárás', { duration: 5000 });
    fixture.detectChanges();
    expect(q('[data-testid="cart-expired"]')).not.toBeNull(); // still there to discard
  });

  it('"Újra lefoglalom" success moves the seat back into the cart', async () => {
    load([], [item({ seatId: 'gone' })]);
    (q('.expired__relock') as HTMLButtonElement).click();
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/matches/m1/seats/gone/lock'))
      .flush({ matchId: 'm1', seatId: 'gone', ownerToken: 'new', ttlSeconds: 300, expiresAt: new Date().toISOString() });
    await settle();
    fixture.detectChanges();
    expect(q('[data-testid="cart-expired"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="cart-seat"]').length).toBe(1);
  });

  it('shows a summary with count, subtotal, total and the shortest-hold note', () => {
    load([item({ seatId: 'a' }), item({ seatId: 'b', seatNumber: 6, lockExpiresAtMs: Date.now() + 45_000 })]);
    expect(q('[data-testid="summary-count"]')?.textContent).toContain('2 db');
    expect(q('[data-testid="summary-total"]')?.textContent).toMatch(/7\s?000/);
    expect(q('[data-testid="summary-hold"]')?.textContent).toContain('csak az a szék esik ki');
    expect(q('[data-testid="summary-discount"]')).toBeNull(); // guest: no loyalty
  });

  it('never prints a hold length that is not derived from the server TTL', () => {
    load([item()]);
    expect(text()).not.toMatch(/\b5 perc|\b300 mp|\b60 perc/);
  });

  it('an empty cart shows what is worth buying, not a bare message', () => {
    load([]);
    expect(q('[data-testid="cart-empty"]')).not.toBeNull();
    expect(text()).toContain('Helyet választok');
  });
});
