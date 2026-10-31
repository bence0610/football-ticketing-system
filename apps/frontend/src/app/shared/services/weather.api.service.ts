import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MatchWeatherForecast } from '../models/payment.model';
import { SKIP_ERROR_SNACKBAR } from '../../core/interceptors/error.interceptor';

const SILENT_CONTEXT = new HttpContext().set(SKIP_ERROR_SNACKBAR, true);

/**
 * Wraps the backend weather endpoint. Re-exported here so consumers other
 * than the checkout flow (e.g. match details, admin) can fetch a forecast
 * without depending on the payments service.
 */
@Injectable({ providedIn: 'root' })
export class WeatherApiService {
  private readonly http = inject(HttpClient);

  forMatch(matchId: string): Observable<MatchWeatherForecast> {
    return this.http.get<MatchWeatherForecast>(`/weather/match/${matchId}`, {
      context: SILENT_CONTEXT,
    });
  }
}
