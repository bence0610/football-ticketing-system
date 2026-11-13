import { LoyaltyTransactionResponse } from '../../core/models/loyalty.models';
import { checkoutExample, earningRules, ledgerRow } from './loyalty-page.logic';

describe('checkoutExample', () => {
  it('takes the tier percent off the price, rounded like the cart', () => {
    expect(checkoutExample(3500, 10)).toEqual({ price: 3500, percent: 10, discount: 350, pay: 3150 });
    expect(checkoutExample(2990, 5)).toEqual({ price: 2990, percent: 5, discount: 150, pay: 2840 });
  });

  it('charges the full price at 0%', () => {
    expect(checkoutExample(3500, 0)).toEqual({ price: 3500, percent: 0, discount: 0, pay: 3500 });
  });
});

describe('earningRules', () => {
  const rules = {
    registrationPoints: 100,
    profileCompletionPoints: 50,
    ticketPointsPerTicket: 50,
    seasonPassPoints: 500,
    passLoanPoints: 25,
    carryoverPercent: 50,
  };

  it('states the purchase rule as a flat amount per ticket, never a rate per forint', () => {
    const ticket = earningRules(rules).find((r) => r.label === 'Jegyvásárlás');
    expect(ticket?.amount).toBe('+50 pont');
    expect(ticket?.detail).toContain('jegyenként');
    expect(ticket?.detail).toContain('kedvezménye sem csökkenti');
    expect(JSON.stringify(earningRules(rules))).not.toMatch(/100 Ft|Ft =/);
  });

  it('follows the configuration', () => {
    const ticket = earningRules({ ...rules, ticketPointsPerTicket: 80 }).find((r) => r.label === 'Jegyvásárlás');
    expect(ticket?.amount).toBe('+80 pont');
  });
});

describe('ledgerRow', () => {
  const tx: LoyaltyTransactionResponse = {
    id: 't1',
    type: 'earn',
    source: 'ticket_purchase',
    points: 50,
    balanceAfter: 650,
    description: 'Jegyvásárlás bónusz',
    referenceId: 'ticket:abc',
    createdAt: '2026-11-01T10:00:00.000Z',
  };

  it('carries event, source, reference, signed points and running balance', () => {
    const row = ledgerRow(tx);
    expect(row.event).toBe('Jegyvásárlás bónusz');
    expect(row.source).toBe('ticket_purchase');
    expect(row.reference).toBe('ticket:abc');
    expect(row.pointsText).toBe('+50');
    expect(row.balance).toBe(650);
  });

  it('shows a minus sign for deductions and falls back to the source label', () => {
    const row = ledgerRow({ ...tx, points: -300, description: undefined, referenceId: undefined, source: 'season_carryover' });
    expect(row.pointsText).toBe('−300');
    expect(row.event).toBe('Szezonzáró pontkonverzió');
    expect(row.reference).toBeNull();
  });
});
