import { Injectable, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, take } from 'rxjs/operators';
import { lockExpiryFromTtl } from '../../shared/utils/hold-duration';
import { CartItem, MAX_CART_ITEMS } from '../../shared/models/cart.model';
import { SeatStatus } from '../../shared/models/seat.model';
import { SeatsApiService } from '../../shared/services/seats.api.service';
import { CartActions } from '../../state/cart/cart.actions';
import {
  selectCartCount,
  selectCartIsEmpty,
  selectCartItems,
  selectCartMatchId,
  selectCartTotal,
  selectLastTickMs,
} from '../../state/cart/cart.selectors';

const STORAGE_KEY = 'kte_cart_v1';

interface PersistedCart {
  readonly version: 1;
  readonly matchId: string | null;
  readonly items: readonly CartItem[];
}

interface MatchContext {
  readonly matchId: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly kickoffAt: string;
}

/**
 * Application-facing cart API that hides the NgRx store from feature
 * components and owns the sessionStorage hydration / persistence.
 *
 * Add / remove operations are async because they call the seat-lock API
 * (POST/DELETE) — keeping the store consistent with the Redis lock state.
 */
@Injectable({ providedIn: 'root' })
export class CartFacade {
  private readonly store = inject(Store);
  private readonly seatsApi = inject(SeatsApiService);

  readonly items = toSignal(this.store.select(selectCartItems), { initialValue: [] });
  readonly matchId = toSignal(this.store.select(selectCartMatchId), { initialValue: null });
  readonly count = toSignal(this.store.select(selectCartCount), { initialValue: 0 });
  readonly isEmpty = toSignal(this.store.select(selectCartIsEmpty), { initialValue: true });
  readonly total = toSignal(this.store.select(selectCartTotal), { initialValue: 0 });
  readonly lastTickMs = toSignal(this.store.select(selectLastTickMs), { initialValue: Date.now() });

  constructor() {
    this.hydrate();
    // Persist on every state change.
    effect(() => {
      const items = this.items();
      const matchId = this.matchId();
      this.persist({ version: 1, items, matchId });
    });
  }

  isFull(): boolean {
    return this.items().length >= MAX_CART_ITEMS;
  }

  has(seatId: string): boolean {
    return this.items().some((item) => item.seatId === seatId);
  }

  /**
   * Locks the seat in Redis and adds it to the cart on success.
   * Returns the locked CartItem, or throws an Error with a localized message.
   */
  async add(seat: SeatStatus, match: MatchContext): Promise<CartItem> {
    if (this.isFull()) {
      throw new Error(`Egy kosárba legfeljebb ${MAX_CART_ITEMS} jegy vehető fel.`);
    }
    if (this.has(seat.id)) {
      throw new Error('Ez a szék már a kosaradban van.');
    }

    const lock = await firstValueFrom(this.seatsApi.lockSeat(match.matchId, seat.id));
    const item: CartItem = {
      seatId: seat.id,
      matchId: match.matchId,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt,
      section: seat.section,
      row: seat.row,
      seatNumber: seat.number,
      category: seat.category,
      price: seat.price,
      ownerToken: lock.ownerToken,
      lockExpiresAtMs: lockExpiryFromTtl(lock.ttlSeconds),
      lockTtlSeconds: lock.ttlSeconds,
      addedAtMs: Date.now(),
    };
    this.store.dispatch(CartActions.addItem({ item }));
    return item;
  }

  /**
   * Releases the Redis lock (best-effort) and removes the item from the cart.
   */
  async remove(seatId: string): Promise<void> {
    const item = this.items().find((i) => i.seatId === seatId);
    if (!item) {
      return;
    }
    this.store.dispatch(CartActions.removeItem({ seatId }));
    await firstValueFrom(
      this.seatsApi.unlockSeat(item.matchId, item.seatId, item.ownerToken).pipe(
        catchError(() => of(void 0)),
      ),
    );
  }

  async clear(): Promise<void> {
    const itemsToRelease = [...this.items()];
    this.store.dispatch(CartActions.clearCart());
    await Promise.all(
      itemsToRelease.map((item) =>
        firstValueFrom(
          this.seatsApi.unlockSeat(item.matchId, item.seatId, item.ownerToken).pipe(
            catchError(() => of(void 0)),
          ),
        ),
      ),
    );
  }

  /** Used after a successful checkout — clears local state without API calls. */
  clearLocalOnly(): void {
    this.store.dispatch(CartActions.clearCart());
  }

  /** Updates the lock expiry/token after a payment-failed retry extension. */
  applyLockExtension(seatId: string, ownerToken: string, lockExpiresAtMs: number): void {
    this.store.dispatch(
      CartActions.replaceItemLock({ seatId, ownerToken, lockExpiresAtMs }),
    );
  }

  watchItems(): Observable<readonly CartItem[]> {
    return this.store.select(selectCartItems);
  }

  watchTotal(): Observable<number> {
    return this.store.select(selectCartTotal);
  }

  /**
   * Snapshot used by the auth-aware `proceedToCheckout` flow — drops items
   * that have already expired before redirecting.
   */
  async assertValidForCheckout(): Promise<readonly CartItem[]> {
    const items = await firstValueFrom(this.store.select(selectCartItems).pipe(take(1)));
    const now = Date.now();
    const fresh = items.filter((item) => item.lockExpiresAtMs > now);
    if (fresh.length !== items.length) {
      const expiredIds = items.filter((item) => item.lockExpiresAtMs <= now).map((i) => i.seatId);
      this.store.dispatch(CartActions.expireItems({ seatIds: expiredIds }));
    }
    return fresh;
  }

  private hydrate(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as PersistedCart;
      if (!parsed || parsed.version !== 1) {
        return;
      }
      const now = Date.now();
      const live = parsed.items.filter((item) => item.lockExpiresAtMs > now);
      this.store.dispatch(
        CartActions.hydrateFromStorage({ items: live, matchId: parsed.matchId }),
      );
    } catch {
      // ignore malformed payload
    }
  }

  private persist(snapshot: PersistedCart): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // sessionStorage may be disabled — silent fallback
    }
  }
}
