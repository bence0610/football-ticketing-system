import { test, expect, type Page } from '@playwright/test';
import { CheckoutPage } from './pages/checkout.page';
import { CartPage } from './pages/cart.page';
import {
  MATCH_ID_1,
  SEAT_ID_AVAILABLE,
  OWNER_TOKEN,
  PAYMENT_INTENT_RESPONSE,
  WEATHER_RAIN_WARNING,
  WEATHER_CLEAR,
  AUTH_RESPONSE,
} from './fixtures/api-mocks';

/**
 * E2E tests for the Checkout page (/checkout) and the Confirmation page
 * (/checkout/confirmation).
 *
 * The Stripe Payment Element renders inside a third-party iframe that cannot
 * be driven in a fully mocked test, so window.Stripe is replaced by a stub
 * that reports `ready` and returns a scripted payment result. The assertions
 * are on the Angular-owned UI.
 *
 * Checkout:
 *   1. Empty cart shows the empty state
 *   2. Stripped header: mark, "Biztonságos fizetés", no navigation to wander off
 *   3. Step bar (Helyválasztás done, Fizetés current) and the live hold pill
 *   4. Buyer line, the Stripe note and the order summary
 *   5. Loading state, disabled pay button, initialisation error
 *   6. Weather band only for a real forecast, with the coverage line
 *   7. A hold that expires: alert names the seat, nothing charged, pay for the rest
 *   8. At 360px: no sideways scroll, summary below the form
 * Confirmation:
 *   9. No payment id -> nothing to confirm
 *  10. Issued -> "Megvan a jegyed" with real amount/points; processing -> calm
 *      state without retry, refreshes by itself; failed -> plain message
 */

const PI = 'pi_3E2ePayment000001';
const SECOND_PI = 'pi_3E2ePayment000002';

async function mockRefreshSuccess(page: Page): Promise<void> {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AUTH_RESPONSE) }),
  );
}

async function mockLoyalty(page: Page, snapshot?: Record<string, unknown>): Promise<void> {
  await page.route('**/loyalty/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        snapshot ?? {
          points: 0,
          tier: { tier: 'bronze', label: 'Kék', minPoints: 0, discountPercent: 0, color: '#1F5C8B' },
          ticketPointsPerTicket: 50,
          recentTransactions: [],
        },
      ),
    }),
  );
}

/** The seat map's sector summary, with the coverage flag the weather band reads. */
async function mockSectors(
  page: Page,
  covered: Record<string, boolean | null> = { A: false, B: true, C: false, VIP: true },
): Promise<void> {
  await page.route('**/matches/*/seats', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        matchId: MATCH_ID_1,
        seats: [],
        sectorSummary: Object.entries(covered).map(([section, flag]) => ({
          section,
          covered: flag,
          total: 100,
          available: 50,
          locked: 0,
          sold: 50,
          occupancyRatio: 0.5,
          minPrice: 3500,
          maxPrice: 3500,
        })),
      }),
    }),
  );
}

async function mockMatchDetail(page: Page): Promise<void> {
  await page.route(`**/matches/${MATCH_ID_1}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: MATCH_ID_1, venue: 'Széktói Stadion, Kecskemét' }),
    }),
  );
}

async function mockPaymentIntent(page: Page, onRequest?: (body: unknown) => void): Promise<void> {
  await page.route('**/payments/create-intent', (route) => {
    onRequest?.(route.request().postDataJSON());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(PAYMENT_INTENT_RESPONSE) });
  });
}

async function mockPaymentIntentFail(page: Page): Promise<void> {
  await page.route('**/payments/create-intent', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal Server Error' }) }),
  );
}

async function mockWeather(page: Page, body: unknown): Promise<void> {
  await page.route('**/weather/match/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

async function mockWeatherFail(page: Page): Promise<void> {
  await page.route('**/weather/match/**', (route) => route.fulfill({ status: 404 }));
}

/** Stripe stub: reports `ready` when mounted, so the pay button can enable. */
async function injectStripeMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const mockElement = {
      mount: () => undefined,
      destroy: () => undefined,
      on: (event: string, cb: () => void) => {
        if (event === 'ready') {
          setTimeout(cb, 0);
        }
      },
    };
    const mockElements = { create: () => mockElement, submit: async () => ({ error: null }) };
    const mockStripe = {
      elements: () => mockElements,
      confirmPayment: async () => ({ error: null, paymentIntent: null }),
    };
    // @ts-expect-error test double for the Stripe.js global
    window.Stripe = () => mockStripe;
  });
}

function makeCartItem(seatId = SEAT_ID_AVAILABLE, section = 'A', price = 3500): Record<string, unknown> {
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
// Checkout page
// ---------------------------------------------------------------------------

test.describe('Checkout Page – /checkout', () => {
  test.beforeEach(async ({ page }) => {
    await mockRefreshSuccess(page);
    await mockLoyalty(page);
    await mockMatchDetail(page);
    await mockSectors(page); // VIP and B covered, A and C open
    await injectStripeMock(page);
  });

  test('shows the empty state when the cart has no items', async ({ page }) => {
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);
    await expect(checkout.pageHeading).toContainText('Fizetés');
    await expect(checkout.emptyState).toContainText('A kosarad üres');
  });

  test('has a stripped header: the mark and "Biztonságos fizetés", and nothing to wander off to', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.toolbar).toContainText('Jegyportál');
    await expect(checkout.secureLabel).toContainText('Biztonságos fizetés');
    await expect(checkout.headerNav).toHaveCount(0);
    await expect(checkout.headerLinks).toHaveCount(0); // no nav, cart, user menu or login
  });

  test('shows the step bar with the payment step current and the live hold pill', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.steps.locator('li')).toHaveCount(3);
    await expect(checkout.steps.locator('[aria-current="step"]')).toContainText('Fizetés');
    await expect(checkout.holdPill).toContainText('A helyeid');
    await expect(checkout.holdPill).toContainText('vannak fenntartva');
    await expect(checkout.holdPill).toContainText(/\d+ (perc|másodperc)/);
  });

  test('shows the buyer, the Stripe note and the summary with a "Fizetés · total" button', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem(), makeCartItem('seed-seat-x', 'B', 3000)], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    // AUTH_RESPONSE.user = { firstName: 'Teszt', lastName: 'Felhasználó', email: 'test@kte.hu' }
    await expect(checkout.buyer).toContainText('Felhasználó');
    await expect(checkout.buyer).toContainText('test@kte.hu');
    await expect(checkout.stripeNote).toContainText('soha nem jutnak el a mi szerverünkre');

    await expect(checkout.summary).toContainText('Kecskeméti TE – Ferencvárosi TC');
    await expect(checkout.summary).toContainText('Széktói Stadion, Kecskemét');
    await expect(checkout.summarySeats).toHaveCount(2);
    await expect(checkout.summaryTotal).toContainText(/6\s?500/);
    await expect(checkout.paymentButton).toContainText(/Fizetés · 6\s?500/);
    await expect(checkout.issueNote).toContainText('amikor a Stripe megerősíti a fizetést');
    await expect(checkout.pointsLine).toContainText('100 hűségpontot'); // 2 tickets x the server's points per ticket
  });

  test('shows the loyalty discount in the tier look', async ({ page }) => {
    await page.unroute('**/loyalty/me');
    await mockLoyalty(page, {
      points: 1000,
      tier: { tier: 'silver', label: 'Ezüst', minPoints: 500, discountPercent: 10, color: '#aaa' },
      ticketPointsPerTicket: 50,
      recentTransactions: [],
    });
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'A', 5000)], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.discountRow).toHaveAttribute('data-tier', 'silver');
    await expect(checkout.discountRow).toContainText('Ezüst kedvezmény · 10%');
    await expect(checkout.discountRow).toContainText(/500/);
    await expect(checkout.summaryTotal).toContainText(/4\s?500/);
  });

  test('shows a loading indicator and a disabled pay button while the payment is being prepared', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockWeatherFail(page);
    // Hold the payment intent until the test lets it go, so the "preparing" state
    // is observed for as long as needed rather than for a fixed delay.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/payments/create-intent', async (route) => {
      await gate;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(PAYMENT_INTENT_RESPONSE) });
    });
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.stripeLoader).toBeVisible();
    await expect(checkout.paymentButton).toBeDisabled();

    release();
    await expect(checkout.paymentButton).toBeEnabled({ timeout: 10_000 });
    await expect(checkout.stripeLoader).toHaveCount(0);
  });

  test('shows an initialisation error when the payment intent API fails', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntentFail(page);
    await mockWeatherFail(page);
    await page.goto('/checkout');
    await expect(new CheckoutPage(page).initializationError).toBeVisible({ timeout: 5000 });
  });

  // ---- weather band --------------------------------------------------------

  test('weather band: forecast for kickoff and "nem fedett" for an open sector in the rain', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'A')], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_RAIN_WARNING);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.weatherBand).toBeVisible();
    await expect(checkout.weatherBand).toContainText('Kezdéskor: eső várható');
    await expect(checkout.weatherBand).toContainText('14 °C');
    await expect(checkout.weatherCover).toContainText('nem fedett');
    await expect(checkout.weatherCover).toContainText('esőre számíts');
  });

  test('weather band: shown for a dry forecast too, without telling anyone to expect rain', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'A')], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_CLEAR);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.weatherBand).toContainText('Kezdéskor: derült');
    await expect(checkout.weatherCover).not.toContainText('esőre');
  });

  test('weather band: a covered (VIP) sector says so', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'VIP')], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_RAIN_WARNING);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.weatherCover).toContainText('fedett');
    await expect(checkout.weatherCover).not.toContainText('nem fedett');
  });

  test('weather band: the claim follows the sector flag from the server, not a hard-coded sector', async ({ page }) => {
    // the same sector (A), the same forecast: only the flag differs
    await page.unroute('**/matches/*/seats');
    await mockSectors(page, { A: true, B: true, C: false, VIP: false });
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'A')], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_RAIN_WARNING);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.weatherCover).toContainText('(A szektor) fedett');
    await expect(checkout.weatherCover).not.toContainText('nem fedett');
    await expect(checkout.weatherCover).not.toContainText('esőre');
  });

  test('weather band: a sector the server has no flag for gets no coverage claim', async ({ page }) => {
    await page.unroute('**/matches/*/seats');
    await mockSectors(page, { A: null });
    await CartPage.seedSessionCart(page, [makeCartItem(SEAT_ID_AVAILABLE, 'A')], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_RAIN_WARNING);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.weatherBand).toContainText('Kezdéskor:'); // the forecast is real
    await expect(checkout.weatherCover).toHaveCount(0); // but no claim about a roof
  });

  test('weather band: no real forecast means no band at all', async ({ page }) => {
    await CartPage.seedSessionCart(page, [makeCartItem()], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, {
      ...WEATHER_CLEAR,
      summary: 'Az előrejelzés még nem elérhető',
      temperatureCelsius: null,
      precipitationProbability: null,
      fallback: true,
      unavailableReason: 'too_far',
    });
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.summary).toBeVisible();
    await page.waitForTimeout(400);
    await expect(checkout.weatherBand).toHaveCount(0);
  });

  // ---- expired hold -----------------------------------------------------------

  test('a hold that runs out is not dropped silently: the alert names the seat and offers real options', async ({ page }) => {
    const intentRequests: { seats: { seatId: string }[] }[] = [];
    await CartPage.seedSessionCart(
      page,
      [{ lockExpiresAtMs: Date.now() + 6_000, seatNumber: 9 }, { lockExpiresAtMs: Date.now() + 120_000 }],
      MATCH_ID_1,
    );
    await mockPaymentIntent(page, (body) => intentRequests.push(body as { seats: { seatId: string }[] }));
    await mockWeatherFail(page);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.summarySeats).toHaveCount(2);
    await expect(checkout.paymentButton).toBeEnabled();

    await expect(checkout.expiredAlert).toBeVisible({ timeout: 12_000 });
    await expect(checkout.expiredAlert).toContainText('Lejárt a foglalás');
    await expect(checkout.expiredAlert.locator('s')).toContainText('A szektor · 1. sor · 9. szék');
    await expect(checkout.expiredAlert).toContainText('A fizetés nem indult el, a kártyádat nem terheltük.');
    await expect(checkout.chooseSeatLink).toBeVisible();
    await expect(checkout.payRemainingButton).toContainText('Fizetés a megmaradt 1 helyre');
    await expect(checkout.paymentButton).toBeDisabled(); // cannot pay for the lapsed seat

    // Pay only for what is still held: a new payment for just that seat
    await checkout.payRemainingButton.click();
    await expect(checkout.expiredAlert).toHaveCount(0);
    await expect(checkout.summarySeats).toHaveCount(1);
    await expect(checkout.paymentButton).toBeEnabled();
    expect(intentRequests.length).toBe(2);
    expect(intentRequests[0].seats.length).toBe(2);
    expect(intentRequests[1].seats.length).toBe(1);
    expect(intentRequests[1].seats[0].seatId).toBe('seed-seat-1');
  });

  test('when every hold has run out, only choosing a new seat is offered', async ({ page }) => {
    await CartPage.seedSessionCart(page, [{ lockExpiresAtMs: Date.now() + 2_000 }], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeatherFail(page);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.expiredAlert).toBeVisible({ timeout: 8000 });
    await expect(checkout.expiredAlert).toContainText('Már egy fenntartott helyed sincs');
    await expect(checkout.payRemainingButton).toHaveCount(0);
    await expect(checkout.chooseSeatLink).toHaveAttribute('href', new RegExp(`matchId=${MATCH_ID_1}`));
    await expect(checkout.paymentButton).toHaveCount(0);
  });

  // ---- mobile -------------------------------------------------------------------

  test('at 360px nothing scrolls sideways and the summary sits below the form', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await CartPage.seedSessionCart(page, [makeCartItem(), makeCartItem('seed-seat-x', 'B', 3000)], MATCH_ID_1);
    await mockPaymentIntent(page);
    await mockWeather(page, WEATHER_RAIN_WARNING);
    await page.goto('/checkout');
    const checkout = new CheckoutPage(page);

    await expect(checkout.summary).toBeVisible();
    await expect(checkout.summary).toHaveCSS('position', 'static');
    const overflow = await page.evaluate(() => {
      const sc = document.querySelector('mat-sidenav-content')!;
      return sc.scrollWidth - sc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    const formBox = await page.locator('section.card').boundingBox();
    const summaryBox = await checkout.summary.boundingBox();
    expect(summaryBox!.y).toBeGreaterThan(formBox!.y);
  });
});

// ---------------------------------------------------------------------------
// Confirmation page
// ---------------------------------------------------------------------------

const ISSUED = {
  status: 'issued',
  ticketIds: ['t1'],
  amountPaid: 3325,
  currency: 'huf',
  pointsCredited: 50,
  confirmationEmailSentAt: new Date().toISOString(),
  match: { id: MATCH_ID_1, homeTeam: 'Kecskeméti TE', awayTeam: 'Ferencvárosi TC', venue: 'Széktói Stadion', kickoffAt: new Date(Date.now() + 86_400_000).toISOString() },
  seats: [{ section: 'A', row: '1', number: 5, price: 3325 }],
};
const PROCESSING = { status: 'processing', ticketIds: [], amountPaid: 0, currency: 'huf', pointsCredited: 0, match: null, seats: [] };

async function mockStatus(page: Page, ...bodies: unknown[]): Promise<{ calls: () => number }> {
  let n = 0;
  await page.route('**/payments/*/status', (route) => {
    const body = bodies[Math.min(n, bodies.length - 1)];
    n += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { calls: () => n };
}

test.describe('Confirmation Page – /checkout/confirmation', () => {
  test.beforeEach(async ({ page }) => {
    await mockRefreshSuccess(page);
  });

  test('without a payment there is nothing to confirm', async ({ page }) => {
    await page.goto('/checkout/confirmation');
    const checkout = new CheckoutPage(page);
    await expect(checkout.guardCard).toBeVisible();
    await expect(checkout.guardCard).toContainText('Nincs megerősíthető fizetés');
  });

  test('issued: "Megvan a jegyed", the real email, the amount and points from the server', async ({ page }) => {
    await mockStatus(page, ISSUED);
    const checkout = new CheckoutPage(page);
    await checkout.gotoConfirmation(PI);

    await expect(checkout.confirmTitle).toHaveText('Megvan a jegyed');
    await expect(checkout.confirmLead).toContainText('test@kte.hu');
    await expect(checkout.confirmLead).toContainText('a QR-kód pedig a profilodban található');
    await expect(checkout.confirmId).toHaveText(PI);
    await expect(checkout.confirmAmount).toContainText(/3\s?325/);
    await expect(checkout.confirmPoints).toContainText('+50 pont');
    await expect(checkout.openTicketLink).toHaveAttribute('href', /\/profile/);
    await expect(checkout.backToMatchesLink).toHaveAttribute('href', '/');
  });

  test('issued but email not marked as sent: the ticket is ready, and no email is mentioned', async ({ page }) => {
    await mockStatus(page, { ...ISSUED, confirmationEmailSentAt: null });
    const checkout = new CheckoutPage(page);
    await checkout.gotoConfirmation(PI);

    await expect(checkout.confirmTitle).toHaveText('Megvan a jegyed');
    await expect(checkout.confirmLead).toHaveText('A jegyed elkészült, a QR-kódot a profilodban találod.');
    await expect(page.locator('section.confirm')).not.toContainText('test@kte.hu');
    await expect(page.locator('section.confirm')).not.toContainText(/e-?mail|elküldtük/i);
  });

  test('the email claim appears once the server marks it as sent', async ({ page }) => {
    await mockStatus(page, { ...ISSUED, confirmationEmailSentAt: null }, ISSUED);
    const checkout = new CheckoutPage(page);
    await checkout.gotoConfirmation(PI);

    await expect(checkout.confirmLead).toContainText('A jegyed elkészült');
    await expect(checkout.confirmLead).toContainText('elküldtük', { timeout: 10_000 });
    await expect(checkout.confirmLead).toContainText('test@kte.hu');
  });

  test('processing: a calm state with no retry or payment button that resolves by itself', async ({ page }) => {
    const status = await mockStatus(page, PROCESSING, PROCESSING, ISSUED);
    const checkout = new CheckoutPage(page);
    await checkout.gotoConfirmation(SECOND_PI);

    await expect(checkout.confirmTitle).toHaveText('Feldolgozás alatt');
    await expect(checkout.confirmLead).toContainText('ne fizess újra');
    await expect(page.locator('section.confirm').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /fizet|újra|próbál/i })).toHaveCount(0);
    await expect(checkout.confirmId).toHaveText(SECOND_PI);

    await expect(checkout.confirmTitle).toHaveText('Megvan a jegyed', { timeout: 15_000 });
    expect(status.calls()).toBeGreaterThanOrEqual(3);
  });

  test('failed: says plainly that the card was not charged and links back to the cart', async ({ page }) => {
    await mockStatus(page, { ...PROCESSING, status: 'failed' });
    const checkout = new CheckoutPage(page);
    await checkout.gotoConfirmation(PI);

    await expect(checkout.confirmTitle).toHaveText('A fizetés nem sikerült');
    await expect(checkout.confirmLead).toContainText('nem terheltük');
    await expect(page.getByRole('link', { name: /vissza a kosárhoz/i })).toHaveAttribute('href', /\/cart/);
  });

  test('at 360px the confirmation fits the screen', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await mockStatus(page, ISSUED);
    const checkout = new CheckoutPage(page);
    await checkout.gotoConfirmation(PI);
    await expect(checkout.confirmTitle).toBeVisible();
    const overflow = await page.evaluate(() => {
      const sc = document.querySelector('mat-sidenav-content')!;
      return sc.scrollWidth - sc.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
