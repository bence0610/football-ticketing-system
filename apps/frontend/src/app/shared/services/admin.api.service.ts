import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Overview, OverviewPeriod, SeatSales } from '../models/admin.model';

/** Read-only: the admin area has no write endpoint (see the notice on every page). */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);

  overview(period: OverviewPeriod): Observable<Overview> {
    return this.http.get<Overview>('/admin/overview', {
      params: new HttpParams().set('period', period),
    });
  }

  seatSales(): Observable<SeatSales> {
    return this.http.get<SeatSales>('/admin/seat-sales');
  }
}
