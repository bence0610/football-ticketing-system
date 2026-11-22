import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { provideStore } from '@ngrx/store';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { AppShellComponent } from './app-shell.component';
import { cartReducer } from '../../../state/cart/cart.reducer';
import { CART_FEATURE_KEY } from '../../../state/cart/cart.selectors';

describe('AppShellComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppShellComponent, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        provideAnimationsAsync(),
        provideStore({ [CART_FEATURE_KEY]: cartReducer }),
      ],
    }).compileComponents();
  });

  it('renders without crashing', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('exposes navigation items including home and admin', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    const items = (fixture.componentInstance as unknown as { navItems: () => readonly { route: string }[] })
      .navItems();
    const routes = items.map((item) => item.route);
    expect(routes).toContain('/');
    expect(routes).toContain('/admin');
    expect(routes).toContain('/stadium');
  });

  it('names the /stadium entry "Jegyvásárlás" in the menu and the route title', () => {
    const fixture = TestBed.createComponent(AppShellComponent);
    const items = (fixture.componentInstance as unknown as {
      navItems: () => readonly { route: string; label: string }[];
    }).navItems();
    expect(items.find((item) => item.route === '/stadium')?.label).toBe('Jegyvásárlás');
  });

  describe('the Admin link', () => {
    function navLabels(user: { role: string } | null): string[] {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [AppShellComponent, HttpClientTestingModule],
        providers: [
          provideRouter([]),
          provideAnimationsAsync(),
          provideStore({ [CART_FEATURE_KEY]: cartReducer }),
          {
            provide: AuthService,
            useValue: {
              user: signal(user),
              isAuthenticated: signal(user !== null),
              logout: () => of(undefined),
            },
          },
        ],
      });
      const fixture = TestBed.createComponent(AppShellComponent);
      fixture.detectChanges();
      return Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('a[href="/admin"]'),
      ).map((a) => a.textContent?.trim() ?? '');
    }

    it('is not shown to a signed-out visitor', () => {
      expect(navLabels(null)).toEqual([]);
    });

    for (const role of ['fan', 'gate']) {
      it(`is not shown to a signed-in ${role}`, () => {
        expect(navLabels({ role })).toEqual([]);
      });
    }

    for (const role of ['admin', 'super_admin']) {
      it(`is shown to a signed-in ${role}`, () => {
        expect(navLabels({ role }).length).toBeGreaterThan(0);
      });
    }
  });

  function render(url: string, user: { role: string; firstName?: string } | null = null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AppShellComponent, HttpClientTestingModule],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideAnimationsAsync(),
        provideStore({ [CART_FEATURE_KEY]: cartReducer }),
        {
          provide: AuthService,
          useValue: {
            user: signal(user),
            isAuthenticated: signal(user !== null),
            logout: () => of(undefined),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(AppShellComponent);
    (fixture.componentInstance as unknown as { currentUrl: { set(v: string): void } }).currentUrl.set(url);
    fixture.detectChanges();
    return fixture;
  }
  const renderEl = (url: string, user: { role: string; firstName?: string } | null = null) =>
    render(url, user).nativeElement as HTMLElement;

  describe('the chat launcher', () => {
    it('is mounted once at shell level, not in the toolbar, the page body or the footer', () => {
      const el = renderEl('/');
      const widget = el.querySelector('kte-chatbot-widget');
      expect(widget).not.toBeNull();
      expect(widget!.closest('.kte-shell__toolbar')).toBeNull();
      expect(widget!.closest('main')).toBeNull();
      expect(widget!.closest('footer')).toBeNull();
    });

    it('floats at the bottom-right corner', () => {
      const el = renderEl('/');
      const widget = el.querySelector('kte-chatbot-widget') as HTMLElement;
      const style = getComputedStyle(widget);
      expect(style.position).toBe('fixed');
      expect(style.right).not.toBe('auto');
      expect(style.bottom).not.toBe('auto');
    });

    it('is not shown to a gate user (the steward account has no chat)', () => {
      expect(renderEl('/', { role: 'gate' }).querySelector('kte-chatbot-widget')).toBeNull();
      expect(renderEl('/', { role: 'fan' }).querySelector('kte-chatbot-widget')).not.toBeNull();
    });

    it('is not shown on the payment step', () => {
      expect(renderEl('/checkout').querySelector('kte-chatbot-widget')).toBeNull();
    });

    it('the footer reserves the bubble\'s room as its bottom padding', () => {
      const el = renderEl('/');
      const footer = el.querySelector('footer') as HTMLElement;
      expect(footer).not.toBeNull();
      // calc(var(--chat-clearance)) is declared by the token sheet; the rule must reference it
      const rules = Array.from(document.styleSheets).flatMap((sheet) =>
        Array.from(sheet.cssRules).map((rule) => rule.cssText),
      );
      const footerRule = rules.find((text) => text.includes('kte-shell__footer') && text.includes('padding'));
      expect(footerRule).toContain('--chat-clearance');
    });
  });

  describe('the header', () => {
    it('is named "Jegyvásárlás", not "Stadion"', () => {
      const el = renderEl('/');
      const links = Array.from(el.querySelectorAll('nav a')).map((a) => a.textContent?.trim());
      expect(links).toContain('Jegyvásárlás');
      expect(links).not.toContain('Stadion');
      expect(el.querySelector('nav a[href="/stadium"]')?.textContent?.trim()).toBe('Jegyvásárlás');
    });

    it('shows the club crest, with alt text, instead of the text tile', () => {
      const el = renderEl('/');
      const img = el.querySelector('.kte-shell__brand img') as HTMLImageElement;
      expect(img).not.toBeNull();
      expect(img.getAttribute('src')).toBe('assets/kte-cimer.png');
      expect(img.alt).toBe('Kecskeméti TE címer');
      expect(el.querySelector('.kte-shell__brand-mark')).toBeNull();
    });

    it('falls back to the "KTE" tile when the crest cannot load', () => {
      const fixture = render('/');
      const el = fixture.nativeElement as HTMLElement;
      const img = el.querySelector('.kte-shell__brand img') as HTMLImageElement;
      img.dispatchEvent(new Event('error'));
      fixture.detectChanges();
      expect(el.querySelector('.kte-shell__brand img')).toBeNull();
      expect(el.querySelector('.kte-shell__brand-mark')?.textContent).toBe('KTE');
      expect(el.querySelector('.kte-shell__brand-text')?.textContent).toContain('Jegyportál');
    });

    it('puts the avatar and name last, after the cart', () => {
      const el = renderEl('/', { role: 'fan', firstName: 'Anna' });
      const bar = el.querySelector('.kte-shell__bar') as HTMLElement;
      // (the menu panel's host element is not visible; only real controls count)
      const order = Array.from(bar.children)
        .filter((c) => c.tagName !== 'MAT-MENU')
        .map((c) => c.className.toString());
      const cart = order.findIndex((c) => c.includes('kte-shell__cart'));
      const user = order.findIndex((c) => c.includes('kte-shell__user'));
      expect(cart).toBeGreaterThan(-1);
      expect(user).toBe(order.length - 1);
      expect(user).toBeGreaterThan(cart);
    });
  });

  describe('the full-screen pages', () => {
    for (const url of ['/login', '/register', '/forgot-password', '/reset-password/abc', '/confirm-email/abc']) {
      it(`${url} has no header or footer`, () => {
        const el = renderEl(url);
        expect(el.querySelector('mat-toolbar')).toBeNull();
        expect(el.querySelector('.kte-shell__nav')).toBeNull();
        expect(el.querySelector('footer')).toBeNull();
        expect(el.querySelector('router-outlet')).not.toBeNull();
      });
    }

    it('every other page keeps the header and footer', () => {
      for (const url of ['/', '/stadium', '/season-pass', '/cart', '/profile']) {
        const el = renderEl(url);
        expect(el.querySelector('mat-toolbar')).not.toBeNull();
        expect(el.querySelector('footer')).not.toBeNull();
      }
    });
  });
});
