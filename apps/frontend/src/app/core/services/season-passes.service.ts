import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_SNACKBAR } from '../interceptors/error.interceptor';
import {
  LoanPreview,
  PassLoanResponse,
  PurchaseSeasonPassPayload,
  PurchaseSeasonPassResponse,
  SeasonPassPrice,
  SeasonPassResponse,
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

  purchase(payload: PurchaseSeasonPassPayload): Observable<PurchaseSeasonPassResponse> {
    return this.http.post<PurchaseSeasonPassResponse>('/season-passes/purchase', payload, {
      withCredentials: true,
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

  previewLoan(token: string): Observable<LoanPreview> {
    return this.http.get<LoanPreview>(
      `/season-passes/loans/preview/${encodeURIComponent(token)}`,
    );
  }

  getMatchQr(passId: string, matchId: string): Observable<TicketQrResponse> {
    return this.http.get<TicketQrResponse>(`/season-passes/${passId}/qr/${matchId}`);
  }
}
