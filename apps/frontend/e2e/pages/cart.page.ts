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

  // Empty state
  readonly emptyCard: Locator;
  readonly emptyGoToStadiumLink: Locator;

  // Cart rows
  readonly cartRows: Locator;

  // Summary card
  readonly summaryCard: Locator;
  readonly totalPrice: Locator;
  readonly checkoutButton: Locator;
  readonly expiryWarning: Locator;

  // Snackbar (Material)
  readonly snackbar: Locator;

  constructor(page: Page) {
    this.page = page;

    this.pageHeading = page.locator('section.kte-cart h1');
    this.itemCount = page.locator('.kte-cart__count');

    this.emptyCard = page.locator('mat-card.kte-cart__empty');
    this.emptyGoToStadiumLink = page.getByRole('link', { name: /stadiontérkép/i });

    this.cartRows = page.locator('mat-card.kte-cart__row');

    this.summaryCard = page.locator('mat-card.kte-cart__summary');
    this.totalPrice = page.locator('.kte-cart__summary-row--total strong').last();
    this.checkoutButton = page.getByRole('button', { name: /tovább a pénztárhoz/i });
    this.expiryWarning = page.locator('.kte-cart__warning');

    this.snackbar = page.locator('mat-snack-bar-container');
  }

  async goto(): Promise<void> {
    await this.page.goto('/cart');
  }

  /**
   * Returns the countdown element inside the nth cart row (zero-based).
   */
  countdownInRow(index: number): Locator {
    return this.cartRows.nth(index).locator('.kte-cart__countdown');
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
  ): Promise<void> {
    const fullItems = items.map((item, i) => ({
      seatId: `seed-seat-${i}`,
      matchId,
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Ferencvárosi TC',
      kickoffAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      section: 'A',
      row: '1',
      seatNumber: i + 1,
      category: 'standard',
      price: 3500,
      ownerToken: `owner-token-${i}`,
      lockExpiresAtMs: Date.now() + 280_000,
      addedAtMs: Date.now() - 20_000,
      ...item,
    }));

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
      [STORAGE_KEY, { version: 1, matchId, items: fullItems }] as [string, unknown],
    );
  }
}
