/**
 * The one definition of what a seat costs for a match: the match's base price
 * scaled by the seat's price modifier, rounded to whole forints. Used by the
 * seat map, the checkout/payment flow and (through the seat map's sector
 * summary) the chatbot, so they cannot disagree.
 */
export function seatUnitPrice(basePrice: number, priceModifier: string | number): number {
  return Math.round(basePrice * Number(priceModifier));
}
