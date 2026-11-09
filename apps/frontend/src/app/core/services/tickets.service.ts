import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_SNACKBAR } from '../interceptors/error.interceptor';
import { TicketQrResponse, TicketResponse, TicketScanResponse } from '../models/ticket.models';

@Injectable({ providedIn: 'root' })
export class TicketsService {
  private readonly http = inject(HttpClient);

  listMine(): Observable<TicketResponse[]> {
    return this.http.get<TicketResponse[]>('/tickets/me');
  }

  getQr(ticketId: string): Observable<TicketQrResponse> {
    return this.http.get<TicketQrResponse>(`/tickets/${ticketId}/qr`);
  }

  /**
   * The gate screen turns every failure into its own full-screen verdict, so
   * no global error toast may appear over it (it would cover the buttons).
   */
  scan(ticketId: string, token: string): Observable<TicketScanResponse> {
    return this.http.patch<TicketScanResponse>(
      `/tickets/${ticketId}/scan`,
      { token },
      { context: new HttpContext().set(SKIP_ERROR_SNACKBAR, true) },
    );
  }
}
