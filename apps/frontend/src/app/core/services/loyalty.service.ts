import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { LoyaltySnapshotResponse, LoyaltyTier, LoyaltyTierResponse } from '../models/loyalty.models';

const TIER_ORDER: readonly LoyaltyTier[] = ['bronze', 'silver', 'gold', 'platinum'];
const LAST_SEEN_KEY_PREFIX = 'kte.loyalty.lastSeenTier.';

@Injectable({ providedIn: 'root' })
export class LoyaltyService {
  private readonly http = inject(HttpClient);

  getSnapshot(): Observable<LoyaltySnapshotResponse> {
    return this.http.get<LoyaltySnapshotResponse>('/loyalty/me');
  }

  getTiers(): Observable<LoyaltyTierResponse[]> {
    return this.http.get<LoyaltyTierResponse[]>('/loyalty/tiers');
  }

  /**
   * Compares `current` with the tier this user saw the last time the loyalty
   * page loaded, and remembers `current` for next time. Returns the tier to
   * celebrate, or null when there is nothing to celebrate.
   *
   * The last-seen tier is kept per user in localStorage (the page component is
   * recreated on every visit, so it cannot hold it itself). The first ever
   * load for a user only records a baseline — nobody is congratulated for the
   * tier they already had. A move down the ladder is recorded silently.
   * Storage being unavailable simply disables the toast.
   */
  recordTierAndDetectUpgrade(userId: string, current: LoyaltyTier): LoyaltyTier | null {
    const key = LAST_SEEN_KEY_PREFIX + userId;
    let previous: string | null = null;
    try {
      previous = localStorage.getItem(key);
      localStorage.setItem(key, current);
    } catch {
      return null;
    }
    const before = TIER_ORDER.indexOf(previous as LoyaltyTier);
    if (before < 0) {
      return null;
    }
    return TIER_ORDER.indexOf(current) > before ? current : null;
  }
}
