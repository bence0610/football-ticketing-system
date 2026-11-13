import type Stripe from 'stripe';
import type { SeasonPassPrice } from '../../database/entities';
import { SeasonPassesService } from './season-passes.service';

/**
 * The pass records what the PaymentIntent was created with, not whatever the
 * price row says by the time the payment is finalized.
 */
describe('SeasonPassesService – amount recorded for a pass', () => {
  const warn = jest.fn();
  type Amount = (intent: Stripe.PaymentIntent, row: SeasonPassPrice) => number;
  const amountChargedHuf: Amount = (intent, row) =>
    (
      SeasonPassesService.prototype as unknown as { amountChargedHuf: Amount }
    ).amountChargedHuf.call({ logger: { warn } }, intent, row);

  const intent = (amount: unknown): Stripe.PaymentIntent =>
    ({ id: 'pi_pass', amount }) as unknown as Stripe.PaymentIntent;
  const row = (price: number): SeasonPassPrice => ({ price }) as unknown as SeasonPassPrice;

  beforeEach(() => warn.mockClear());

  it('uses the charged amount even if the price row changed afterwards', () => {
    // Charged 30 000 Ft (3 000 000 fillér); an admin raised the row to 45 000 Ft.
    expect(amountChargedHuf(intent(3_000_000), row(45_000))).toBe(30_000);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([undefined, 0, -100, 12_345, 1.5, Number.NaN])(
    'falls back to the price row, with a warning, for an unusable amount (%p)',
    (amount) => {
      expect(amountChargedHuf(intent(amount), row(30_000))).toBe(30_000);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );
});
