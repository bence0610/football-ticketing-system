import { type Page, type Locator } from '@playwright/test';

/**
 * Page Object for the App Shell (toolbar, sidenav, footer).
 *
 * The shell is present on every page inside the <kte-app-shell> wrapper.
 * Tests that need to assert on the cart badge, user menu, or login button
 * should use this PO alongside the feature-specific PO.
 *
 * Selector strategy:
 *  1. ARIA labels (preferred — directly reflects accessibility)
 *  2. Angular Material component CSS classes with semantic meaning
 *  3. Text content for labels
 */
export class AppShellPage {
  readonly page: Page;

  // Toolbar
  readonly toolbar: Locator;
  readonly brandLink: Locator;

  // Cart badge icon button
  readonly cartIconButton: Locator;
  readonly cartBadge: Locator;

  // Auth controls (unauthenticated state)
  readonly loginButton: Locator;

  // Auth controls (authenticated state)
  readonly userMenuButton: Locator;
  readonly userMenuProfileLink: Locator;
  readonly userMenuLoyaltyLink: Locator;
  readonly logoutMenuButton: Locator;

  // Mobile hamburger
  readonly hamburgerButton: Locator;
  readonly sidenav: Locator;

  // Iteration 4: "Hűség" navigation link in toolbar and sidenav
  readonly loyaltyNavLink: Locator;

  // KTE-059: Chatbot widget (Iteration 5)
  // The launcher is a round button in the header toolbar, aria-label="KTE AI Asszisztens megnyitása"
  readonly chatbotFab: Locator;
  // The CDK overlay panel rendered by ChatbotPanelComponent
  readonly chatbotPanel: Locator;
  // The close button inside the panel header
  readonly chatbotCloseButton: Locator;
  // Suggestion chip buttons rendered in the empty state
  readonly chatbotSuggestionChips: Locator;
  // The text input field
  readonly chatbotInput: Locator;
  // Typing indicator (three dots animation)
  readonly chatbotTypingIndicator: Locator;
  // Bot message bubbles
  readonly chatbotMessages: Locator;

  constructor(page: Page) {
    this.page = page;

    this.toolbar = page.locator('mat-toolbar.kte-shell__toolbar');
    this.brandLink = page.locator('a.kte-shell__brand');

    // The cart icon button has aria-label="Kosár" on the <a mat-icon-button>
    this.cartIconButton = page.getByRole('link', { name: 'Kosár' });
    // The MatBadge content is rendered in a <span class="mat-badge-content">
    this.cartBadge = page.locator('.mat-badge-content');

    this.loginButton = page.getByRole('link', { name: /bejelentkezés/i });
    this.userMenuButton = page.getByRole('button', { name: /felhasználói menü/i });
    this.hamburgerButton = page.getByRole('button', { name: 'Menü' });
    this.sidenav = page.locator('mat-sidenav.kte-shell__sidenav');

    // These only exist after opening the user menu
    this.userMenuProfileLink = page.getByRole('menuitem', { name: /profil/i });
    // Iteration 4: "Hűség" item added to user menu for authenticated users
    this.userMenuLoyaltyLink = page.getByRole('menuitem', { name: /hűség/i });
    this.logoutMenuButton = page.getByRole('menuitem', { name: /kijelentkezés/i });

    // Iteration 4: toolbar nav link — only visible when authenticated
    this.loyaltyNavLink = page.getByRole('link', { name: /hűség/i });

    // KTE-059 — Chatbot widget (Iteration 5)
    // The FAB is rendered by ChatbotWidgetComponent inside the app shell.
    this.chatbotFab = page.getByRole('button', { name: /kte ai asszisztens megnyitása/i });
    // The panel is mounted in a CDK global overlay. The outermost element of
    // ChatbotPanelComponent has role="dialog" and aria-label="KTE AI Asszisztens".
    this.chatbotPanel = page.getByRole('dialog', { name: /kte ai asszisztens/i });
    // Close button inside the panel header
    this.chatbotCloseButton = this.chatbotPanel.getByRole('button', { name: /bezárás/i });
    // Quick-suggestion chips shown in the empty state
    this.chatbotSuggestionChips = page.locator('.kte-chatbot-panel__chip');
    // Plain text input
    this.chatbotInput = page.locator('.kte-chatbot-panel__input');
    // Typing indicator (three animated dots)
    this.chatbotTypingIndicator = page.locator('.kte-chatbot-panel__typing');
    // Individual message components rendered by ChatbotMessageComponent
    this.chatbotMessages = page.locator('kte-chatbot-message');
  }

  /** Opens the user menu (authenticated only). */
  async openUserMenu(): Promise<void> {
    await this.userMenuButton.click();
  }

  /** Clicks Kijelentkezés in the open user menu. */
  async logout(): Promise<void> {
    await this.openUserMenu();
    await this.logoutMenuButton.click();
  }

  /** Returns the numeric badge count, or null if the badge is not visible. */
  async getCartCount(): Promise<number | null> {
    const badge = this.cartBadge;
    const visible = await badge.isVisible();
    if (!visible) {
      return null;
    }
    const text = (await badge.textContent()) ?? '';
    const parsed = parseInt(text.trim(), 10);
    return isNaN(parsed) ? null : parsed;
  }
}
