import { HttpErrorResponse } from '@angular/common/http';
import type { SeasonPassPrice, SeasonPassSector } from '../../core/models/season-pass.models';
import {
  availabilityOf,
  formatCountdown,
  holdDeadlineMs,
  mostPopularSectionId,
  panelSector,
  perMatchEquivalent,
  savingsFor,
  sectorFreeText,
  sectorSoldOut,
  seasonSeatConflict,
  seasonSeatConflictMessage,
  unavailableSeatReason,
} from './season-pass.logic';

describe('choosing the seat: helpers', () => {
  const sector = (freeSeats: number): SeasonPassSector => ({
    section: 'D/1', name: 'D/1 szektor', arc: 'lower', position: 1, gate: 3, covered: true, total: 100, freeSeats,
  });

  it('words the free pass seats of a sector, "elfogyott" at zero', () => {
    expect(sectorFreeText(sector(7))).toBe('7 szabad bérletes hely');
    expect(sectorFreeText(sector(0))).toBe('elfogyott');
    expect(sectorSoldOut(sector(0))).toBeTrue();
    expect(sectorSoldOut(sector(1))).toBeFalse();
  });

  it('reads the 409 code it knows, and nothing else', () => {
    const conflict = (code: string, status = 409): HttpErrorResponse =>
      new HttpErrorResponse({ status, error: { code, message: 'x' } });
    expect(seasonSeatConflict(conflict('seat_taken'))).toBe('seat_taken');
    expect(seasonSeatConflict(conflict('seat_held'))).toBe('seat_held');
    expect(seasonSeatConflict(conflict('hold_lost'))).toBe('hold_lost');
    expect(seasonSeatConflict(conflict('seat_disabled'))).toBe('seat_disabled');
    expect(seasonSeatConflict(conflict('pass_not_issued_refunded'))).toBe('pass_not_issued_refunded');
    expect(seasonSeatConflict(conflict('holder_already_has_pass'))).toBeNull();
    expect(seasonSeatConflict(conflict('seat_taken', 400))).toBeNull();
    expect(seasonSeatConflict(new Error('x'))).toBeNull();
  });

  it('knows seat_ticketed and words it as the server does', () => {
    const err = new HttpErrorResponse({ status: 409, error: { code: 'seat_ticketed', message: 'x' } });
    expect(seasonSeatConflict(err)).toBe('seat_ticketed');
    expect(seasonSeatConflictMessage('seat_ticketed')).toBe(
      'Erre a helyre már van jegy egy közelgő mérkőzésre, ezért nem váltható rá bérlet (a bérletes belépő arra a meccsre nem állítható ki). Válassz másik helyet.',
    );
  });

  it('says in plain words why a board seat cannot be chosen', () => {
    expect(unavailableSeatReason('available')).toBeNull();
    expect(unavailableSeatReason('season_pass')).toBe('Erre a helyre már szól bérlet ebben a szezonban.');
    expect(unavailableSeatReason('ticketed')).toBe(
      'Erre a helyre már van jegy egy közelgő mérkőzésre, ezért nem váltható bérletre.',
    );
    expect(unavailableSeatReason('locked')).toBe('Másik vásárló épp fizet erre a helyre.');
    expect(unavailableSeatReason('disabled')).toBe('Ez a hely nem értékesíthető.');
    // a status the season board does not know is not for sale either
    expect(unavailableSeatReason('sold')).toBe('Ez a hely nem értékesíthető.');
    expect(unavailableSeatReason('away')).toBe('Ez a hely nem értékesíthető.');
  });

  it('counts the hold down from expiresAt, or from the ttl when the device clock is off', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    const onTime = { seatId: 's', holdToken: 't', ttlSeconds: 600, expiresAt: '2026-11-14T12:10:00Z' };
    expect(holdDeadlineMs(onTime, now)).toBe(Date.parse('2026-11-14T12:10:00Z'));
    // the phone is an hour ahead: expiresAt would already be past
    expect(holdDeadlineMs(onTime, now + 3_600_000)).toBe(now + 3_600_000 + 600_000);
    expect(holdDeadlineMs({ ...onTime, expiresAt: 'nonsense' }, now)).toBe(now + 600_000);
  });

  it('formats the countdown as m:ss', () => {
    expect(formatCountdown(600_000)).toBe('10:00');
    expect(formatCountdown(65_400)).toBe('1:06');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

function price(over: Partial<SeasonPassPrice> = {}): SeasonPassPrice {
  return {
    sectionId: 'A',
    sectionName: 'A szektor',
    price: 30000,
    currency: 'HUF',
    seasonLabel: '2026/2027',
    ...over,
  };
}

describe('availabilityOf', () => {
  it('claims nothing without a free-seat count', () => {
    expect(availabilityOf(price())).toBe('unknown');
  });

  it('sold out at zero', () => {
    expect(availabilityOf(price({ freeSeats: 0, totalSeats: 200 }))).toBe('sold-out');
  });

  it('red at 10% of the sector or less', () => {
    expect(availabilityOf(price({ freeSeats: 20, totalSeats: 200 }))).toBe('nearly-gone');
    expect(availabilityOf(price({ freeSeats: 21, totalSeats: 200 }))).toBe('few');
  });

  it('red at 3 seats or fewer even in a small sector', () => {
    expect(availabilityOf(price({ freeSeats: 3, totalSeats: 24 }))).toBe('nearly-gone');
    expect(availabilityOf(price({ freeSeats: 4, totalSeats: 24 }))).toBe('few');
  });

  it('amber up to 30%, green above', () => {
    expect(availabilityOf(price({ freeSeats: 60, totalSeats: 200 }))).toBe('few');
    expect(availabilityOf(price({ freeSeats: 61, totalSeats: 200 }))).toBe('plenty');
  });
});

describe('mostPopularSectionId', () => {
  it('is the single sector with the most passes sold', () => {
    expect(
      mostPopularSectionId([
        price({ sectionId: 'A', passesSold: 4 }),
        price({ sectionId: 'B', passesSold: 9 }),
      ]),
    ).toBe('B');
  });

  it('is null on a tie, with nothing sold, or without the data', () => {
    expect(
      mostPopularSectionId([
        price({ sectionId: 'A', passesSold: 5 }),
        price({ sectionId: 'B', passesSold: 5 }),
      ]),
    ).toBeNull();
    expect(mostPopularSectionId([price({ passesSold: 0 })])).toBeNull();
    expect(mostPopularSectionId([price()])).toBeNull();
  });

  it('a tie below the leader does not matter', () => {
    expect(
      mostPopularSectionId([
        price({ sectionId: 'A', passesSold: 2 }),
        price({ sectionId: 'B', passesSold: 2 }),
        price({ sectionId: 'C', passesSold: 7 }),
      ]),
    ).toBe('C');
  });
});

describe('perMatchEquivalent', () => {
  it('divides the pass price by the matches it still covers', () => {
    expect(perMatchEquivalent(price({ price: 30000, upcomingHomeMatches: 15 }))).toBe(2000);
  });

  it('is null without a match count', () => {
    expect(perMatchEquivalent(price())).toBeNull();
    expect(perMatchEquivalent(price({ upcomingHomeMatches: 0 }))).toBeNull();
  });
});

describe('savingsFor', () => {
  it('reports the positive difference', () => {
    const s = savingsFor(price({ price: 30000, singleMatchTotal: 45000, upcomingHomeMatches: 10 }));
    expect(s).toEqual({ separate: 45000, pass: 30000, difference: 15000, matches: 10 });
  });

  it('shows no difference when the pass is not cheaper', () => {
    expect(savingsFor(price({ price: 30000, singleMatchTotal: 30000 })).difference).toBeNull();
    expect(savingsFor(price({ price: 30000, singleMatchTotal: 20000 })).difference).toBeNull();
  });

  it('shows no total and no difference when the total is unknown', () => {
    const s = savingsFor(price({ singleMatchTotal: null }));
    expect(s.separate).toBeNull();
    expect(s.difference).toBeNull();
  });
});

describe('panelSector', () => {
  const prices = [
    price({ sectionId: 'VIP', price: 45000 }),
    price({ sectionId: 'C', price: 20000 }),
    price({ sectionId: 'B', price: 25000 }),
  ];

  it('is the selected sector', () => {
    expect(panelSector(prices, 'B')?.sectionId).toBe('B');
  });

  it('falls back to the cheapest', () => {
    expect(panelSector(prices, null)?.sectionId).toBe('C');
  });

  it('is null without prices', () => {
    expect(panelSector([], null)).toBeNull();
  });
});
