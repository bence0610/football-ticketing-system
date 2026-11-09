import { test, expect, type Page } from '@playwright/test';
import { AUTH_RESPONSE, AUTH_USER } from './fixtures/api-mocks';

/**
 * Journey: buy a season pass → open the per-match QR → get let in at the gate.
 *
 * Two people use two browser contexts, as in real life: the buyer on their
 * phone (fan session), the steward at the gate (gate session). The only thing
 * that crosses between them is the QR token, which the test reads out of the
 * buyer's QR dialog and pastes into the gate page — it is never hard-coded.
 *
 * The API is mocked (like the rest of this suite), by a small stateful fake:
 * the holder typed into the purchase form is what the fake's pass, QR and scan
 * answers carry. So this proves the BROWSER half end to end — form payload,
 * pass card, QR dialog, token hand-over, gate result. That the real backend
 * names the holder (not the buyer) at the scan is proved against the real
 * server in backend/test/purchase-entry.e2e-spec.ts ("family b").
 *
 * Variants:
 *  1. pass for the buyer themself → the gate shows the buyer's name
 *  2. pass bought for someone else → the gate shows the HOLDER, never the buyer
 */

const BUYER_NAME = `${AUTH_USER.lastName} ${AUTH_USER.firstName}`; // "Felhasználó Teszt"
const PASS_ID = 'pppppppp-0000-4000-8000-000000000001';
const MATCH_ID = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const TICKET_ID = 'tttttttt-0000-4000-8000-0000000000a1';
const PAYMENT_INTENT_ID = 'pi_season_pass_000001';
const PRICE = 60000;
const KICKOFF = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

const GATE_AUTH = {
  ...AUTH_RESPONSE,
  user: {
    ...AUTH_USER,
    id: 'gggggggg-0000-4000-8000-000000000001',
    email: 'kapu@kte.hu',
    firstName: 'Ellenőr',
    lastName: 'Kapu',
    role: 'gate',
  },
};

const b64url = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

/** A JWT-shaped token whose payload `sub` is the ticket id, as the gate page expects. */
function qrToken(ticketId: string): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: ticketId, typ: 'ticket' })}.sig`;
}

const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

// A 1x1 transparent PNG, so the QR <img> has something to load.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** What the fake backend remembers across the two sessions. */
interface FakeBackend {
  purchaseBodies: Array<Record<string, unknown>>;
  /** Set when the (stubbed) card payment succeeded; the next purchase call finalises. */
  paid: boolean;
  /** The body of the call that finalised the pass. */
  finalBody: Record<string, unknown> | null;
  holderName: string | null; // null until the pass exists
  scanBodies: Array<{ ticketId: string; token: string }>;
  ticketUsed: boolean;
}

function newBackend(): FakeBackend {
  return { purchaseBodies: [], paid: false, finalBody: null, holderName: null, scanBodies: [], ticketUsed: false };
}

async function mockSession(page: Page, auth: typeof AUTH_RESPONSE | typeof GATE_AUTH): Promise<void> {
  await page.route('**/auth/refresh', (route) => route.fulfill(json(auth)));
}

/** Stripe stub: the Payment Element reports ready and payment succeeds. */
async function stubStripe(page: Page, backend: FakeBackend): Promise<void> {
  await page.exposeFunction('__kteCardPaid', () => {
    backend.paid = true;
  });
  await page.addInitScript((paymentIntentId) => {
    const element = {
      mount: () => undefined,
      destroy: () => undefined,
      on: (event: string, handler: () => void) => {
        if (event === 'ready') setTimeout(handler, 0);
      },
    };
    const stripe = {
      elements: () => ({ create: () => element }),
      confirmPayment: async () => {
        await (window as unknown as { __kteCardPaid: () => Promise<void> }).__kteCardPaid();
        return {
        error: null,
        paymentIntent: { id: paymentIntentId, status: 'succeeded' },
        };
      },
    };
    // @ts-expect-error – test stub for the global Stripe.js factory
    window.Stripe = () => stripe;
  }, PAYMENT_INTENT_ID);
}

async function mockBuyerApi(page: Page, backend: FakeBackend): Promise<void> {
  await page.route('**/season-passes/prices', (route) =>
    route.fulfill(
      json([
        {
          sectionId: 'A',
          sectionName: 'A szektor',
          price: PRICE,
          currency: 'HUF',
          seasonLabel: '2026/2027',
        },
      ]),
    ),
  );

  await page.route('**/season-passes/purchase', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    backend.purchaseBodies.push(body);
    // Calls before the card is charged prepare a payment intent; the call after finalises the pass.
    const finalising = backend.paid;
    if (finalising) {
      backend.finalBody = body;
      backend.holderName =
        typeof body['holderName'] === 'string' && body['holderName'] ? body['holderName'] : BUYER_NAME;
    }
    return route.fulfill(
      json({
        paymentIntentId: PAYMENT_INTENT_ID,
        clientSecret: finalising ? null : `${PAYMENT_INTENT_ID}_secret_x`,
        status: finalising ? 'succeeded' : 'requires_payment_method',
        seasonPassId: finalising ? PASS_ID : null,
        succeeded: finalising,
        seasonLabel: '2026/2027',
        amount: PRICE,
        currency: 'HUF',
      }),
    );
  });

  // --- profile page ---------------------------------------------------------
  await page.route('**/users/me', (route) =>
    route.fulfill(
      json({
        ...AUTH_USER,
        emailVerified: true,
        twoFactorEnabled: false,
        createdAt: new Date().toISOString(),
      }),
    ),
  );
  await page.route('**/tickets/me', (route) => route.fulfill(json([])));
  await page.route('**/waitlist/me', (route) => route.fulfill(json([])));
  await page.route('**/matches', (route) =>
    route.fulfill(
      json([
        {
          id: MATCH_ID,
          homeTeam: 'Kecskeméti TE',
          awayTeam: 'Újpest FC',
          competition: 'nb1',
          venue: 'Széktói Stadion',
          kickoffAt: KICKOFF,
          status: 'scheduled',
          capacity: 6000,
          basePrice: '3500',
          isSeasonPassEligible: true,
        },
      ]),
    ),
  );
  await page.route('**/season-passes/me', (route) => {
    const holderName = backend.holderName;
    if (!holderName) return route.fulfill(json([]));
    const forSomeoneElse = holderName !== BUYER_NAME;
    return route.fulfill(
      json([
        {
          id: PASS_ID,
          holderName,
          isBuyer: true,
          isHolder: !forSomeoneElse,
          status: 'active',
          seasonLabel: '2026/2027',
          validFrom: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          validUntil: new Date(Date.now() + 300 * 86_400_000).toISOString(),
          seatLabel: 'A szektor, 3. sor, 12. szék',
          section: 'A',
          purchasedAt: new Date().toISOString(),
          pricePaid: String(PRICE),
          currency: 'HUF',
          loans: [],
        },
      ]),
    );
  });

  // --- per-match QR ---------------------------------------------------------
  await page.route(`**/season-passes/${PASS_ID}/qr/${MATCH_ID}`, (route) =>
    route.fulfill(
      json({
        ticketId: TICKET_ID,
        dataUrl: PIXEL,
        token: qrToken(TICKET_ID),
        holderName: backend.holderName,
      }),
    ),
  );
}

async function mockGateApi(page: Page, backend: FakeBackend): Promise<void> {
  await page.route(`**/tickets/${TICKET_ID}/scan`, (route) => {
    const body = route.request().postDataJSON() as { token: string };
    backend.scanBodies.push({ ticketId: TICKET_ID, token: body.token });
    if (body.token !== qrToken(TICKET_ID)) {
      return route.fulfill(json({ success: false, result: 'invalid', message: 'invalid_token' }));
    }
    if (backend.ticketUsed) {
      return route.fulfill(
        json({ success: false, result: 'already_used', ticketId: TICKET_ID }),
      );
    }
    backend.ticketUsed = true;
    return route.fulfill(
      json({
        success: true,
        result: 'ok',
        ticketId: TICKET_ID,
        scannedAt: new Date().toISOString(),
        holderName: backend.holderName,
        match: {
          id: MATCH_ID,
          homeTeam: 'Kecskeméti TE',
          awayTeam: 'Újpest FC',
          venue: 'Széktói Stadion',
          kickoffAt: KICKOFF,
        },
        seat: { id: 's1', section: 'A', row: '3', number: 12, category: 'standard' },
      }),
    );
  });
}

/** Steps 1–3 for the buyer; returns the QR token shown in the dialog. */
async function buyPassAndOpenQr(
  page: Page,
  backend: FakeBackend,
  holder: { name: string } | null,
): Promise<string> {
  await mockSession(page, AUTH_RESPONSE);
  await stubStripe(page, backend);
  await mockBuyerApi(page, backend);

  // 1. Buy
  await page.goto('/season-pass');
  await page.getByRole('button', { name: /A szektor/ }).click();
  if (holder) {
    await page.getByTestId('holder-other').check();
    await page.getByTestId('holder-name').fill(holder.name);
    await page.getByTestId('holder-apply').click();
  }
  const pay = page.getByRole('button', { name: /Vásárlás \(/ });
  await expect(pay).toBeEnabled({ timeout: 10_000 });
  await pay.click();

  await expect(page).toHaveURL(/\/season-pass\/confirmation/);
  await expect(page.getByRole('heading', { name: 'Sikeres bérletvásárlás!' })).toBeVisible();

  // The call that finalised the pass carried exactly the holder the form collected.
  expect(backend.finalBody).not.toBeNull();
  expect(backend.finalBody!['sectionId']).toBe('A');
  if (holder) expect(backend.finalBody!['holderName']).toBe(holder.name);
  else expect(backend.finalBody!['holderName']).toBeUndefined();

  // 2. The pass shows up on the profile, naming its holder
  await page.getByRole('link', { name: 'Bérleteim megtekintése' }).click();
  await expect(page).toHaveURL(/\/profile/);
  await page.getByRole('tab', { name: /Bérletek/ }).click();
  await expect(page.getByTestId('pass-holder')).toHaveText(holder?.name ?? BUYER_NAME);

  // 3. Per-match QR
  await page.getByTestId('qr-btn').click();
  await expect(page.getByTestId('qr-holder')).toHaveText(holder?.name ?? BUYER_NAME);
  await expect(page.locator('img.qr')).toBeVisible();
  const token = (await page.locator('img.qr').getAttribute('data-token'))?.trim() ?? '';
  expect(token.split('.')).toHaveLength(3);
  return token;
}

test.describe('Season pass → QR → gate', () => {
  test('a pass for the buyer themself: the gate lets them in under their own name', async ({
    page,
    browser,
    baseURL,
  }) => {
    const backend = newBackend();
    const token = await buyPassAndOpenQr(page, backend, null);

    const gateContext = await browser.newContext({ baseURL, locale: 'hu-HU' });
    try {
      const gate = await gateContext.newPage();
      await mockSession(gate, GATE_AUTH);
      await mockGateApi(gate, backend);

      await gate.goto('/gate');
      await gate.getByLabel('QR token').fill(token);
      await gate.getByRole('button', { name: 'Ellenőrzés' }).click();

      await expect(gate.getByText('Belépés engedélyezve')).toBeVisible();
      await expect(gate.getByTestId('gate-holder')).toHaveText(BUYER_NAME);
      await expect(gate.getByText('Kecskeméti TE – Újpest FC')).toBeVisible();
      await expect(gate.getByText('Szektor: A', { exact: false })).toBeVisible();

      // The steward's page sent exactly the token the buyer's dialog displayed.
      expect(backend.scanBodies).toEqual([{ ticketId: TICKET_ID, token }]);
    } finally {
      await gateContext.close();
    }
  });

  test('a pass bought for someone else: the gate names the holder, not the buyer', async ({
    page,
    browser,
    baseURL,
  }) => {
    const HOLDER = 'Kovács Bence';
    const backend = newBackend();
    const token = await buyPassAndOpenQr(page, backend, { name: HOLDER });

    const gateContext = await browser.newContext({ baseURL, locale: 'hu-HU' });
    try {
      const gate = await gateContext.newPage();
      await mockSession(gate, GATE_AUTH);
      await mockGateApi(gate, backend);

      await gate.goto('/gate');
      await gate.getByLabel('QR token').fill(token);
      await gate.getByRole('button', { name: 'Ellenőrzés' }).click();

      await expect(gate.getByText('Belépés engedélyezve')).toBeVisible();
      await expect(gate.getByTestId('gate-holder')).toHaveText(HOLDER);
      // The buyer's name must appear nowhere on the result.
      await expect(gate.locator('.kte-gate-result')).not.toContainText(AUTH_USER.firstName);
      await expect(gate.locator('.kte-gate-result')).not.toContainText(AUTH_USER.lastName);

      // The same QR shown a second time is refused.
      await gate.getByRole('button', { name: 'Következő jegy' }).click();
      await gate.getByLabel('QR token').fill(token);
      await gate.getByRole('button', { name: 'Ellenőrzés' }).click();
      await expect(gate.getByText('A jegy már be lett mutatva')).toBeVisible();
      await expect(gate.getByTestId('gate-holder')).toHaveCount(0);
    } finally {
      await gateContext.close();
    }
  });

  test('a fan who opens /gate is turned away, not shown the scanner', async ({ page }) => {
    await mockSession(page, AUTH_RESPONSE);
    await page.goto('/gate');
    await expect(page).toHaveURL('/');
    await expect(page.getByLabel('QR token')).toHaveCount(0);
  });
});
