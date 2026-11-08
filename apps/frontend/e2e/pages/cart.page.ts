import { type Page, type Locator } from '@playwright/test';
import { type CartItem } from '../../src/app/shared/models/cart.model';

const STORAGE_KEY = 'kte_cart_v1';

/**
 * Page Object for the Cart page (/cart).
 *
 * Selector strategy:
 *  1. Semantic roles and accessible names
 *  2. CSS classes with .kte-cart-* prefix
 *  3. Text content for labels / button labels
 */
export class CartPage {
  readonly page: Page;

  // Page structure
  readonly pageHeading: Locator;
  readonly itemCount: Locator;
  readonly steps: Locator;

  // Empty state
  readonly emptyCard: Locator;
  readonly emptyGoToStadiumLink: Locator;

  // One card per match, one row per seat
  readonly matchCards: Locator;
  readonly cartRows: Locator;

  // Expired holds
  readonly expiredCards: Locator;
  readonly relockButton: Locator;
  readonly dismissButton: Locator;

  // Summary card
  readonly summaryCard: Locator;
  readonly totalPrice: Locator;
  readonly checkoutButton: Locator;
  readonly expiryWarning: Locator;
  readonly pointsLine: Locator;

  // Snackbar (Material)
  readonly snackbar: Locator;

  constructor(page: Page) {
    this.page = page;

    this.pageHeading = page.locator('section.kte-cart h1');
    this.itemCount = page.locator('.kte-cart__count');
    this.steps = page.getByRole('navigation', { name: 'Vásárlás lépései' });

    this.emptyCard = page.locator('[data-testid="cart-empty"]');
    this.emptyGoToStadiumLink = page.getByRole('link', { name: /helyet választok/i });

    this.matchCards = page.locator('[data-testid="cart-match"]');
    this.cartRows = page.locator('[data-testid="cart-seat"]');

    this.expiredCards = page.locator('[data-testid="cart-expired"]');
    this.relockButton = page.getByRole('button', { name: /újra lefoglalom/i });
    this.dismissButton = page.getByRole('button', { name: /elvetem/i });

    this.summaryCard = page.locator('kte-cart-summary .summary');
    this.totalPrice = page.locator('[data-testid="summary-total"]');
    this.checkoutButton = page.getByRole('button', { name: /tovább a fizetéshez/i });
    this.expiryWarning = page.locator('[data-testid="summary-hold"]');
    this.pointsLine = page.locator('[data-testid="summary-points"]');

    this.snackbar = page.locator('mat-snack-bar-container');
  }

  async goto(): Promise<void> {
    await this.page.goto('/cart');
  }

  /**
   * Returns the hold countdown in the nth match card (zero-based). One hold
   * pill per match, showing the shortest hold of that match's seats.
   */
  countdownInMatch(index: number): Locator {
    return this.matchCards.nth(index).locator('.kte-cart__countdown');
  }

  /**
   * Returns the remove button inside the nth cart row.
   */
  removeButtonInRow(index: number): Locator {
    return this.cartRows.nth(index).getByRole('button', { name: /eltávolítás/i });
  }

  /**
   * Pre-seeds the NgRx cart via sessionStorage before the page loads.
   * Call this BEFORE page.goto('/cart') so Angular hydrates the state.
   *
   * @param items Array of CartItem objects to seed
   * @param matchId The matchId for the cart snapshot
   */
  static async seedSessionCart(
    page: Page,
    items: readonly Partial<CartItem>[],
    matchId: string,
    expiredItems: readonly Partial<CartItem>[] = [],
  ): Promise<void> {
    const build = (list: readonly Partial<CartItem>[], offset: number) => list.map((item, i) => ({
      seatId: `seed-seat-${i + offset}`,
      matchId,
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Ferencvárosi TC',
      kickoffAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      section: 'A',
      row: '1',
      seatNumber: i + offset + 1,
      category: 'standard',
      price: 3500,
      ownerToken: `owner-token-${i + offset}`,
      lockExpiresAtMs: Date.now() + 280_000,
      addedAtMs: Date.now() - 20_000,
      ...item,
    }));
    const fullItems = build(items, 0);
    const fullExpired = build(expiredItems, 100).map((e) => ({ ...e, lockExpiresAtMs: Date.now() - 5_000 }));

    // addInitScript runs in every new document BEFORE the app boots, so it also
    // works ahead of the first page.goto() (page.evaluate would throw a
    // SecurityError on about:blank). It only seeds when the key is absent, so a
    // later reload keeps whatever the app has written since.
    await page.addInitScript(
      ([key, payload]: [string, unknown]) => {
        if (window.sessionStorage.getItem(key) === null) {
          window.sessionStorage.setItem(key, JSON.stringify(payload));
        }
      },
      [STORAGE_KEY, { version: 1, matchId, items: fullItems, expired: fullExpired }] as [string, unknown],
    );
  }
}
