import { createFeatureSelector, createSelector } from '@ngrx/store';
import { CartState } from './cart.reducer';

export const CART_FEATURE_KEY = 'cart';

const selectCartFeature = createFeatureSelector<CartState>(CART_FEATURE_KEY);

export const selectCartItems = createSelector(selectCartFeature, (state) => state.items);
export const selectCartExpired = createSelector(selectCartFeature, (state) => state.expired);
export const selectCartMatchId = createSelector(selectCartFeature, (state) => state.matchId);
export const selectCartCount = createSelector(selectCartItems, (items) => items.length);
export const selectCartIsEmpty = createSelector(selectCartItems, (items) => items.length === 0);
export const selectCartTotal = createSelector(selectCartItems, (items) =>
  items.reduce((sum, item) => sum + item.price, 0),
);
export const selectLastTickMs = createSelector(selectCartFeature, (state) => state.lastTickMs);
