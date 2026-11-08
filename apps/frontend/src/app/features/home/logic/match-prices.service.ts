import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { SeatsApiService } from '../../../shared/services/seats.api.service';
import { SectorSummary } from '../../../shared/models/seat.model';

export interface MatchPrices {
  readonly sectors: readonly SectorSummary[];
  /** Lowest seat price across all sectors, or null when unknown. */
  readonly lowest: number | null;
}

/**
 * Sector prices per match, from the seat-map endpoint's sector summary (the
 * only endpoint that exposes per-sector prices). Cached per match so the hero
 * and the cards share one request.
 */
@Injectable({ providedIn: 'root' })
export class MatchPricesService {
  private readonly seats = inject(SeatsApiService);
  private readonly cache = new Map<string, Observable<MatchPrices>>();

  forMatch(matchId: string): Observable<MatchPrices> {
    let entry = this.cache.get(matchId);
    if (!entry) {
      entry = this.seats.loadSeats(matchId).pipe(
        map((res): MatchPrices => {
          const sectors = [...res.sectorSummary].sort((a, b) => a.minPrice - b.minPrice);
          const prices = sectors.map((s) => s.minPrice).filter((p) => Number.isFinite(p));
          return { sectors, lowest: prices.length ? Math.min(...prices) : null };
        }),
        catchError(() => of<MatchPrices>({ sectors: [], lowest: null })),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
      this.cache.set(matchId, entry);
    }
    return entry;
  }
}
