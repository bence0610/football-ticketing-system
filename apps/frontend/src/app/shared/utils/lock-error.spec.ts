import { HttpErrorResponse } from '@angular/common/http';
import { NETWORK_ERROR_MESSAGE } from './api-error';
import { SEAT_TAKEN_MESSAGE, isSeatTaken, lockErrorMessage } from './lock-error';

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
});
