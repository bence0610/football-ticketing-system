import { HttpErrorResponse } from '@angular/common/http';
import { NETWORK_ERROR_MESSAGE } from './api-error';
import {
  SEAT_TAKEN_MESSAGE,
  SIGN_IN_TO_LOCK_MESSAGE,
  isSeatTaken,
  lockErrorMessage,
} from './lock-error';

describe('lockErrorMessage', () => {
  const http = (status: number, body?: unknown) => new HttpErrorResponse({ status, error: body });

  it('says a taken seat is taken, whatever the server wrote', () => {
    const e = http(409, { message: 'Seat x for match y is already locked. Please pick a different seat.' });
    expect(isSeatTaken(e)).toBeTrue();
    expect(lockErrorMessage(e)).toBe(SEAT_TAKEN_MESSAGE);
  });

  it('uses the server message for other failures, a fallback without one', () => {
    expect(lockErrorMessage(http(404, { message: 'A szék (x) nem található.' }))).toBe('A szék (x) nem található.');
    expect(lockErrorMessage(http(500))).toBe('A szék zárolása sikertelen.');
  });

  it('reports an unreachable server, and keeps the cart own messages', () => {
    expect(lockErrorMessage(http(0))).toBe(NETWORK_ERROR_MESSAGE);
    expect(lockErrorMessage(new Error('Egy kosárba legfeljebb 6 jegy vehető fel.'))).toBe(
      'Egy kosárba legfeljebb 6 jegy vehető fel.',
    );
  });

  it('asks a guest to sign in (the server refuses an unauthenticated lock with 401)', () => {
    expect(lockErrorMessage(http(401, { message: 'Unauthorized' }))).toBe(SIGN_IN_TO_LOCK_MESSAGE);
    expect(SIGN_IN_TO_LOCK_MESSAGE).toContain('jelentkezz be');
  });

  it('gives the server wording, not "seat taken", when the buyer holds too many seats or a hold is at its maximum', () => {
    for (const code of ['seat_limit_reached', 'hold_limit_reached']) {
      const e = http(409, { code, message: 'A szerver szövege.' });
      expect(isSeatTaken(e)).toBeFalse();
      expect(lockErrorMessage(e)).toBe('A szerver szövege.');
    }
  });

  it('gives the server wording for a rate-limited request (429)', () => {
    expect(
      lockErrorMessage(http(429, { code: 'rate_limited', message: 'Túl sok kérés érkezett.' })),
    ).toBe('Túl sok kérés érkezett.');
  });
});
