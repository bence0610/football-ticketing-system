import { MatchListItem } from '../../../shared/models/match.model';
import { LoyaltySnapshotResponse } from '../../../core/models/loyalty.models';
import { availabilityOf, LOW_AVAILABILITY_RATIO, upcomingHomeMatches } from './match-availability';
import { countdownParts } from './countdown-parts';
import { loyaltyProgress } from './loyalty-progress';

function match(over: Partial<MatchListItem>): MatchListItem {
  return {
    id: 'm',
    homeTeam: 'Kecskeméti TE',
    awayTeam: 'X',
    competition: 'NB1',
    venue: 'V',
    kickoffAt: '2026-11-09T19:00:00.000Z',
    status: 'on_sale',
    basePrice: 3000,
    capacity: 500,
    availableSeats: 500,
    isHome: true,
    isSeasonPassEligible: true,
    ...over,
  };
}

describe('availabilityOf', () => {
  it('is "Kapható" with plenty of seats', () => {
    expect(availabilityOf(match({})).label).toBe('Kapható');
  });

  it('is "Kevés hely" at or under the threshold share of capacity', () => {
    const edge = Math.floor(500 * LOW_AVAILABILITY_RATIO);
    expect(availabilityOf(match({ availableSeats: edge })).label).toBe('Kevés hely');
    expect(availabilityOf(match({ availableSeats: edge + 1 })).label).toBe('Kapható');
  });

  it('is "Telt ház" for sold_out status or zero free seats', () => {
    expect(availabilityOf(match({ status: 'sold_out' })).label).toBe('Telt ház');
    expect(availabilityOf(match({ availableSeats: 0 })).label).toBe('Telt ház');
  });

  it('maps onto the status-chip colours', () => {
    expect(availabilityOf(match({})).chipClass).toBe('paid');
    expect(availabilityOf(match({ availableSeats: 10 })).chipClass).toBe('pending');
    expect(availabilityOf(match({ status: 'sold_out' })).chipClass).toBe('expired');
  });
});

describe('upcomingHomeMatches', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');

  it('keeps future home matches, soonest first, including sold-out ones', () => {
    const list = upcomingHomeMatches(
      [
        match({ id: 'late', kickoffAt: '2026-11-24T19:00:00Z' }),
        match({ id: 'past', kickoffAt: '2026-05-10T15:00:00Z', status: 'finished' }),
        match({ id: 'away', isHome: false }),
        match({ id: 'soldout', kickoffAt: '2026-11-15T19:00:00Z', status: 'sold_out' }),
        match({ id: 'next', kickoffAt: '2026-11-09T19:00:00Z' }),
      ],
      now,
    );
    expect(list.map((m) => m.id)).toEqual(['next', 'soldout', 'late']);
  });

  it('is empty when nothing is upcoming', () => {
    expect(upcomingHomeMatches([match({ kickoffAt: '2026-05-10T15:00:00Z' })], now)).toEqual([]);
  });
});

describe('countdownParts', () => {
  it('splits into days, hours, minutes', () => {
    const now = Date.parse('2026-11-08T12:00:00Z');
    const kickoff = now + ((1 * 24 + 4) * 60 + 44) * 60_000 + 30_000;
    expect(countdownParts(kickoff, now)).toEqual({ days: 1, hours: 4, minutes: 44, started: false });
  });

  it('reports started once kickoff has passed', () => {
    expect(countdownParts(1000, 2000).started).toBeTrue();
  });
});

describe('loyaltyProgress', () => {
  const tier = (minPoints: number) => ({
    tier: 'silver' as const,
    label: 'Ezüst',
    minPoints,
    discountPercent: 5,
    color: '#000',
  });

  it('measures progress between the current and next tier floors', () => {
    const p = loyaltyProgress({
      points: 1000,
      tier: tier(500),
      nextTier: { ...tier(1500), tier: 'gold' },
      pointsToNextTier: 500,
      recentTransactions: [],
    } as LoyaltySnapshotResponse);
    expect(p.ratio).toBe(0.5);
    expect(p.pointsLeft).toBe(500);
  });

  it('is full with no points left at the top tier', () => {
    const p = loyaltyProgress({
      points: 9000,
      tier: tier(5000),
      recentTransactions: [],
    } as LoyaltySnapshotResponse);
    expect(p).toEqual({ ratio: 1, pointsLeft: null, isTopTier: true });
  });
});
