import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngrx/store';
import { catchError, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { CartFacade } from '../../core/cart/cart.facade';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { CheckoutStepsComponent } from '../../shared/components/checkout-steps/checkout-steps.component';
import { MatchesApiService } from '../../shared/services/matches.api.service';
import { lockErrorMessage } from '../../shared/utils/lock-error';
import { MatchesActions, selectAllMatches, selectMatchesLoading } from '../../state/matches';
import { MatchPrices, MatchPricesService } from '../home/logic/match-prices.service';
import { upcomingHomeMatches } from '../home/logic/match-availability';
import { CartEmptyComponent, SectorHighlight } from './components/cart-empty.component';
import { CartExpiredCardComponent } from './components/cart-expired-card.component';
import { CartMatchCardComponent } from './components/cart-match-card.component';
import { CartDiscount, CartSummaryComponent } from './components/cart-summary.component';
import { discountAmount, groupByMatch, shortestHoldMs } from './logic/cart-logic';

@Component({
  selector: 'kte-cart-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    CheckoutStepsComponent,
    CartMatchCardComponent,
    CartExpiredCardComponent,
    CartSummaryComponent,
    CartEmptyComponent,
  ],
  template: `
    <kte-checkout-steps [current]="1"></kte-checkout-steps>

    <section class="cart kte-cart">
      <header class="cart__header">
        <h1>Kosár</h1>
        @if (count() > 0) {
          <span class="cart__count kte-cart__count">{{ count() }} jegy</span>
        }
      </header>

      <div class="cart__layout" [class.cart__layout--single]="count() === 0">
        <div class="cart__main">
          @for (group of groups(); track group.matchId) {
            <kte-cart-match-card
              [group]="group"
              [venue]="venues()[group.matchId] ?? null"
              (remove)="remove($event)"
            ></kte-cart-match-card>
          }

          @for (item of expired(); track item.seatId) {
            <kte-cart-expired-card
              [item]="item"
              [busy]="busy().has(item.seatId)"
              (relock)="relock($event)"
              (dismiss)="dismiss($event)"
            ></kte-cart-expired-card>
          }

          @if (count() === 0) {
            <kte-cart-empty
              [match]="nextMatch()"
              [sector]="highlight()"
              [loading]="matchesLoading()"
            ></kte-cart-empty>
          } @else {
            <a class="cart__back" [routerLink]="['/stadium']" [queryParams]="backParams()">
              <mat-icon aria-hidden="true">arrow_back</mat-icon>
              További helyek választása
            </a>
          }
        </div>

        @if (count() > 0) {
          <kte-cart-summary
            [count]="count()"
            [subtotal]="subtotal()"
            [discount]="discount()"
            [total]="total()"
            [shortestMs]="shortestMs()"
            [points]="points()"
            (checkout)="proceedToCheckout()"
          ></kte-cart-summary>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cart {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 32px 64px;
      }

      .cart__header {
        display: flex;
        align-items: baseline;
        gap: 16px;
        margin-bottom: 24px;
      }

      .cart__header h1 {
        margin: 0;
        font-size: 36px;
      }

      .cart__count {
        color: var(--muted);
      }

      .cart__layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 380px;
        gap: 32px;
        align-items: start;
      }

      .cart__layout--single {
        grid-template-columns: minmax(0, 1fr);
      }

      .cart__main {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }

      .cart__back {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: var(--min-target);
        font-weight: 500;
        text-decoration: none;
        color: var(--brand-deep);
      }

      .cart__back:hover {
        text-decoration: underline;
      }

      @media (max-width: 899px) {
        .cart__layout {
          grid-template-columns: minmax(0, 1fr);
          gap: 24px;
        }
      }

      @media (max-width: 599px) {
        .cart {
          padding: 24px 16px 48px;
        }
        .cart__header h1 {
          font-size: 30px;
        }
      }
    `,
  ],
})
export class CartPageComponent implements OnInit {
  private readonly cart = inject(CartFacade);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly store = inject(Store);
  private readonly loyaltyApi = inject(LoyaltyService);
  private readonly matchesApi = inject(MatchesApiService);
  private readonly prices = inject(MatchPricesService);

  // ---- cart ---------------------------------------------------------------
  protected readonly count = computed(() => this.cart.items().length);
  protected readonly groups = computed(() => groupByMatch(this.cart.items(), this.cart.lastTickMs()));
  protected readonly expired = this.cart.expired;
  protected readonly shortestMs = computed(() => shortestHoldMs(this.cart.items(), this.cart.lastTickMs()));
  protected readonly subtotal = computed(() => this.cart.total());
  protected readonly busy = signal<ReadonlySet<string>>(new Set());

  protected readonly backParams = computed(() => {
    const matchId = this.cart.items()[0]?.matchId ?? this.cart.expired()[0]?.matchId;
    return matchId ? { matchId } : {};
  });

  // ---- loyalty (signed-in users only) ---------------------------------------
  private readonly snapshot = toSignal(
    toObservable(this.auth.isAuthenticated).pipe(
      switchMap((signedIn) =>
        signedIn ? this.loyaltyApi.getSnapshot().pipe(catchError(() => of(null))) : of(null),
      ),
    ),
    { initialValue: null },
  );

  protected readonly discount = computed<CartDiscount | null>(() => {
    const s = this.snapshot();
    if (!s || s.tier.discountPercent <= 0) {
      return null;
    }
    return {
      tier: s.tier.tier,
      label: s.tier.label,
      percent: s.tier.discountPercent,
      amount: discountAmount(this.subtotal(), s.tier.discountPercent),
    };
  });

  protected readonly total = computed(() => this.subtotal() - (this.discount()?.amount ?? 0));

  /** Points per ticket come from the server (/loyalty/me); unknown for guests. */
  protected readonly points = computed(() => {
    const perTicket = this.snapshot()?.ticketPointsPerTicket;
    return perTicket === undefined ? null : perTicket * this.count();
  });

  // ---- venue of each match in the cart (GET /matches/:id) --------------------
  protected readonly venues = signal<Readonly<Record<string, string | undefined>>>({});
  private readonly requestedVenues = new Set<string>();

  // ---- empty state: next home match + a named sector ---------------------------
  protected readonly matchesLoading = toSignal(this.store.select(selectMatchesLoading), { initialValue: false });
  private readonly allMatches = toSignal(this.store.select(selectAllMatches), { initialValue: [] });
  protected readonly nextMatch = computed(() => upcomingHomeMatches(this.allMatches(), Date.now())[0] ?? null);

  private readonly nextMatchPrices = toSignal(
    toObservable(this.nextMatch).pipe(
      switchMap((m) => (m ? this.prices.forMatch(m.id) : of<MatchPrices | null>(null))),
    ),
    { initialValue: null },
  );

  /** Cheapest sector that still has free seats. */
  protected readonly highlight = computed<SectorHighlight | null>(() => {
    const sectors = this.nextMatchPrices()?.sectors ?? [];
    const open = sectors.find((s) => s.available > 0);
    return open
      ? {
          name: open.section === 'VIP' ? 'VIP' : `${open.section} szektor`,
          free: open.available,
          fromPrice: open.minPrice,
        }
      : null;
  });

  constructor() {
    effect(() => {
      const ids = this.groups().map((g) => g.matchId);
      untracked(() => {
        for (const id of ids) {
          if (this.requestedVenues.has(id)) {
            continue;
          }
          this.requestedVenues.add(id);
          this.matchesApi.detail(id).subscribe({
            next: (m) => this.venues.update((v) => ({ ...v, [id]: m.venue })),
            error: () => this.requestedVenues.delete(id),
          });
        }
      });
    });
  }

  ngOnInit(): void {
    this.store.dispatch(MatchesActions.loadMatches());
  }

  protected async remove(seatId: string): Promise<void> {
    await this.cart.remove(seatId);
  }

  protected dismiss(seatId: string): void {
    this.cart.dismissExpired(seatId);
  }

  /**
   * Re-books an expired seat through the same lock call the seat map uses, and
   * words a failure with the same message (a taken seat says so, exactly as on
   * the map).
   */
  protected async relock(seatId: string): Promise<void> {
    this.busy.update((s) => new Set(s).add(seatId));
    try {
      await this.cart.relock(seatId);
      this.snackBar.open('A szék hozzáadva a kosárhoz.', 'Bezárás', { duration: 4000 });
    } catch (error) {
      this.snackBar.open(lockErrorMessage(error), 'Bezárás', { duration: 5000 });
    } finally {
      this.busy.update((s) => {
        const next = new Set(s);
        next.delete(seatId);
        return next;
      });
    }
  }

  protected async proceedToCheckout(): Promise<void> {
    const validItems = await this.cart.assertValidForCheckout();
    if (validItems.length === 0) {
      this.snackBar.open(
        'A foglalt székek lejártak. Válassz újra a stadiontérképen.',
        'Bezárás',
        { duration: 6000 },
      );
      return;
    }

    if (!this.auth.isAuthenticated()) {
      // KTE-024: guest must log in before checkout, but cart is preserved.
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl: '/checkout' },
      });
      return;
    }

    void this.router.navigate(['/checkout']);
  }
}
