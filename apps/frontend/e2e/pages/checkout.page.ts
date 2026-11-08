import { type Page, type Locator } from '@playwright/test';

/**
 * Page Object for the Checkout page (/checkout) and the Confirmation page
 * (/checkout/confirmation).
 *
 * Selector strategy: roles and accessible names first, then data-testid hooks
 * on the pieces that have no good role.
 */
export class CheckoutPage {
  readonly page: Page;

  // Stripped header (payment focus)
  readonly toolbar: Locator;
  readonly headerNav: Locator;
  readonly secureLabel: Locator;
  readonly headerLinks: Locator;

  // Step bar
  readonly steps: Locator;
  readonly holdPill: Locator;
  readonly lockStatusCountdown: Locator;

  // Page structure
  readonly pageHeading: Locator;
  readonly emptyState: Locator;

  // Weather band
  readonly weatherBand: Locator;
  readonly weatherCover: Locator;

  // Payment card
  readonly buyer: Locator;
  readonly stripeLoader: Locator;
  readonly initializationError: Locator;
  readonly paymentError: Locator;
  readonly supportBlock: Locator;
  readonly stripeNote: Locator;

  // Expired hold alert
  readonly expiredAlert: Locator;
  readonly payRemainingButton: Locator;
  readonly chooseSeatLink: Locator;

  // Summary
  readonly summary: Locator;
  readonly summarySeats: Locator;
  readonly summarySubtotal: Locator;
  readonly summaryTotal: Locator;
  readonly paymentButton: Locator;
  readonly issueNote: Locator;
  readonly pointsLine: Locator;
  readonly discountRow: Locator;

  // Confirmation
  readonly confirmTitle: Locator;
  readonly confirmLead: Locator;
  readonly confirmId: Locator;
  readonly confirmAmount: Locator;
  readonly confirmPoints: Locator;
  readonly confirmSupport: Locator;
  readonly openTicketLink: Locator;
  readonly backToMatchesLink: Locator;
  readonly guardCard: Locator;

  constructor(page: Page) {
    this.page = page;

    this.toolbar = page.locator('mat-toolbar.kte-shell__toolbar');
    this.headerNav = page.locator('.kte-shell__nav');
    this.secureLabel = page.locator('[data-testid="secure-label"]');
    this.headerLinks = this.toolbar.locator('a, button');

    this.steps = page.getByRole('navigation', { name: 'Vásárlás lépései' });
    this.holdPill = page.locator('[data-testid="hold-pill"]');
    this.lockStatusCountdown = page.locator('.kte-checkout__lock-status');

    this.pageHeading = page.locator('section.kte-checkout h1');
    this.emptyState = page.locator('[data-testid="checkout-empty"]');

    this.weatherBand = page.locator('[data-testid="weather-band"]');
    this.weatherCover = page.locator('[data-testid="weather-cover"]');

    this.buyer = page.locator('[data-testid="buyer"]');
    this.stripeLoader = page.locator('.kte-checkout__loader');
    this.initializationError = page.locator('.kte-checkout__error[role="alert"]').first();
    this.paymentError = page.locator('.kte-checkout__error[role="alert"]').last();
    this.supportBlock = page.locator('.kte-checkout__support');
    this.stripeNote = page.locator('[data-testid="stripe-note"]');

    this.expiredAlert = page.locator('[data-testid="expired-alert"]');
    this.payRemainingButton = page.getByRole('button', { name: /fizetés a megmaradt/i });
    this.chooseSeatLink = page.getByRole('link', { name: /másik szék választása/i });

    this.summary = page.locator('aside.kte-checkout__summary');
    this.summarySeats = page.locator('[data-testid="summary-seat"]');
    this.summarySubtotal = page.locator('[data-testid="summary-subtotal"]');
    this.summaryTotal = page.locator('[data-testid="summary-total"]');
    this.paymentButton = page.getByRole('button', { name: /^(fizetés ·|feldolgozás)/i });
    this.issueNote = page.locator('[data-testid="issue-note"]');
    this.pointsLine = page.locator('[data-testid="summary-points"]');
    this.discountRow = page.locator('[data-testid="summary-discount"]');

    this.confirmTitle = page.locator('[data-testid="confirm-title"]');
    this.confirmLead = page.locator('[data-testid="confirm-lead"]');
    this.confirmId = page.locator('[data-testid="confirm-id"]');
    this.confirmAmount = page.locator('[data-testid="confirm-amount"]');
    this.confirmPoints = page.locator('[data-testid="confirm-points"]');
    this.confirmSupport = page.locator('[data-testid="confirm-support"]');
    this.openTicketLink = page.getByRole('link', { name: /jegy megnyitása/i });
    this.backToMatchesLink = page.getByRole('link', { name: /vissza a mérkőzésekhez/i });
    this.guardCard = page.locator('[data-testid="confirm-missing"]');
  }

  async gotoCheckout(): Promise<void> {
    await this.page.goto('/checkout');
  }

  async gotoConfirmation(paymentIntentId?: string): Promise<void> {
    await this.page.goto(
      paymentIntentId
        ? `/checkout/confirmation?payment_intent=${paymentIntentId}`
        : '/checkout/confirmation',
    );
  }
}
