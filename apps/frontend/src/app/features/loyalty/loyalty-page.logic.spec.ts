import { LoyaltySnapshotResponse, LoyaltyTransactionResponse } from '../../core/models/loyalty.models';
import { checkoutExample, earningRules, ledgerRow, tierKeptText } from './loyalty-page.logic';

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
    attendancePoints: 50,
    seasonPassPoints: 500,
    passLoanPoints: 25,
    carryoverPercent: 70,
  };

  it('has a Részvétel row, once per match with a ticket or a pass, and no row for buying a ticket', () => {
    const rows = earningRules(rules);
    expect(rows.some((r) => r.label === 'Jegyvásárlás')).toBe(false);
    expect(rows.some((r) => r.label === 'Belépés bérlettel')).toBe(false);
    const attendance = rows.find((r) => r.label === 'Részvétel');
    expect(attendance?.amount).toBe('+50 pont');
    expect(attendance?.detail).toContain('meccsenként egyszer, jeggyel vagy bérlettel');
    expect(attendance?.detail).toContain('jegyvásárlásért nem jár pont');
    expect(JSON.stringify(rows)).not.toMatch(/100 Ft|Ft =/);
  });

  it('follows the configuration', () => {
    const attendance = earningRules({ ...rules, attendancePoints: 80 }).find((r) => r.label === 'Részvétel');
    expect(attendance?.amount).toBe('+80 pont');
  });
});

describe('tierKeptText', () => {
  const snapshot = (over: Partial<LoyaltySnapshotResponse>): LoyaltySnapshotResponse =>
    ({
      points: 2165,
      tier: { tier: 'platinum', label: 'KTE Legenda', minPoints: 2500, discountPercent: 15, color: '#C94B1E' },
      recentTransactions: [],
      ...over,
    }) as LoyaltySnapshotResponse;

  it('says until when a tier is kept without the points to match it', () => {
    const text = tierKeptText(snapshot({ tierKeptUntil: '2028-06-30', pointsToKeepTier: 835 }));
    expect(text).toContain('KTE Legenda');
    expect(text).toContain('2028');
    expect(text).toContain('június 30');
    expect(text).toContain('835');
  });

  it('says nothing while the points hold the tier', () => {
    expect(tierKeptText(snapshot({}))).toBeNull();
  });
});

describe('ledgerRow', () => {
  const tx: LoyaltyTransactionResponse = {
    id: 't1',
    type: 'earn',
    source: 'attendance',
    points: 50,
    balanceAfter: 650,
    description: 'Részvétel',
    referenceId: 'match:de300000-1111:de300000-2222',
    match: {
      id: 'de300000-1111',
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Diósgyőri VTK',
      kickoffAt: '2026-11-28T14:00:00.000Z',
    },
    createdAt: '2026-11-28T13:30:00.000Z',
  };

  it('shows the event in plain Hungarian with its match, signed points and the running balance', () => {
    const row = ledgerRow(tx);
    expect(row.event).toBe('Részvétel');
    expect(row.match).toBe('Kecskeméti TE – Diósgyőri VTK, nov. 28.');
    expect(row.pointsText).toBe('+50');
    expect(row.balance).toBe(650);
  });

  it('never carries the internal source or reference', () => {
    const row = ledgerRow(tx) as unknown as Record<string, unknown>;
    expect(row['source']).toBeUndefined();
    expect(row['reference']).toBeUndefined();
    expect(JSON.stringify(row)).not.toMatch(/attendance|ticket_purchase|match:|ticket:|de300000/);
  });

  it('labels old ticket-purchase rows in words, with the match when it is known', () => {
    const row = ledgerRow({ ...tx, source: 'ticket_purchase', description: 'Jegyvásárlás bónusz', referenceId: 'ticket:abc' });
    expect(row.event).toBe('Jegyvásárlás (régi pontozás)');
    expect(JSON.stringify(row)).not.toContain('ticket_purchase');
    expect(row.match).toContain('Diósgyőri VTK');
  });

  it('shows a minus sign for deductions and uses the description of the conversion', () => {
    const row = ledgerRow({
      ...tx,
      points: -300,
      description: 'Szezonzáró pontkonverzió (70% megtartva)',
      referenceId: undefined,
      source: 'season_carryover',
      match: undefined,
    });
    expect(row.pointsText).toBe('−300');
    expect(row.event).toBe('Szezonzáró pontkonverzió (70% megtartva)');
    expect(row.match).toBeNull();
  });

  it('falls back to the plain label when a source has no description', () => {
    expect(ledgerRow({ ...tx, source: 'season_carryover', description: undefined, match: undefined }).event).toBe(
      'Szezonzáró pontkonverzió',
    );
  });
});
