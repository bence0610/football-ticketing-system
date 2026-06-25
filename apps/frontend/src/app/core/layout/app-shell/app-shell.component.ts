import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { CommonModule } from '@angular/common';
import { filter } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { CartFacade } from '../../cart/cart.facade';
import { ChatbotWidgetComponent } from '../../../features/chatbot/chatbot-widget.component';

interface NavItem {
  readonly label: string;
  readonly route: string;
  readonly icon: string;
  readonly exact?: boolean;
  readonly authOnly?: boolean;
}

const HIDDEN_CHATBOT_ROUTES: readonly string[] = ['/checkout'];

@Component({
  selector: 'kte-app-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatMenuModule,
    MatSidenavModule,
    MatListModule,
    ChatbotWidgetComponent,
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
})
export class AppShellComponent {
  private readonly auth = inject(AuthService);
  private readonly cart = inject(CartFacade);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly isAuthenticated = this.auth.isAuthenticated;
  protected readonly cartCount = this.cart.count;

  protected readonly navItems = signal<readonly NavItem[]>([
    { label: 'Kezdőlap', route: '/', icon: 'home', exact: true },
    { label: 'Stadion', route: '/stadium', icon: 'stadium' },
    { label: 'Bérlet vásárlás', route: '/season-pass', icon: 'card_membership' },
    { label: 'Kosár', route: '/cart', icon: 'shopping_cart' },
    { label: 'Hűség', route: '/loyalty', icon: 'star', authOnly: true },
    { label: 'Admin', route: '/admin', icon: 'shield', authOnly: true },
  ]);

  protected readonly visibleNavItems = computed(() =>
    this.navItems().filter((item) => !item.authOnly || this.isAuthenticated()),
  );

  protected readonly sidenavOpen = signal(false);
  protected readonly year = new Date().getFullYear();

  // The chatbot widget is hidden on the checkout flow so it can't cover
  // the Stripe payment element on small screens. This signal flips on
  // every navigation event.
  protected readonly currentUrl = signal<string>(this.router.url);
  protected readonly showChatbot = computed(() => {
    const url = this.currentUrl();
    return !HIDDEN_CHATBOT_ROUTES.some((prefix) => url.startsWith(prefix));
  });

  constructor() {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.currentUrl.set(event.urlAfterRedirects));
  }

  protected toggleSidenav(): void {
    this.sidenavOpen.update((value) => !value);
  }

  protected closeSidenav(): void {
    this.sidenavOpen.set(false);
  }

  protected logout(): void {
    this.auth.logout().subscribe();
  }

  protected userInitials(): string {
    const user = this.user();
    if (!user) {
      return '';
    }
    return `${(user.lastName[0] ?? '').toUpperCase()}${(user.firstName[0] ?? '').toUpperCase()}`;
  }
}
