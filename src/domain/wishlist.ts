// src/domain/wishlist.ts
//
// The Wish List is one-time things the user wants to buy, in the user's order.
// It never reaches the forecast, the runway or the top bar, so
// all that is left here is its running total.
import type { WishlistItem } from "./plan-types";

/**
 * Running total of the whole Wish List, shown on the Goals tab as "Personal
 * Wish List" and under the Wish List table.
 */
export function wishlistTotal(items: WishlistItem[]): { totalCents: number; count: number } {
  return {
    totalCents: items.reduce((sum, i) => sum + i.costCents, 0),
    count: items.length,
  };
}
