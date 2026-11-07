import { type Page, type Locator } from '@playwright/test';

/**
 * Page Object for the Login page (/login) and Registration page (/register).
 *
 * Both pages share the same visual structure (mat-card + reactive form) so a
 * single PO covers both, with a discriminating `isLoginPage` / `isRegisterPage`
 * helper.
 *
 * Selector strategy:
 *  1. ARIA roles and accessible names
 *  2. Angular Material label text (`mat-label` → rendered as `<label>`)
 *  3. CSS classes with semantic meaning (.kte-auth-*)
 */
export class AuthPage {
  readonly page: Page;

  // Shared
  readonly authCard: Locator;
  readonly cardTitle: Locator;
  readonly emailField: Locator;
  readonly passwordField: Locator;
  readonly togglePasswordButton: Locator;
  readonly errorMessage: Locator;
  readonly progressBar: Locator;

  // Login-specific
  readonly loginSubmitButton: Locator;
  readonly registerLink: Locator;

  // Register-specific
  readonly lastNameField: Locator;
  readonly firstNameField: Locator;
  readonly phoneField: Locator;
  readonly passwordConfirmField: Locator;
  readonly registerSubmitButton: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.authCard = page.locator('mat-card.kte-auth-card');
    this.cardTitle = page.locator('mat-card-title');

    // The mat-label "E-mail" renders an <input type="email"> that we reach
    // via the form-field label.
    this.emailField = page.getByLabel('E-mail');
    this.passwordField = page.getByLabel('Jelszó', { exact: true });
    this.togglePasswordButton = page.getByRole('button', {
      name: /jelszó megjelenítése|jelszó elrejtése/i,
    });
    this.errorMessage = page.locator('.kte-auth-form__error[role="alert"]');
    this.progressBar = page.locator('mat-progress-bar');

    // Login
    this.loginSubmitButton = page.getByRole('button', { name: 'Bejelentkezés' });
    this.registerLink = page.getByRole('link', { name: 'Regisztráció' });

    // Register
    this.lastNameField = page.getByLabel('Vezetéknév');
    this.firstNameField = page.getByLabel('Keresztnév');
    this.phoneField = page.getByLabel(/telefonszám/i);
    this.passwordConfirmField = page.getByLabel('Jelszó megerősítése');
    this.registerSubmitButton = page.getByRole('button', { name: 'Fiók létrehozása' });
    // Scoped to the auth card: the toolbar has a link with the same name.
    this.loginLink = this.authCard.getByRole('link', { name: 'Bejelentkezés' });
  }

  async gotoLogin(): Promise<void> {
    await this.page.goto('/login');
  }

  async gotoRegister(): Promise<void> {
    await this.page.goto('/register');
  }

  /**
   * Fills and submits the login form.
   */
  async login(email: string, password: string): Promise<void> {
    await this.emailField.fill(email);
    await this.passwordField.fill(password);
    await this.loginSubmitButton.click();
  }

  /**
   * Fills and submits the registration form.
   */
  async register(opts: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    passwordConfirm: string;
    phone?: string;
  }): Promise<void> {
    await this.lastNameField.fill(opts.lastName);
    await this.firstNameField.fill(opts.firstName);
    await this.emailField.fill(opts.email);
    if (opts.phone) {
      await this.phoneField.fill(opts.phone);
    }
    await this.passwordField.fill(opts.password);
    await this.passwordConfirmField.fill(opts.passwordConfirm);
    await this.registerSubmitButton.click();
  }
}
