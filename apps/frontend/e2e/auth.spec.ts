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
 *   2. Submit button is disabled when form is empty
 *   3. Shows inline validation errors on untouched submit attempt
 *   4. Password visibility toggle works
 *   5. Successful login navigates to '/' and shows user menu in toolbar
 *   6. Successful login from /login?returnUrl=/cart redirects to /cart
 *   7. Invalid credentials (401) show an error message
 *   8. Link to /register is visible
 *
 *  Registration page:
 *   9.  Renders all required fields
 *  10.  Password mismatch shows validation error
 *  11.  Short password shows minlength validation error
 *  12.  Successful registration navigates to '/'
 *  13.  Duplicate email (409) shows API error message
 *  14.  Link back to /login is visible
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

  test('should disable the submit button when the form is untouched and empty', async ({
    page,
  }) => {
    const auth = new AuthPage(page);
    await auth.gotoLogin();

    // Angular marks the form as invalid from the start but the button uses
    // [disabled]="form.invalid" — the button should not be clickable.
    await expect(auth.loginSubmitButton).toBeDisabled();
  });

  test('should show field-level validation errors when submitting an empty form', async ({
    page,
  }) => {
    const auth = new AuthPage(page);
    await auth.gotoLogin();

    // Force Angular to mark fields as touched by clicking submit after enabling it
    // by typing then clearing the email field.
    await auth.emailField.fill('x');
    await auth.emailField.clear();
    await auth.passwordField.fill('x');
    await auth.passwordField.clear();

    // mat-error elements should now be visible
    await expect(page.locator('mat-error').first()).toBeVisible();
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

    await expect(auth.cardTitle).toContainText('Regisztráció');
    await expect(auth.lastNameField).toBeVisible();
    await expect(auth.firstNameField).toBeVisible();
    await expect(auth.emailField).toBeVisible();
    await expect(auth.passwordField).toBeVisible();
    await expect(auth.passwordConfirmField).toBeVisible();
    await expect(auth.registerSubmitButton).toBeVisible();
  });

  test('should show a password mismatch error when passwords do not match', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await auth.lastNameField.fill('Teszt');
    await auth.firstNameField.fill('Elek');
    await auth.emailField.fill('elek@kte.hu');
    await auth.passwordField.fill('Valami12');
    await auth.passwordConfirmField.fill('Masvalami99');

    // The submit button is disabled while the form is invalid, so it cannot be
    // clicked to trigger validation; leaving the field marks it touched.
    await auth.passwordConfirmField.blur();

    await expect(page.locator('mat-error', { hasText: /két jelszó nem egyezik/i })).toBeVisible();
  });

  test('should show minlength error when password is shorter than 8 characters', async ({
    page,
  }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await auth.passwordField.fill('Ab1');
    // Blur the field to trigger touched state
    await auth.emailField.click();

    await expect(
      page.locator('mat-error', { hasText: /legalább 8 karakteresnek/i }),
    ).toBeVisible();
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
      passwordConfirm: 'Teszt1234',
    });

    await expect(page).toHaveURL('/');
  });

  test('should show API error message when the email is already registered', async ({ page }) => {
    await mockRegisterConflict(page);

    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await auth.register({
      lastName: 'Teszt',
      firstName: 'Elek',
      email: 'existing@kte.hu',
      password: 'Teszt1234',
      passwordConfirm: 'Teszt1234',
    });

    await expect(auth.errorMessage).toBeVisible();
    await expect(auth.errorMessage).toContainText('Ez az e-mail cím már regisztrált.');
  });

  test('should display link back to the login page', async ({ page }) => {
    const auth = new AuthPage(page);
    await auth.gotoRegister();

    await expect(auth.loginLink).toBeVisible();
    await expect(auth.loginLink).toHaveAttribute('href', /\/login/);
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
