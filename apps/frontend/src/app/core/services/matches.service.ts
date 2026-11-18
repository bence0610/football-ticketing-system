import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { SKIP_ERROR_SNACKBAR } from '../interceptors/error.interceptor';

export type MatchStatus =
  | 'scheduled'
  | 'on_sale'
  | 'sold_out'
  | 'postponed'
  | 'cancelled'
  | 'finished';

export type Competition = 'NB1' | 'NB2' | 'magyar_kupa' | 'friendly';

/**
 * Lightweight match resource as exposed by `GET /matches`.
 * The backend returns the full TypeORM entity, so optional ticket/waitlist
 * relations are intentionally omitted here (the UI does not need them).
 */
export interface MatchResource {
  id: string;
  homeTeam: string;
  awayTeam: string;
  competition: Competition;
  venue: string;
  kickoffAt: string;
  status: MatchStatus;
  capacity: number;
  basePrice: string;
  bannerImageUrl?: string;
  description?: string;
  isSeasonPassEligible: boolean;
}

/** The most the server returns for one GET /matches. */
const MAX_MATCH_LIST = 100;

export interface MatchListOptions {
  /** Window start (kickoff at or after). Required in practice: see {@link MatchesService.list}. */
  from: Date;
  /** Window end (kickoff at or before). */
  to?: Date;
  limit?: number;
  silent?: boolean;
}

@Injectable({ providedIn: 'root' })
export class MatchesService {
  private readonly http = inject(HttpClient);

  /**
   * GET /matches in kickoff order. The server caps the list (50 by default, 100 at most) and
   * counts from the OLDEST match, so a caller must always bound it with `from`/`to` to the window
   * it needs: unbounded, the past fills the cap and the upcoming matches fall off the end.
   *
   * `silent`: the caller copes with a failure itself, so no global error toast.
   */
  list(options: MatchListOptions): Observable<MatchResource[]> {
    let params = new HttpParams().set('limit', String(options.limit ?? MAX_MATCH_LIST));
    if (options.from) params = params.set('from', options.from.toISOString());
    if (options.to) params = params.set('to', options.to.toISOString());
    return this.http.get<MatchResource[]>('/matches', {
      params,
      context: options.silent ? new HttpContext().set(SKIP_ERROR_SNACKBAR, true) : undefined,
    });
  }

  /** Matches that have not kicked off yet. */
  listUpcoming(options: { silent?: boolean } = {}): Observable<MatchResource[]> {
    return this.list({ from: new Date(), ...options });
  }

  findOne(id: string): Observable<MatchResource> {
    return this.http.get<MatchResource>(`/matches/${id}`);
  }
}
