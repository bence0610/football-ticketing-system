import { CartItem } from '../../../shared/models/cart.model';
import {
  URGENT_BELOW_MS,
  discountAmount,
  groupByMatch,
  limitedDiscountAmount,
  seatDescription,
  shortestHoldMs,
  ticketTypeLabel,
} from './cart-logic';

const NOW = 1_000_000;

function item(over: Partial<CartItem>): CartItem {
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
    lockExpiresAtMs: NOW + 120_000,
    addedAtMs: NOW - 1000,
    ...over,
  };
}

describe('groupByMatch', () => {
  it('makes one group per match, keeping the order seats were added', () => {
    const groups = groupByMatch(
      [item({ seatId: 'a', matchId: 'm1' }), item({ seatId: 'b', matchId: 'm2' }), item({ seatId: 'c', matchId: 'm1' })],
      NOW,
    );
    expect(groups.map((g) => g.matchId)).toEqual(['m1', 'm2']);
    expect(groups[0].items.map((i) => i.seatId)).toEqual(['a', 'c']);
  });

  it("uses the shortest hold of the match's seats", () => {
    const [g] = groupByMatch(
      [item({ seatId: 'a', lockExpiresAtMs: NOW + 200_000 }), item({ seatId: 'b', lockExpiresAtMs: NOW + 45_000 })],
      NOW,
    );
    expect(g.remainingMs).toBe(45_000);
  });

  it('turns urgent only strictly under one minute', () => {
    const at = (ms: number) => groupByMatch([item({ lockExpiresAtMs: NOW + ms })], NOW)[0].urgent;
    expect(at(URGENT_BELOW_MS - 1)).toBeTrue();
    expect(at(URGENT_BELOW_MS)).toBeFalse();
    expect(at(120_000)).toBeFalse();
  });

  it('never reports a negative time', () => {
    expect(groupByMatch([item({ lockExpiresAtMs: NOW - 5000 })], NOW)[0].remainingMs).toBe(0);
  });
});

describe('shortestHoldMs', () => {
  it('is null for an empty cart and the minimum otherwise', () => {
    expect(shortestHoldMs([], NOW)).toBeNull();
    expect(
      shortestHoldMs([item({ lockExpiresAtMs: NOW + 90_000 }), item({ seatId: 'b', lockExpiresAtMs: NOW + 30_000 })], NOW),
    ).toBe(30_000);
  });
});

describe('labels', () => {
  it('describes the seat in full', () => {
    expect(seatDescription(item({}))).toBe('A szektor · 1. sor · 5. szék');
    expect(seatDescription(item({ section: 'VIP', row: '2', seatNumber: 3 }))).toBe('VIP · 2. sor · 3. szék');
  });
  it('uses the sector display name from the server when the item carries it', () => {
    expect(seatDescription(item({ section: 'D/1', sectorName: 'D/1 szektor' }))).toBe(
      'D/1 szektor · 1. sor · 5. szék',
    );
    // an older cart item has only the code: the fallback gives the same name for every real sector
    expect(seatDescription(item({ section: 'C/2' }))).toBe('C/2 szektor · 1. sor · 5. szék');
  });
  it('names the ticket type from the seat category', () => {
    expect(ticketTypeLabel('standard')).toBe('Normál jegy');
    expect(ticketTypeLabel('vip')).toBe('VIP jegy');
  });
});

describe('discountAmount', () => {
  it('rounds to whole forints like checkout does', () => {
    expect(discountAmount(10_500, 10)).toBe(1050);
    expect(discountAmount(3_500, 5)).toBe(175);
    expect(discountAmount(3_333, 5)).toBe(167);
    expect(discountAmount(5_000, 0)).toBe(0);
  });
});

describe('limitedDiscountAmount: the discount reaches the first N tickets of each match', () => {
  it('takes 15% off the first 2 of 4 tickets for one match', () => {
    const items = [1, 2, 3, 4].map((n) => item({ seatId: `s${n}`, price: 3333 }));
    expect(limitedDiscountAmount(items, 15, 2)).toBe(discountAmount(2 * 3333, 15));
  });

  it('counts each match separately', () => {
    const items = [
      item({ seatId: 'a', matchId: 'm1', price: 3000 }),
      item({ seatId: 'b', matchId: 'm1', price: 3000 }),
      item({ seatId: 'c', matchId: 'm1', price: 3000 }),
      item({ seatId: 'd', matchId: 'm2', price: 4000 }),
    ];
    expect(limitedDiscountAmount(items, 10, 2)).toBe(600 + 400);
  });

  it('applies to every ticket when there is no limit (an older server)', () => {
    const items = [1, 2, 3].map((n) => item({ seatId: `s${n}`, price: 1000 }));
    expect(limitedDiscountAmount(items, 10, null)).toBe(300);
  });

  it('gives nothing for a limit of 0', () => {
    expect(limitedDiscountAmount([item({ price: 1000 })], 10, 0)).toBe(0);
  });
});
