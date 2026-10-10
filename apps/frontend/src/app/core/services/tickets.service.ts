import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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

  scan(ticketId: string, token: string): Observable<TicketScanResponse> {
    return this.http.patch<TicketScanResponse>(`/tickets/${ticketId}/scan`, { token });
  }
}
