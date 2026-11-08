import { createReducer, on } from '@ngrx/store';
import { CartItem, MAX_CART_ITEMS } from '../../shared/models/cart.model';
import { CartActions } from './cart.actions';

export interface CartState {
  readonly matchId: string | null;
  readonly items: readonly CartItem[];
  /**
   * Holds that ran out. They are kept (not dropped) so the cart can tell the
   * user which seat expired and let them re-book or discard it.
   */
  readonly expired: readonly CartItem[];
  readonly lastTickMs: number;
}

export const initialCartState: CartState = {
  matchId: null,
  items: [],
  expired: [],
  lastTickMs: 0,
};

export const cartReducer = createReducer(
  initialCartState,
  on(CartActions.hydrateFromStorage, (_state, { items, matchId, expired }) => ({
    matchId,
    items,
    expired: expired ?? [],
    lastTickMs: Date.now(),
  })),
  on(CartActions.addItem, (state, { item }) => {
    if (state.items.length >= MAX_CART_ITEMS) {
      return state;
    }
    if (state.items.some((existing) => existing.seatId === item.seatId)) {
      return state;
    }
    if (state.matchId !== null && state.matchId !== item.matchId) {
      // Switching matches resets the cart so we never mix tickets.
      return { ...state, matchId: item.matchId, items: [item], expired: [] };
    }
    return {
      ...state,
      matchId: item.matchId,
      items: [...state.items, item],
      // Re-booking an expired seat replaces its expired card.
      expired: state.expired.filter((e) => e.seatId !== item.seatId),
    };
  }),
  on(CartActions.removeItem, (state, { seatId }) => {
    const items = state.items.filter((item) => item.seatId !== seatId);
    return {
      ...state,
      items,
      matchId: items.length === 0 ? null : state.matchId,
    };
  }),
  on(CartActions.clearCart, () => ({ ...initialCartState, lastTickMs: Date.now() })),
  on(CartActions.expireItems, (state, { seatIds }) => {
    const remaining = state.items.filter((item) => !seatIds.includes(item.seatId));
    const lapsed = state.items.filter((item) => seatIds.includes(item.seatId));
    return {
      ...state,
      items: remaining,
      expired: [
        ...state.expired.filter((e) => !seatIds.includes(e.seatId)),
        ...lapsed,
      ],
      matchId: remaining.length === 0 ? null : state.matchId,
    };
  }),
  on(CartActions.dismissExpired, (state, { seatId }) => ({
    ...state,
    expired: state.expired.filter((e) => e.seatId !== seatId),
  })),
  on(CartActions.tick, (state, { now }) => ({ ...state, lastTickMs: now })),
  on(CartActions.replaceItemLock, (state, { seatId, ownerToken, lockExpiresAtMs }) => ({
    ...state,
    items: state.items.map((item) =>
      item.seatId === seatId ? { ...item, ownerToken, lockExpiresAtMs } : item,
    ),
  })),
);

export function getExpiredSeatIds(items: readonly CartItem[], now: number): readonly string[] {
  return items.filter((item) => item.lockExpiresAtMs <= now).map((item) => item.seatId);
}
