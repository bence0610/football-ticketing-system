import { test, expect, type Page } from '@playwright/test';
import { CartPage } from './pages/cart.page';
import { MATCH_ID_1 } from './fixtures/api-mocks';

/**
 * E2E tests for the Cart page (/cart).
 *
 * Scenarios:
 *  1. One card per match with its seats, a live hold pill and the step bar
 *  2. A hold under one minute turns the match strip amber
 *  3. An expired hold stays as its own card and can be discarded
 *  4. Re-booking an expired seat someone else took shows the seat map's message
 *  5. The summary states the shortest hold and (guest) shows no loyalty rows
 *  6. The empty cart shows the next home match and a named sector from the API
 *  7. At 360px nothing scrolls sideways and the summary sits below the cart
 */

const KICKOFF = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

const MATCH = {
  id: MATCH_ID_1,
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Paksi FC',
  competition: 'NB1',
  venue: 'Széktói Stadion, Kecskemét',
  kickoffAt: KICKOFF,
  status: 'on_sale',
  basePrice: 3000,
  capacity: 524,
  availableSeats: 400,
  isHome: true,
  isSeasonPassEligible: true,
};

async function mockApi(page: Page, opts: { matches?: unknown[] } = {}): Promise<void> {
  await page.route('**/auth/refresh', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.route('**/matches?*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.matches ?? [MATCH]) }),
  );
  await page.route(`**/matches/${MATCH_ID_1}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MATCH) }),
  );
  await page.route('**/matches/*/seats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        matchId: MATCH_ID_1,
        seats: [],
        sectorSummary: [
          { section: 'B', total: 200, available: 143, locked: 0, sold: 57, occupancyRatio: 0.29, minPrice: 3000, maxPrice: 3000 },
          { section: 'VIP', total: 24, available: 5, locked: 0, sold: 19, occupancyRatio: 0.8, minPrice: 7500, maxPrice: 7500 },
        ],
      }),
    }),
  );
}

test.describe('Cart Page – /cart', () => {
  test('groups seats under their match with a hold pill and the step bar', async ({ page }) => {
    await mockApi(page);
    await CartPage.seedSessionCart(page, [{}, { section: 'VIP', price: 7500 }], MATCH_ID_1);
    const cart = new CartPage(page);
    await cart.goto();

    await expect(cart.matchCards).toHaveCount(1);
    await expect(cart.cartRows).toHaveCount(2);
    await expect(cart.matchCards.first()).toContainText('Kecskeméti TE – Ferencvárosi TC');
    await expect(cart.matchCards.first()).toContainText('Széktói Stadion, Kecskemét');
    await expect(cart.countdownInMatch(0)).toHaveText(/^\d\d:\d\d$/);
    await expect(cart.steps.locator('[aria-current="step"]')).toContainText('Kosár');
    await expect(cart.totalPrice).toContainText(/11\s?000/);
  });

  test('a hold under one minute turns the strip amber', async ({ page }) => {
    await mockApi(page);
    await CartPage.seedSessionCart(page, [{ lockExpiresAtMs: Date.now() + 30_000 }], MATCH_ID_1);
    const cart = new CartPage(page);
    await cart.goto();

    const strip = cart.matchCards.first().locator('.match__strip');
    await expect(strip).toHaveCSS('background-color', 'rgb(251, 241, 224)');
  });

  test('an expired hold stays as its own card and can be discarded', async ({ page }) => {
    await mockApi(page);
    await CartPage.seedSessionCart(page, [{}], MATCH_ID_1, [{ section: 'A', seatNumber: 9 }]);
    const cart = new CartPage(page);
    await cart.goto();

    await expect(cart.expiredCards).toHaveCount(1);
    await expect(cart.expiredCards.first()).toContainText('A foglalás lejárt');
    await expect(cart.expiredCards.first()).toContainText('Nem történt terhelés');
    await expect(cart.expiredCards.first().locator('s')).toBeVisible();
    await expect(cart.matchCards).toHaveCount(1); // the live seat is unaffected

    await cart.dismissButton.click();
    await expect(cart.expiredCards).toHaveCount(0);
  });

  test('re-booking a seat someone else took gives the same message as the seat map', async ({ page }) => {
    await mockApi(page);
    await page.route('**/matches/*/seats/*/lock', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 409, message: 'Seat is already locked. Please pick a different seat.' }),
      }),
    );
    await CartPage.seedSessionCart(page, [], MATCH_ID_1, [{}]);
    const cart = new CartPage(page);
    await cart.goto();

    await cart.relockButton.click();
    // exactly one message: the global (raw, English) snackbar stays out of lock failures
    await expect(cart.snackbar).toHaveCount(1);
    await expect(cart.snackbar).toContainText('Ez a szék már foglalt. Válassz másikat.');
    await expect(cart.expiredCards).toHaveCount(1); // still there to discard
  });

  test('the summary names the shortest hold and explains only that seat drops out', async ({ page }) => {
    await mockApi(page);
    await CartPage.seedSessionCart(page, [{}, { lockExpiresAtMs: Date.now() + 90_000 }], MATCH_ID_1);
    const cart = new CartPage(page);
    await cart.goto();

    await expect(cart.expiryWarning).toContainText('A legrövidebb foglalás');
    await expect(cart.expiryWarning).toContainText('csak az a szék esik ki');
    await expect(cart.pointsLine).toHaveCount(0); // guest: points rule needs a signed-in snapshot
    await expect(cart.checkoutButton).toBeVisible();
  });

  test('the empty cart shows the next home match and a named sector', async ({ page }) => {
    await mockApi(page);
    const cart = new CartPage(page);
    await cart.goto();

    await expect(cart.emptyCard).toContainText('Kecskeméti TE – Paksi FC');
    await expect(cart.emptyCard).toContainText('B szektor');
    await expect(cart.emptyCard).toContainText('143 szabad hely');
    await expect(cart.emptyGoToStadiumLink).toHaveAttribute('href', new RegExp(`matchId=${MATCH_ID_1}`));
  });

  test('at 360px nothing scrolls sideways and the summary is not sticky', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await mockApi(page);
    await CartPage.seedSessionCart(page, [{}, {}], MATCH_ID_1, [{}]);
    const cart = new CartPage(page);
    await cart.goto();

    await expect(cart.summaryCard).toBeVisible();
    await expect(cart.summaryCard).toHaveCSS('position', 'static');
    const overflow = await page.evaluate(() => {
      const sc = document.querySelector('mat-sidenav-content')!;
      return sc.scrollWidth - sc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
