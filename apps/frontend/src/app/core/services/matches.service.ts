import { HttpClient, HttpContext } from '@angular/common/http';
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

@Injectable({ providedIn: 'root' })
export class MatchesService {
  private readonly http = inject(HttpClient);

  /** `silent`: the caller copes with a failure itself, so no global error toast. */
  listAll(options: { silent?: boolean } = {}): Observable<MatchResource[]> {
    return this.http.get<MatchResource[]>('/matches', {
      context: options.silent ? new HttpContext().set(SKIP_ERROR_SNACKBAR, true) : undefined,
    });
  }

  findOne(id: string): Observable<MatchResource> {
    return this.http.get<MatchResource>(`/matches/${id}`);
  }
}
