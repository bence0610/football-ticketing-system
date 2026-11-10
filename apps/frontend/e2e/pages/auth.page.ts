import { type Page, type Locator } from '@playwright/test';

/**
 * Page Object for the Login page (/login) and Registration page (/register).
 *
 * Both pages share the same split layout (brand panel + form), so a single PO
 * covers both.
 *
 * Selector strategy:
 *  1. ARIA roles and accessible names
 *  2. Field labels (`<label for>` of the auth field component)
 *  3. CSS classes with semantic meaning (.kte-auth-*, .kte-field__*)
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
  readonly fieldErrors: Locator;
  readonly emailTaken: Locator;

  // Login-specific
  readonly loginSubmitButton: Locator;
  readonly registerLink: Locator;

  // Register-specific
  readonly lastNameField: Locator;
  readonly firstNameField: Locator;
  readonly registerSubmitButton: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.authCard = page.locator('.auth__form');
    this.cardTitle = page.getByRole('heading', { level: 1 });

    // Each field's <label for> points at its input.
    this.emailField = page.getByLabel('E-mail');
    this.passwordField = page.getByLabel('Jelszó', { exact: true });
    this.togglePasswordButton = page.getByRole('button', {
      name: /jelszó megjelenítése|jelszó elrejtése/i,
    });
    // The standard error block (server message) - field errors live at the field.
    this.errorMessage = page.locator('.kte-auth-error[role="alert"]');
    this.fieldErrors = page.locator('.kte-field__msg [role="alert"]');
    this.emailTaken = page.getByTestId('email-taken');

    // Login
    this.loginSubmitButton = page.getByRole('button', { name: 'Bejelentkezés' });
    // Scoped to the form: the toolbar has a link with the same name.
    this.registerLink = this.authCard.getByRole('link', { name: 'Regisztráció' });

    // Register
    this.lastNameField = page.getByLabel('Vezetéknév');
    this.firstNameField = page.getByLabel('Keresztnév');
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
  }): Promise<void> {
    await this.lastNameField.fill(opts.lastName);
    await this.firstNameField.fill(opts.firstName);
    await this.emailField.fill(opts.email);
    await this.passwordField.fill(opts.password);
    await this.registerSubmitButton.click();
  }
}
