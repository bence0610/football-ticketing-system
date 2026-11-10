import { test, expect } from '@playwright/test';
import { AuthPage } from './pages/auth.page';
import { AppShellPage } from './pages/app-shell.page';
import { AUTH_RESPONSE, AUTH_USER } from './fixtures/api-mocks';

/**
 * E2E tests for the Authentication flows (EPIC E5).
 *
 * Covered scenarios:
 *  Login page:
 *   1. Renders heading, email, password fields and submit button
 *   2. Submitting an empty form calls nothing and shows the errors at the fields
 *   3. A field error appears once the field is left
 *   4. Password visibility toggle works
 *   5. Successful login navigates to '/' and shows user menu in toolbar
 *   6. Successful login from /login?returnUrl=/cart redirects to /cart
 *   7. Invalid credentials (401) show an error message
 *   8. Link to /register is visible
 *
 *  Registration page:
 *   9.  Renders all required fields (no confirm field, no terms)
 *  10.  The strength meter follows the server's password rule
 *  11.  Short password shows its error at the field once it is left
 *  12.  Successful registration navigates to '/'
 *  13.  Duplicate email (409) is said at the email field, with a link to login
 *  14.  Link back to /login is visible
 *
 *  Password reset:
 *  - login links to it; the same answer for any address; set a new password from the
 *    emailed link; expired / used links are refused with a way to ask again
 *
 *  Route guards:
 *  15.  Navigating to /login while authenticated redirects to '/'
 *  16.  Navigating to /profile without auth redirects to /login?returnUrl=/profile
 *  17.  Navigating to /checkout without auth redirects to /login?returnUrl=/checkout
 *
 * All API calls are intercepted — no live backend is required.
 * Each test is fully isolated with its own browser context.
 */

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

async function mockRefreshFail(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({ status: 401, body: 'Unauthorized' }),
  );
}

async function mockRefreshSuccess(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/auth/refresh', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AUTH_RESPONSE),
    }),
  );
}

// The home page loads the signed-in user's loyalty snapshot. These tests sign in
// with a fake token, so the backend would answer 401 and the app would log the
// user straight back out - mock the endpoint like the auth calls.
async function mockLoyalty(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/loyalty/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        points: 0,
        tier: { tier: 'bronze', label: 'Kék', minPoints: 0, discountPercent: 0, color: '#1F5C8B' },
        recentTransactions: [],
      }),
    }),
  );
}

async function mockLoginSuccess(page: import('@playwright/test').Page): Promise<void> {
  await mockLoyalty(page);
  await page.route('**/auth/login', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AUTH_RESPONSE),
    }),
  );
}

async function mockLoginFailure(page: import('@playwright/test').Page, status = 401): Promise<void> {
  await page.route('**/auth/login', (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: status, message: 'Hibás e-mail vagy jelszó.' }),
    }),
  );
}

async function mockRegisterSuccess(page: import('@playwright/test').Page): Promise<void> {
  await mockLoyalty(page);
  await page.route('**/auth/register', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(AUTH_RESPONSE),
    }),
  );
}

async function mockRegisterConflict(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/auth/register', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 409, message: 'Ez az e-mail cím már regisztrált.' }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Login page tests
// ---------------------------------------------------------------------------

test.describe('Login Page – /login', () => {
  test.beforeEach(async ({ page }) => {
    // Session restore at startup must fail so the user appears unauthenticated
    await mockRefreshFail(page);
  });

  test('should render heading, email, password fields and submit button', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoLogin();

    await expect(auth.cardTitle).toContainText('Bejelentkezés');
    await expect(auth.emailField).toBeVisible();
    await expect(auth.passwordField).toBeVisible();
    await expect(auth.loginSubmitButton).toBeVisible();
  });

  test('should call nothing and show the errors at the fields when submitting an empty form', async ({
    page,
  }) => {
    let called = false;
    await page.route('**/auth/login', (route) => {
      called = true;
      return route.fulfill({ status: 500, body: '' });
    });
    const auth = new AuthPage(page);
    await auth.gotoLogin();

    await expect(auth.loginSubmitButton).toBeEnabled();
    await auth.loginSubmitButton.click();

    await expect(auth.fieldErrors).toHaveCount(2);
    expect(called).toBe(false);
  });

  test('should show a field error only once the field has been left', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoLogin();

    await auth.emailField.fill('nem-email');
    await expect(auth.fieldErrors).toHaveCount(0); // still typing in it

    await auth.passwordField.focus(); // leave the email field
    await expect(auth.fieldErrors.first()).toContainText('nem érvényes e-mail');
  });

  test('should toggle password visibility when the eye-icon button is clicked', async ({
    page,
  }) => {
    const auth = new AuthPage(page);
    await auth.gotoLogin();

    // Default: password type is 'password'
    await expect(auth.passwordField).toHaveAttribute('type', 'password');

    await auth.togglePasswordButton.click();

    // After toggle: type changes to 'text'
    await expect(auth.passwordField).toHaveAttribute('type', 'text');

    // Toggling again restores 'password'
    await auth.togglePasswordButton.click();
    await expect(auth.passwordField).toHaveAttribute('type', 'password');
  });

  test('should navigate to "/" and show user menu after a successful login', async ({ page }) => {
    await mockLoginSuccess(page);

    const auth = new AuthPage(page);
    const shell = new AppShellPage(page);
    await auth.gotoLogin();

    await auth.login('test@kte.hu', 'Teszt1234');

    // Redirected to home
    await expect(page).toHaveURL('/');

    // The user menu button replaces the "Bejelentkezés" link in the toolbar
    await expect(shell.userMenuButton).toBeVisible();
    await expect(shell.loginButton).not.toBeVisible();
  });

  test('should show user initials in the toolbar after login', async ({ page }) => {
    await mockLoginSuccess(page);

    const auth = new AuthPage(page);
    await auth.gotoLogin();
    await auth.login('test@kte.hu', 'Teszt1234');
    await page.waitForURL('/');

    // Expected initials: lastName[0] + firstName[0] = "FT" (Felhasználó Teszt)
    const expectedInitials =
      (AUTH_USER.lastName[0] ?? '').toUpperCase() + (AUTH_USER.firstName[0] ?? '').toUpperCase();
    await expect(page.locator('.kte-shell__avatar')).toContainText(expectedInitials);
  });

  test('should redirect to returnUrl after login when one is present', async ({ page }) => {
    await mockLoginSuccess(page);
    // Also stub matches and seats so the cart page does not crash
    await page.route('**/api/matches', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    const auth = new AuthPage(page);
    await page.goto('/login?returnUrl=/cart');

    await auth.login('test@kte.hu', 'Teszt1234');

    await expect(page).toHaveURL('/cart');
  });

  test('should display an error message when the login API returns 401', async ({ page }) => {
    await mockLoginFailure(page);

    const auth = new AuthPage(page);
    await auth.gotoLogin();
    await auth.login('wrong@kte.hu', 'wrongpass1');

    await expect(auth.errorMessage).toBeVisible();
    await expect(auth.errorMessage).toContainText('Hibás e-mail vagy jelszó.');

    // Must stay on the login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('should display link to the registration page', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoLogin();

    await expect(auth.registerLink).toBeVisible();
    await expect(auth.registerLink).toHaveAttribute('href', /\/register/);
  });
});

// ---------------------------------------------------------------------------
// Registration page tests
// ---------------------------------------------------------------------------

test.describe('Registration Page – /register', () => {
  test.beforeEach(async ({ page }) => {
    await mockRefreshFail(page);
  });

  test('should render all required registration fields', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await expect(auth.cardTitle).toContainText('Fiók létrehozása');
    await expect(auth.lastNameField).toBeVisible();
    await expect(auth.firstNameField).toBeVisible();
    await expect(auth.emailField).toBeVisible();
    await expect(auth.passwordField).toBeVisible();
    await expect(auth.registerSubmitButton).toBeVisible();
    // Nothing to tick or link to: there are no terms pages
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });

  test('should describe, and follow, the rule the server enforces for the password', async ({
    page,
  }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await expect(page.getByTestId('password-rule')).toContainText(
      'Legalább 8 karakter, benne legalább egy betű (a–z) és egy szám.',
    );

    // Long enough but no digit: the server rejects it, so the meter must not look fine.
    await auth.passwordField.fill('abcdefghijklmnop');
    await expect(page.getByTestId('strength')).toHaveAttribute('data-level', 'rejected');

    await auth.passwordField.fill('Jelszo123');
    await expect(page.getByTestId('strength')).toHaveAttribute('data-level', 'accepted');
  });

  test('should show the minimum-length error at the password field once it is left', async ({
    page,
  }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await auth.passwordField.fill('Ab1');
    await auth.emailField.click(); // leave the password field

    await expect(auth.fieldErrors.filter({ hasText: /legalább 8 karakter/i })).toBeVisible();
  });

  test('should navigate to "/" after a successful registration', async ({ page }) => {
    await mockRegisterSuccess(page);

    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await auth.register({
      lastName: 'Teszt',
      firstName: 'Elek',
      email: 'elek@kte.hu',
      password: 'Teszt1234',
    });

    await expect(page).toHaveURL('/');
  });

  test('should say at the email field that the address is taken, and link to login', async ({
    page,
  }) => {
    await mockRegisterConflict(page);

    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await auth.register({
      lastName: 'Teszt',
      firstName: 'Elek',
      email: 'existing@kte.hu',
      password: 'Teszt1234',
    });

    await expect(auth.emailTaken).toBeVisible();
    await expect(auth.emailTaken).toContainText('már tartozik fiók');
    await expect(auth.emailTaken.getByRole('link', { name: 'Jelentkezz be' })).toHaveAttribute(
      'href',
      /\/login/,
    );
    await expect(auth.errorMessage).toHaveCount(0); // not at the top of the page
  });

  test('should display link back to the login page', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await expect(auth.loginLink).toBeVisible();
    await expect(auth.loginLink).toHaveAttribute('href', /\/login/);
  });
});

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

test.describe('Password reset', () => {
  const ANSWER =
    'Ha ez az e-mail-cím regisztrálva van, elküldtük a jelszó-visszaállító linket. A link 1 óra múlva lejár.';

  test.beforeEach(async ({ page }) => {
    await mockRefreshFail(page);
  });

  test('the login page links to it, and the link leads there', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoLogin();
    await page.getByTestId('forgot-link').click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(auth.cardTitle).toContainText('Elfelejtett jelszó');
  });

  test('requesting a link shows the same answer for any address', async ({ page }) => {
    const sent: string[] = [];
    await page.route('**/auth/password-reset/request', (route) => {
      sent.push((route.request().postDataJSON() as { email: string }).email);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: ANSWER }),
      });
    });

    for (const address of ['van@kte.hu', 'nincs@kte.hu']) {
      await page.goto('/forgot-password');
      await page.getByLabel('E-mail').fill(address);
      await page.getByRole('button', { name: 'Link küldése' }).click();
      await expect(page.getByTestId('reset-requested')).toContainText(ANSWER);
    }
    expect(sent).toEqual(['van@kte.hu', 'nincs@kte.hu']);
  });

  test('the emailed link sets a new password and returns to login with a notice', async ({
    page,
  }) => {
    await page.route('**/auth/password-reset/tok-good-token-1234567890', (route) =>
      route.fulfill({ status: 204, body: '' }),
    );
    let confirmBody: { token: string; password: string } | null = null;
    await page.route('**/auth/password-reset/confirm', (route) => {
      confirmBody = route.request().postDataJSON() as { token: string; password: string };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'A jelszavad megváltozott. Jelentkezz be az új jelszóval.' }),
      });
    });

    await page.goto('/reset-password/tok-good-token-1234567890');
    await page.getByLabel('Új jelszó', { exact: true }).fill('abcdefgh'); // no digit
    await expect(page.getByTestId('strength')).toHaveAttribute('data-level', 'rejected');
    await page.getByLabel('Új jelszó', { exact: true }).fill('Jelszo1234');
    await expect(page.getByTestId('strength')).toHaveAttribute('data-level', 'accepted');
    await page.getByRole('button', { name: 'Új jelszó mentése' }).click();

    await expect(page).toHaveURL(/\/login\?reset=1/);
    await expect(page.getByTestId('login-reset-done')).toContainText('A jelszavad megváltozott');
    expect(confirmBody).toEqual({ token: 'tok-good-token-1234567890', password: 'Jelszo1234' });
  });

  for (const [code, message] of [
    ['reset_token_expired', 'A visszaállító link lejárt. Kérj új linket.'],
    ['reset_token_used', 'Ezt a visszaállító linket már felhasználták, vagy közben újat kértél.'],
  ] as const) {
    test(`a ${code} link says so and offers a new one`, async ({ page }) => {
      await page.route('**/auth/password-reset/tok-bad-token-1234567890', (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 400, code, message }),
        }),
      );
      await page.goto('/reset-password/tok-bad-token-1234567890');

      await expect(page.getByTestId('reset-refused')).toContainText(message);
      await expect(page.getByLabel('Új jelszó', { exact: true })).toHaveCount(0);
      await page.getByTestId('request-new').click();
      await expect(page).toHaveURL(/\/forgot-password$/);
    });
  }

  test('the reset page works while signed in too (the link opens in any session)', async ({
    page,
  }) => {
    await mockRefreshSuccess(page);
    await page.route('**/auth/password-reset/tok-good-token-1234567890', (route) =>
      route.fulfill({ status: 204, body: '' }),
    );
    await page.goto('/reset-password/tok-good-token-1234567890');
    await expect(page.getByLabel('Új jelszó', { exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Route guard tests
// ---------------------------------------------------------------------------

test.describe('Route Guards', () => {
  test('should redirect an authenticated user away from /login to "/"', async ({ page }) => {
    // Simulate authenticated session by returning a valid auth response on refresh
    await mockRefreshSuccess(page);

    await page.goto('/login');

    // The guestGuard redirects away from /login for authenticated users
    await expect(page).toHaveURL('/');
  });

  test('should redirect an authenticated user away from /register to "/"', async ({ page }) => {
    await mockRefreshSuccess(page);

    await page.goto('/register');

    await expect(page).toHaveURL('/');
  });

  test('should redirect an unauthenticated user from /profile to /login with returnUrl', async ({
    page,
  }) => {
    await mockRefreshFail(page);

    await page.goto('/profile');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fprofile/);
  });

  test('should redirect an unauthenticated user from /checkout to /login with returnUrl', async ({
    page,
  }) => {
    await mockRefreshFail(page);

    await page.goto('/checkout');

    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fcheckout/);
  });
});
