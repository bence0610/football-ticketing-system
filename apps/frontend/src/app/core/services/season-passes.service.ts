import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_SNACKBAR } from '../interceptors/error.interceptor';
import {
  IncomingLoan,
  LoanPreview,
  PassLoanResponse,
  PurchaseSeasonPassPayload,
  PurchaseSeasonPassResponse,
  SeasonOverview,
  SeasonPassPrice,
  SeasonPassResponse,
  SeasonPassSeatMap,
  SeasonPassTierSectors,
  SeasonSeatHold,
} from '../models/season-pass.models';
import { TicketQrResponse } from '../models/ticket.models';

export interface CreateLoanPayload {
  matchId: string;
  borrowerEmail: string;
}

export interface CancelLoanPayload {
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class SeasonPassesService {
  private readonly http = inject(HttpClient);

  listMine(): Observable<SeasonPassResponse[]> {
    return this.http.get<SeasonPassResponse[]>('/season-passes/me');
  }

  listMy(): Observable<SeasonPassResponse[]> {
    return this.http.get<SeasonPassResponse[]>('/season-passes/my');
  }

  listPrices(): Observable<SeasonPassPrice[]> {
    return this.http.get<SeasonPassPrice[]>('/season-passes/prices');
  }

  /**
   * Fixtures and loyalty reward of the season. The page copes with its absence
   * (it simply shows less), so a failure raises no global toast.
   */
  getSeasonOverview(): Observable<SeasonOverview> {
    return this.http.get<SeasonOverview>('/season-passes/season', {
      context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true),
    });
  }

  /** Sectors of one price tier with their free pass seats. The page shows a failure inline. */
  listTierSectors(tier: string): Observable<SeasonPassTierSectors> {
    return this.http.get<SeasonPassTierSectors>(
      `/season-passes/tiers/${encodeURIComponent(tier)}/sectors`,
      { context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true) },
    );
  }

  /** The season seat board of one sector. The page shows a failure inline. */
  getSeatMap(section: string): Observable<SeasonPassSeatMap> {
    return this.http.get<SeasonPassSeatMap>('/season-passes/seats', {
      params: new HttpParams().set('section', section),
      context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true),
    });
  }

  /**
   * Holds a seat for the buyer while they pay. One hold per user: the server
   * releases the previous one. A 409 (`seat_taken`, `seat_held`) is worded by the page.
   */
  holdSeat(seatId: string): Observable<SeasonSeatHold> {
    return this.http.post<SeasonSeatHold>(
      `/season-passes/seats/${encodeURIComponent(seatId)}/hold`,
      {},
      { context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true) },
    );
  }

  releaseHold(seatId: string, holdToken: string): Observable<void> {
    return this.http.delete<void>(`/season-passes/seats/${encodeURIComponent(seatId)}/hold`, {
      params: new HttpParams().set('holdToken', holdToken),
      context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true),
    });
  }

  purchase(payload: PurchaseSeasonPassPayload): Observable<PurchaseSeasonPassResponse> {
    // The purchase page shows the failure in its own inline block (role="alert"),
    // like every other form submission — so no global snackbar on top of it.
    return this.http.post<PurchaseSeasonPassResponse>('/season-passes/purchase', payload, {
      withCredentials: true,
      context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true),
    });
  }

  createLoan(passId: string, payload: CreateLoanPayload): Observable<PassLoanResponse> {
    return this.http.post<PassLoanResponse>(`/season-passes/${passId}/loans`, payload, {
      context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true),
    });
  }

  cancelLoan(passId: string, loanId: string, payload: CancelLoanPayload = {}): Observable<PassLoanResponse> {
    return this.http.request<PassLoanResponse>('DELETE', `/season-passes/${passId}/loans/${loanId}`, {
      body: payload,
    });
  }

  acceptLoan(invitationToken: string): Observable<PassLoanResponse> {
    return this.http.post<PassLoanResponse>(
      `/season-passes/loans/accept/${encodeURIComponent(invitationToken)}`,
      {},
    );
  }

  /**
   * Invitations waiting for the signed-in user. The profile still works without
   * them, so a failure raises no global toast.
   */
  listIncomingLoans(): Observable<IncomingLoan[]> {
    return this.http.get<IncomingLoan[]>('/season-passes/loans/incoming', {
      context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true),
    });
  }

  previewLoan(token: string): Observable<LoanPreview> {
    return this.http.get<LoanPreview>(
      `/season-passes/loans/preview/${encodeURIComponent(token)}`,
    );
  }

  getMatchQr(passId: string, matchId: string): Observable<TicketQrResponse> {
    return this.http.get<TicketQrResponse>(`/season-passes/${passId}/qr/${matchId}`);
  }
}
