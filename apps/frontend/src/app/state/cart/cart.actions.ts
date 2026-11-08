import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { CartItem } from '../../shared/models/cart.model';

export const CartActions = createActionGroup({
  source: 'Cart',
  events: {
    'Hydrate From Storage': props<{
      items: readonly CartItem[];
      matchId: string | null;
      expired?: readonly CartItem[];
    }>(),

    'Add Item': props<{ item: CartItem }>(),
    'Remove Item': props<{ seatId: string }>(),
    'Clear Cart': emptyProps(),
    'Expire Items': props<{ seatIds: readonly string[] }>(),
    /** The user discarded an expired-hold card. */
    'Dismiss Expired': props<{ seatId: string }>(),
    'Tick': props<{ now: number }>(),

    'Replace Item Lock': props<{ seatId: string; ownerToken: string; lockExpiresAtMs: number }>(),
  },
});
