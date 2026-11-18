import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { SKIP_ERROR_SNACKBAR } from '../../core/interceptors/error.interceptor';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  MatchDetail,
  MatchListItem,
  QueryMatchesParams,
} from '../models/match.model';

/** The server returns at most 100 per request. */
const MAX_LIST = 100;

/** Query for the public pages: every match from `now` on, up to the server's page size. */
export function upcomingMatchesParams(now: Date = new Date()): QueryMatchesParams {
  return { from: now.toISOString(), limit: MAX_LIST };
}

@Injectable({ providedIn: 'root' })
export class MatchesApiService {
  private readonly http = inject(HttpClient);

  /**
   * GET /matches — filtered list of matches with availableSeats.
   */
  list(params: QueryMatchesParams = {}): Observable<MatchListItem[]> {
    let httpParams = new HttpParams();
    if (params.status) {
      httpParams = httpParams.set('status', params.status);
    }
    if (params.from) {
      httpParams = httpParams.set('from', params.from);
    }
    if (params.to) {
      httpParams = httpParams.set('to', params.to);
    }
    if (params.limit !== undefined) {
      httpParams = httpParams.set('limit', String(params.limit));
    }
    return this.http.get<MatchListItem[]>('/matches', { params: httpParams });
  }

  /**
   * GET /matches/upcoming — next 5 upcoming on_sale / scheduled matches.
   */
  upcoming(): Observable<MatchListItem[]> {
    return this.http.get<MatchListItem[]>('/matches/upcoming');
  }

  /**
   * GET /matches/:id — detailed match record.
   */
  detail(matchId: string, options: { silent?: boolean } = {}): Observable<MatchDetail> {
    return this.http.get<MatchDetail>(`/matches/${matchId}`, {
      context: options.silent ? new HttpContext().set(SKIP_ERROR_SNACKBAR, true) : undefined,
    });
  }
}
