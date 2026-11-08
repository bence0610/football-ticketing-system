import { LoyaltySnapshotResponse } from '../../../core/models/loyalty.models';

export interface LoyaltyProgress {
  /** 0..1 progress from the current tier floor to the next tier floor. */
  readonly ratio: number;
  readonly pointsLeft: number | null;
  readonly isTopTier: boolean;
}

export function loyaltyProgress(snapshot: LoyaltySnapshotResponse): LoyaltyProgress {
  const next = snapshot.nextTier;
  if (!next) {
    return { ratio: 1, pointsLeft: null, isTopTier: true };
  }
  const floor = snapshot.tier.minPoints;
  const span = next.minPoints - floor;
  const done = snapshot.points - floor;
  const ratio = span > 0 ? Math.min(1, Math.max(0, done / span)) : 1;
  const left = snapshot.pointsToNextTier ?? Math.max(0, next.minPoints - snapshot.points);
  return { ratio, pointsLeft: left, isTopTier: false };
}
