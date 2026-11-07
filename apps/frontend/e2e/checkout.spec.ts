import { test, expect, type Page } from '@playwright/test';
import { CheckoutPage } from './pages/checkout.page';
import { CartPage } from './pages/cart.page';
import {
  MATCH_ID_1,
  SEAT_ID_AVAILABLE,
  OWNER_TOKEN,
  PAYMENT_INTENT_RESPONSE,
  PAYMENT_INTENT_ID,
  WEATHER_RAIN_WARNING,
  WEATHER_CLEAR,
  AUTH_RESPONSE,
} from './fixtures/api-mocks';

/**
 * E2E tests for the Checkout page (/checkout) and Confirmation page
 * (/checkout/confirmation) – EPIC E6.
 *
 * The Stripe.js payment element renders inside a third-party iframe that we
 * cannot interact with in a fully mocked test. Instead, these tests:
 *  - Stub the /api/payments/intent endpoint to skip real API calls.
 *  - Override window.Stripe via page.addInitScript() so the Angular
 *    StripeService resolves without loading the Stripe SDK from cdn.
 *  - Assert on the Angular-owned UI (loading spinner, buyer details,
 *    order summary, weather banner, error states, confirmation page).
 *
 * Scenarios:
 *  Checkout page:
 *   1. Empty cart shows the empty-state card on /checkout
 *   2. With cart items: page heading and "Back to cart" link visible
 *   3. Buyer details card shows the authenticated user's name and email
 *   4. Order summary shows each seat and the total
 *   5. Lock countdown is visible in the summary aside
 *   6. Stripe loading spinner appears while the payment element mounts
 *   7. Weather rain warning banner shows for non-VIP sectors
 *   8. Weather banner is NOT shown when the forecast has no rain warning
 *   9. Weather banner is NOT shown when all cart seats are in the VIP sector
 *  10. Payment button is initially disabled while Stripe element is loading
 *  11. Initialization error renders when the /payments/intent API fails
 *
 *  Confirmation page:
 *  12. Guard card renders when arriving at /checkout/confirmation without state
 *  13. Success card renders with order ID, seats, and total when state is set
 *  14. "Profil megnyitása" link goes to /profile
 *  15. "Vissza a kezdőlapra" link goes to /
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function mockRefreshSuccess(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AUTH_RESPONSE),
    }),
  );
}

async function mockRefreshFail(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 401, body: 'Unauthorized' }),
  );
}

async function mockPaymentIntent(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/payments/create-intent', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(PAYMENT_INTENT_RESPONSE),
    }),
  );
}

async function mockPaymentIntentFail(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/payments/create-intent', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }),
    }),
  );
}

async function mockWeather(
  page: import('@playwright/test').Page,
  body: unknown,
): Promise<void> {
  await page.route('**/weather/match/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

async function mockWeatherFail(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/weather/match/**', (route) =>
    route.fulfill({ status: 404 }),
  );
}

/**
 * Injects a minimal Stripe mock so StripeService.createElements() resolves
 * without loading stripe.js from cdn. The returned object exposes only the
 * methods that CheckoutPage calls.
 */
async function injectStripeMock(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    const mockElement = {
      mount: () => undefined,
      destroy: () => undefined,
      on: () => undefined,
    };
    const mockElements = {
      create: () => mockElement,
      submit: async () => ({ error: null }),
    };
    const mockStripe = {
      elements: () => mockElements,
      confirmPayment: async () => ({ error: null, paymentIntent: null }),
    };
    // @ts-ignore
    window.Stripe = () => mockStripe;
  });
}

function makeCartItem(
  seatId = SEAT_ID_AVAILABLE,
  section = 'A',
  price = 3500,
): Record<string, unknown> {
  return {
    seatId,
    matchId: MATCH_ID_1,
    homeTeam: 'Kecskeméti TE',
    awayTeam: 'Ferencvárosi TC',
    kickoffAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    section,
    row: '1',
    seatNumber: 5,
    category: 'standard',
    price,
    ownerToken: OWNER_TOKEN,
    lockExpiresAtMs: Date.now() + 280_000,
    addedAtMs: Date.now() - 20_000,
  };
}

// ---------------------------------------------------------------------------
// Checkout page tests
// ---------------------------------------------------------------------------

test.describe('Checkout Page – /checkout', () => {
  // The authGuard redirects unauthenticated visitors — every checkout test
  // needs a valid session.
  test.beforeEach(async ({ page }) => {
    await mockRefreshSuccess(page);
  });

  test('should show the empty-state card when the cart has no items', async ({ page }) => {
    // Do NOT seed the cart
    await page.goto('/checkout');

    const checkout = new CheckoutPage(page);
    await expect(checkout.pageHeading).toContainText('Fizetés');
    await expect(checkout.emptyState).toBeVisible();
    await expect(checkout.emptyState).toContainText('A kosarad üres');
  });

  test('should show the page heading and Back-to-cart link when items are in the cart', async ({
    page,
  }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.pageHeading).toContainText('Fizetés');
    await expect(checkout.backToCartLink).toBeVisible();
    await expect(checkout.backToCartLink).toHaveAttribute('href', /\/cart/);
  });

  test('should display the authenticated user name and email in the buyer details card', async ({
    page,
  }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    // AUTH_RESPONSE.user = { firstName: 'Teszt', lastName: 'Felhasználó', email: 'test@kte.hu' }
    await expect(checkout.buyerName).toContainText('Felhasználó');
    await expect(checkout.buyerName).toContainText('Teszt');
    await expect(checkout.buyerEmail).toContainText('test@kte.hu');
  });

  test('should list each seat in the summary aside', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    // Bronze tier user: 1 seat line + 1 total line = 2 lines.
    // Gold/silver/platinum users get an additional discount line — see
    // checkout-discount.spec.ts for those scenarios (KTE-046).
    await expect(checkout.summaryAside.locator('.kte-checkout__line')).toHaveCount(
      2, // 1 seat line + 1 total line (no discount for bronze)
    );
    await expect(checkout.summaryAside).toContainText('A');
  });

  test('should display a lock countdown in the summary aside', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.lockStatusCountdown).toBeVisible();
    await expect(checkout.lockStatusCountdown).toContainText(':');
  });

  test('should show a loading indicator while the payment element is initializing', async ({
    page,
  }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockWeatherFail(page);
    await injectStripeMock(page);

    // Delay the payment intent response so we can observe the loading state
    await page.route('**/payments/create-intent', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(PAYMENT_INTENT_RESPONSE),
      });
    });

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    // Stripe loading spinner must appear while the intent is pending
    await expect(checkout.stripeLoader).toBeVisible();
  });

  test('should show a rain warning banner for non-VIP seats when rain is forecast', async ({
    page,
  }) => {
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'A')], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_RAIN_WARNING);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.weatherBanner).toBeVisible({ timeout: 5000 });
    await expect(checkout.weatherBanner).toContainText('Esőzés várható');
    await expect(checkout.weatherBannerChangeSection).toBeVisible();
  });

  test('should NOT show the weather banner when no rain is forecast', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'A')], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_CLEAR);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    // Wait for the weather call to resolve
    await page.waitForTimeout(500);
    await expect(checkout.weatherBanner).not.toBeVisible();
  });

  test('should NOT show the weather banner when all cart seats are in the VIP (covered) sector', async ({
    page,
  }) => {
    // VIP is in the COVERED_SECTORS set inside WeatherBannerComponent
    await CartPage.seedSessionCart(
      page,
      [makeCartItem(SEAT_ID_AVAILABLE, 'VIP')],
      MATCH_ID_1,
    );
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_RAIN_WARNING);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await page.waitForTimeout(500);
    await expect(checkout.weatherBanner).not.toBeVisible();
  });

  test('should disable the pay button while the payment intent is still loading', async ({
    page,
  }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockWeatherFail(page);
    await injectStripeMock(page);

    // Return the intent only after a short delay
    await page.route('**/payments/create-intent', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(PAYMENT_INTENT_RESPONSE),
      });
    });

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    // Before the intent arrives, the button is disabled
    await expect(checkout.paymentButton).toBeDisabled();
  });

  test('should show an initialization error when the payment intent API fails', async ({
    page,
  }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntentFail(page);
    await mockWeatherFail(page);
    await injectStripeMock(page);

    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.initializationError).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Confirmation page tests
// ---------------------------------------------------------------------------

test.describe('Confirmation Page – /checkout/confirmation', () => {
  test.beforeEach(async ({ page }) => {
    await mockRefreshSuccess(page);
  });

  test('should render the guard card when there is no navigation state', async ({ page }) => {
    // Navigate directly — no router state is passed
    await page.goto('/checkout/confirmation');

    const checkout = new CheckoutPage(page);
    await expect(checkout.guardCard).toBeVisible();
    await expect(checkout.guardCard).toContainText('Nincs megerősíthető fizetés');
  });

  /**
   * Opens /checkout/confirmation the way the app does after a successful
   * payment: a client-side navigation carrying router state. (A page reload
   * cannot do this — the router replaces history.state on the initial
   * navigation — so the state is pushed and delivered through popstate.)
   * Asserts the SUCCESS card is showing, so the tests below cannot pass on
   * the "no payment to confirm" guard card, which has similar links.
   */
  async function openConfirmationWithState(page: Page): Promise<CheckoutPage> {
    const state = {
      paymentIntentId: PAYMENT_INTENT_ID,
      seats: [{ section: 'A', row: '1', seatNumber: 5, price: 3500 }],
      totalPaid: 3500,
    };
    await mockRefreshSuccess(page);
    await page.goto('/');
    await expect(page.locator('kte-app-shell, main').first()).toBeVisible();
    await page.evaluate((navState) => {
      window.history.pushState(navState, '', '/checkout/confirmation');
      window.dispatchEvent(new PopStateEvent('popstate', { state: navState }));
    }, state);
    const checkout = new CheckoutPage(page);
    await expect(checkout.successHeading).toContainText('Sikeres fizetés');
    await expect(checkout.guardCard).toHaveCount(0);
    return checkout;
  }

  test('should render the success card with order data when navigation state is set', async ({
    page,
  }) => {
    const checkout = await openConfirmationWithState(page);

    await expect(checkout.orderIdBlock).toContainText(PAYMENT_INTENT_ID);
    await expect(checkout.seatList).toHaveCount(1);
  });

  test('should have a "Profil megnyitása" link that points to /profile', async ({ page }) => {
    const checkout = await openConfirmationWithState(page);
    await expect(checkout.profileLink).toHaveAttribute('href', /\/profile/);
  });

  test('should have a "Vissza a kezdőlapra" link that points to /', async ({ page }) => {
    const checkout = await openConfirmationWithState(page);
    await expect(checkout.homeLink).toHaveAttribute('href', '/');
  });
});
