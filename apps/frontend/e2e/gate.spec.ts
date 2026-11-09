import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AUTH_USER } from './fixtures/api-mocks';

/**
 * The steward's screen: dark, full-screen, one decision at a time.
 *
 * The camera path runs for real: Chromium is started with a fake camera whose
 * "video" is a still of this test's ticket QR (generated below, no binary
 * fixture in the repo), so the page's own scanner finds a code in live frames
 * and sends it. Only the API is mocked, as in the rest of this suite.
 */

const TICKET_ID = 'tttttttt-0000-4000-8000-0000000000b1';
const b64url = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: TICKET_ID, typ: 'ticket' })}.${'s'.repeat(43)}`;

const KICKOFF = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const MATCH = { id: 'm1', homeTeam: 'Kecskeméti TE', awayTeam: 'Újpest FC', venue: 'Széktói Stadion', kickoffAt: KICKOFF };
const DETAILS = {
  ticketId: TICKET_ID,
  holderName: 'Nagy Kata',
  source: 'season_pass',
  match: MATCH,
  seat: { id: 's1', section: 'B', row: '5', number: 12, category: 'standard' },
};
const GATE_USER = { ...AUTH_USER, id: 'gggggggg-0000-4000-8000-000000000002', role: 'gate' };
const GATE_AUTH = { accessToken: 'a', refreshToken: 'r', expiresIn: 900, user: GATE_USER };

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/** A 640x480 Y4M clip of the QR code, for Chromium's fake camera. */
function writeQrClip(text: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const QRCode = require('qrcode') as {
    create(t: string, o: { errorCorrectionLevel: string }): { modules: { size: number; data: Uint8Array } };
  };
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
  const W = 640;
  const H = 480;
  const quiet = 4;
  const scale = Math.floor(420 / (size + quiet * 2));
  const side = (size + quiet * 2) * scale;
  const left = Math.floor((W - side) / 2);
  const top = Math.floor((H - side) / 2);
  const y = Buffer.alloc(W * H, 255);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!data[row * size + col]) continue;
      for (let dy = 0; dy < scale; dy++) {
        const start = (top + (row + quiet) * scale + dy) * W + left + (col + quiet) * scale;
        y.fill(0, start, start + scale);
      }
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2), 128);
  const frame = Buffer.concat([Buffer.from('FRAME\n'), y, chroma, chroma]);
  const clip = Buffer.concat([
    Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`),
    ...Array.from({ length: 30 }, () => frame),
  ]);
  const file = join(mkdtempSync(join(tmpdir(), 'kte-gate-')), 'qr.y4m');
  writeFileSync(file, clip);
  return file;
}

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${writeQrClip(TOKEN)}`,
    ],
  },
});
test.skip(({ browserName }) => browserName !== 'chromium', 'the fake camera is a Chromium feature');

type ScanAnswer = Record<string, unknown> | 'abort';

/**
 * Mocks the gate session and the scan endpoint; `answer` decides each reply.
 * `camera: false` makes the browser refuse the camera, for tests about manual
 * entry (the fake camera would otherwise scan the QR on its own, mid-test).
 */
async function openGate(
  page: Page,
  answer: () => ScanAnswer,
  { camera = true }: { camera?: boolean } = {},
): Promise<{ scans: string[] }> {
  const scans: string[] = [];
  await page.addInitScript((withCamera) => {
    (window as unknown as { __gum: number }).__gum = 0;
    const md = navigator.mediaDevices;
    const real = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => {
      (window as unknown as { __gum: number }).__gum++;
      return withCamera
        ? real(c)
        : Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    };
  }, camera);
  await page.route('**/auth/refresh', (r) => r.fulfill(json(GATE_AUTH)));
  await page.route('**/matches', (r) =>
    r.fulfill(json([{ ...MATCH, status: 'on_sale', capacity: 1, basePrice: '1', competition: 'NB1', isSeasonPassEligible: true }])),
  );
  await page.route(`**/tickets/${TICKET_ID}/scan`, (route) => {
    scans.push((route.request().postDataJSON() as { token: string }).token);
    const a = answer();
    return a === 'abort' ? route.abort('internetdisconnected') : route.fulfill(json(a));
  });
  return { scans };
}

/** "Következő" ignores a press for a moment; press until the screen has moved on. */
async function dismiss(page: Page): Promise<void> {
  await expect(async () => {
    if ((await page.getByRole('alert').count()) === 0) return;
    await page.getByRole('button', { name: 'Következő' }).click({ timeout: 1000 });
    await expect(page.getByRole('alert')).toHaveCount(0, { timeout: 2000 });
  }).toPass();
}

async function checkByHand(page: Page): Promise<void> {
  await page.getByLabel('QR token').fill(TOKEN);
  await page.getByRole('button', { name: 'Ellenőrzés' }).click();
}

test.describe('Gate screen', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test('scans a real QR from the camera and admits: seat, holder, ticket type', async ({ page }) => {
    const { scans } = await openGate(page, () => ({ success: true, result: 'ok', scannedAt: new Date().toISOString(), ...DETAILS }));
    await page.goto('/gate');

    await expect(page.getByTestId('verdict-title')).toHaveText('BELÉPHET', { timeout: 20_000 });
    expect(scans).toEqual([TOKEN]);
    await expect(page.getByTestId('gate-holder')).toHaveText('Nagy Kata');
    await expect(page.getByText('B szektor · 5. sor · 12. szék')).toBeVisible();
    await expect(page.getByText('Bérlet', { exact: true })).toBeVisible();
    await expect(page.getByTestId('admitted-count').locator('strong')).toHaveText('1');
  });

  test('a code that stays in front of the lens is read once, even after dismissing the verdict', async ({ page }) => {
    const { scans } = await openGate(page, () => ({ success: true, result: 'ok', ...DETAILS }));
    await page.goto('/gate');
    await expect(page.getByTestId('verdict-admitted')).toBeVisible({ timeout: 20_000 });
    await dismiss(page);
    await page.waitForTimeout(2500);
    expect(scans).toHaveLength(1);
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('asks for the camera on the gate page only', async ({ page }) => {
    await openGate(page, () => ({ success: false, result: 'invalid' }));
    await page.goto('/stadium');
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(0);
    await page.goto('/gate');
    await expect(page.getByTestId('live')).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(1);
  });

  test('is one bare screen: no header, navigation, profile or chat bubble, one button', async ({ page }) => {
    await openGate(page, () => ({ success: false, result: 'invalid' }), { camera: false });
    await page.goto('/gate');
    await expect(page.getByTestId('live')).toBeVisible();
    await expect(page.locator('mat-toolbar, mat-sidenav-container, kte-chatbot-widget, a[href]')).toHaveCount(0);
    await expect(page.locator('footer button')).toHaveText(['Kézi bevitel']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });

  test('already used and invalid code are different colours AND different words', async ({ page }) => {
    let answer: ScanAnswer = { success: false, result: 'already_used', scannedAt: new Date().toISOString(), ...DETAILS };
    await openGate(page, () => answer, { camera: false });
    await page.goto('/gate');
    await page.getByRole('button', { name: 'Kézi bevitel' }).click();

    await checkByHand(page);
    await expect(page.getByTestId('verdict-used')).toBeVisible();
    await expect(page.getByTestId('verdict-title')).toHaveText('MÁR FELHASZNÁLVA');
    await expect(page.getByTestId('scanned-when')).toContainText('Beolvasva: ma');
    await expect(page.getByTestId('verdict-instruction')).toContainText('ügyfélszolgálati pult');
    await expect(page.getByText('B szektor · 5. sor · 12. szék')).toBeVisible();
    const amber = await page.getByTestId('verdict-used').evaluate((e) => getComputedStyle(e).backgroundColor);
    await dismiss(page);

    answer = { success: false, result: 'invalid', message: 'invalid_signature' };
    await checkByHand(page);
    await expect(page.getByTestId('verdict-invalid')).toBeVisible();
    await expect(page.getByTestId('verdict-title')).toHaveText('ÉRVÉNYTELEN KÓD');
    const red = await page.getByTestId('verdict-invalid').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(red).not.toBe(amber);
  });

  test('no connection: refuses and says so, never admits, and "Újra" checks the same code again', async ({ page }) => {
    let answer: ScanAnswer = 'abort';
    const { scans } = await openGate(page, () => answer, { camera: false });
    await page.goto('/gate');
    await page.getByRole('button', { name: 'Kézi bevitel' }).click();

    await checkByHand(page);
    await expect(page.getByTestId('verdict-title')).toHaveText('NINCS HÁLÓZAT');
    await expect(page.getByTestId('verdict-instruction')).toContainText('nem léphet be');
    await expect(page.getByTestId('verdict-admitted')).toHaveCount(0);
    await expect(page.getByTestId('admitted-count').locator('strong')).toHaveText('0');

    answer = { success: true, result: 'ok', ...DETAILS };
    await expect(async () => {
      await page.getByRole('button', { name: 'Újra' }).click({ timeout: 1000 });
      await expect(page.getByTestId('verdict-admitted')).toBeVisible({ timeout: 2000 });
    }).toPass();
    expect(scans.at(-1)).toBe(TOKEN);
  });

  test('device offline: the scan is refused without sending anything — there is no offline queue', async ({ page, context }) => {
    const { scans } = await openGate(page, () => ({ success: true, result: 'ok', ...DETAILS }), { camera: false });
    await page.goto('/gate');
    await page.getByRole('button', { name: 'Kézi bevitel' }).click();
    await context.setOffline(true);
    await expect(page.getByTestId('live')).toContainText('Nincs hálózat');

    await checkByHand(page);
    await expect(page.getByTestId('verdict-title')).toHaveText('NINCS HÁLÓZAT');
    expect(scans).toHaveLength(0);
    await context.setOffline(false);
  });

  test('manual entry at 360px: the help text never covers the buttons', async ({ page }) => {
    await openGate(page, () => ({ success: false, result: 'invalid' }), { camera: false });
    await page.goto('/gate');
    await page.getByRole('button', { name: 'Kézi bevitel' }).click();

    const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
    const help = await box('.manual__help');
    const field = await box('.manual__field');
    const check = (await page.getByRole('button', { name: 'Ellenőrzés' }).boundingBox())!;
    const back = (await page.getByRole('button', { name: 'Vissza' }).boundingBox())!;
    expect(help.y + help.height).toBeLessThanOrEqual(field.y);
    expect(field.y + field.height).toBeLessThanOrEqual(check.y);
    expect(check.height).toBeGreaterThanOrEqual(56);
    expect(back.x + back.width).toBeLessThanOrEqual(check.x);

    // Whatever is at the centre of the button is the button itself.
    await page.getByLabel('QR token').fill(TOKEN);
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim(), {
      x: check.x + check.width / 2,
      y: check.y + check.height / 2,
    });
    expect(hit).toBe('Ellenőrzés');
  });
});

test.describe('Gate screen without a camera', () => {
  test('a refused camera leaves the page usable through manual entry', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    });
    await openGate(page, () => ({ success: true, result: 'ok', ...DETAILS }));
    await page.goto('/gate');
    await expect(page.getByTestId('camera-notice')).toBeVisible();
    await page.getByRole('button', { name: 'Kézi bevitel' }).click();
    await checkByHand(page);
    await expect(page.getByTestId('verdict-title')).toHaveText('BELÉPHET');
  });
});
