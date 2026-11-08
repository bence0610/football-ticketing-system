import { CartItem } from '../../shared/models/cart.model';
import { CartActions } from './cart.actions';
import { cartReducer, initialCartState } from './cart.reducer';

function item(over: Partial<CartItem> = {}): CartItem {
  return {
    seatId: 's1',
    matchId: 'm1',
    homeTeam: 'Kecskeméti TE',
    awayTeam: 'Újpest FC',
    kickoffAt: '2026-11-09T19:00:00.000Z',
    section: 'A',
    row: '1',
    seatNumber: 5,
    category: 'standard',
    price: 3500,
    ownerToken: 't',
    lockExpiresAtMs: 5000,
    addedAtMs: 0,
    ...over,
  };
}

describe('cart reducer - expired holds', () => {
  const two = cartReducer(
    cartReducer(initialCartState, CartActions.addItem({ item: item({ seatId: 'a' }) })),
    CartActions.addItem({ item: item({ seatId: 'b' }) }),
  );

  it('keeps an expired hold instead of dropping it', () => {
    const state = cartReducer(two, CartActions.expireItems({ seatIds: ['a'] }));
    expect(state.items.map((i) => i.seatId)).toEqual(['b']);
    expect(state.expired.map((i) => i.seatId)).toEqual(['a']);
  });

  it('only the seat that ran out drops; the rest stay', () => {
    const state = cartReducer(two, CartActions.expireItems({ seatIds: ['b'] }));
    expect(state.items.map((i) => i.seatId)).toEqual(['a']);
    expect(state.matchId).toBe('m1');
  });

  it('forgets the match when the last live seat expires, but keeps the expired card', () => {
    const state = cartReducer(two, CartActions.expireItems({ seatIds: ['a', 'b'] }));
    expect(state.items).toEqual([]);
    expect(state.matchId).toBeNull();
    expect(state.expired.length).toBe(2);
  });

  it('discarding removes only that expired card', () => {
    const lapsed = cartReducer(two, CartActions.expireItems({ seatIds: ['a', 'b'] }));
    const state = cartReducer(lapsed, CartActions.dismissExpired({ seatId: 'a' }));
    expect(state.expired.map((i) => i.seatId)).toEqual(['b']);
  });

  it('re-booking a seat replaces its expired card', () => {
    const lapsed = cartReducer(two, CartActions.expireItems({ seatIds: ['a'] }));
    const state = cartReducer(lapsed, CartActions.addItem({ item: item({ seatId: 'a', lockExpiresAtMs: 99_000 }) }));
    expect(state.expired).toEqual([]);
    expect(state.items.map((i) => i.seatId).sort()).toEqual(['a', 'b']);
  });

  it('switching to another match resets the cart, expired cards included', () => {
    const lapsed = cartReducer(two, CartActions.expireItems({ seatIds: ['a'] }));
    const state = cartReducer(lapsed, CartActions.addItem({ item: item({ seatId: 'z', matchId: 'm2' }) }));
    expect(state.expired).toEqual([]);
    expect(state.matchId).toBe('m2');
  });

  it('hydrates the expired list from storage', () => {
    const state = cartReducer(
      initialCartState,
      CartActions.hydrateFromStorage({ items: [], matchId: null, expired: [item({ seatId: 'x' })] }),
    );
    expect(state.expired.map((i) => i.seatId)).toEqual(['x']);
  });
});
