import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import { AUTH_RESPONSE } from './fixtures/api-mocks';

/**
 * Auth setup – runs once per project dependency chain.
 *
 * This file is matched only by the `auth-setup` playwright project. It:
 *  1. Intercepts POST /auth/login to return a mocked AuthResponse.
 *  2. Intercepts POST /auth/refresh (called by AuthInitializer on boot) with a
 *     401, so the app boots as a guest and the login form is reachable.
 *  3. Navigates to /login, submits the form, and waits for the redirect.
 *  4. Saves the resulting browser storage state to .auth/user.json.
 *
 * The storageState file captures sessionStorage (where the refresh-token
 * fallback is written by AuthService.writeFallbackToken) so that authenticated
 * tests can simply pass `storageState: '.auth/user.json'` in their fixture.
 */

export const AUTH_STATE_PATH = path.join(__dirname, '.auth', 'user.json');

setup('authenticate and save storage state', async ({ page }) => {
  // Boot as a guest: the refresh endpoint answers 401, so the app stays on
  // /login. (If refresh succeeded, the app would restore a session and redirect
  // away from /login before the form could be used.)
  await page.route('**/auth/refresh', (route) => {
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
    });
  });

  await page.route('**/auth/login', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AUTH_RESPONSE),
    });
  });

  await page.goto('/login');
  await expect(page.locator('mat-card-title')).toContainText('Bejelentkezés');

  await page.getByLabel('E-mail').fill('test@kte.hu');
  await page.getByLabel('Jelszó', { exact: true }).fill('Teszt1234');
  await page.getByRole('button', { name: 'Bejelentkezés' }).click();

  // After successful login, AuthService writes the refresh token to
  // sessionStorage and the router navigates to '/'.
  await page.waitForURL('/');

  // Persist browser context (cookies + sessionStorage) for reuse.
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
