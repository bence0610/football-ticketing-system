import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_SNACKBAR } from '../../core/interceptors/error.interceptor';
import { LockSeatResponse, MatchSeatsResponse } from '../models/seat.model';

// Every caller of the lock endpoint (seat map, cart re-book) words a failure
// itself via lockErrorMessage(), so the global snackbar - which would show the
// server's raw English text - must stay out of it.
const OWN_ERROR_MESSAGE = new HttpContext().set(SKIP_ERROR_SNACKBAR, true);

@Injectable({ providedIn: 'root' })
export class SeatsApiService {
  private readonly http = inject(HttpClient);

  /**
   * GET /matches/:matchId/seats — full seat map with status + sector summary.
   */
  loadSeats(matchId: string): Observable<MatchSeatsResponse> {
    return this.http.get<MatchSeatsResponse>(`/matches/${matchId}/seats`);
  }

  /**
   * POST /matches/:matchId/seats/:seatId/lock — atomic Redis SET NX EX lock.
   * Returns the owner token for later release.
   */
  lockSeat(matchId: string, seatId: string): Observable<LockSeatResponse> {
    return this.http.post<LockSeatResponse>(
      `/matches/${matchId}/seats/${seatId}/lock`,
      {},
      { context: OWN_ERROR_MESSAGE },
    );
  }

  /**
   * DELETE /matches/:matchId/seats/:seatId/lock?ownerToken=...
   */
  unlockSeat(matchId: string, seatId: string, ownerToken: string): Observable<void> {
    const params = new HttpParams().set('ownerToken', ownerToken);
    return this.http.delete<void>(`/matches/${matchId}/seats/${seatId}/lock`, {
      params,
    });
  }

  /**
   * POST /matches/:matchId/seats/:seatId/lock/extend — extends an existing lock.
   * Used by KTE-037 to give the user a retry window after a failed payment.
   */
  extendLock(
    matchId: string,
    seatId: string,
    ownerToken: string,
    ttlSeconds = 120,
  ): Observable<LockSeatResponse> {
    const params = new HttpParams()
      .set('ownerToken', ownerToken)
      .set('ttlSeconds', String(ttlSeconds));
    return this.http.post<LockSeatResponse>(
      `/matches/${matchId}/seats/${seatId}/lock/extend`,
      {},
      { params },
    );
  }
}
