import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SeasonPassPrice } from '../../database/entities';

/** The season the application sells and reports on: read from the active price rows. */
export interface ActiveSeason {
  label: string;
  validFrom: Date;
  validUntil: Date;
}

type PriceRowDates = Pick<SeasonPassPrice, 'seasonLabel' | 'validFrom' | 'validUntil'>;

/** True if `a` is the newer season row: later end, then later start, then later label. */
function isNewer(a: PriceRowDates, b: PriceRowDates): boolean {
  const endA = new Date(a.validUntil).getTime();
  const endB = new Date(b.validUntil).getTime();
  if (endA !== endB) return endA > endB;
  const startA = new Date(a.validFrom).getTime();
  const startB = new Date(b.validFrom).getTime();
  if (startA !== startB) return startA > startB;
  return a.seasonLabel > b.seasonLabel;
}

/**
 * THE rule for "which season is active", used by the public pass page, the pass purchase and the
 * admin overview alike (there is no other definition and no constant in the code).
 *
 * The active season is the one named by the active `season_pass_prices` rows. When two seasons'
 * rows are active at once (next season's passes put on sale in June while the running season has
 * not ended), the NEWER season wins: the one whose period ends last (ties: the later start, then
 * the later label). Selling the next season as soon as its prices are switched on is what putting
 * them on is for; to go on selling the running season until it ends, leave the next season's rows
 * inactive until then. Passes already bought are untouched (they carry their own season and
 * period).
 */
export function pickActiveSeason(rows: readonly PriceRowDates[]): ActiveSeason | null {
  let best: PriceRowDates | null = null;
  for (const row of rows) {
    if (!best || isNewer(row, best)) {
      best = row;
    }
  }
  if (!best) return null;
  // Rows of one season share its period; if they ever differ, the widest span is the season's.
  const same = rows.filter((r) => r.seasonLabel === best!.seasonLabel);
  const validFrom = same.reduce((a, r) => (r.validFrom < a ? r.validFrom : a), best.validFrom);
  const validUntil = same.reduce((a, r) => (r.validUntil > a ? r.validUntil : a), best.validUntil);
  return {
    label: best.seasonLabel,
    validFrom: new Date(validFrom),
    validUntil: new Date(validUntil),
  };
}

@Injectable()
export class ActiveSeasonService {
  constructor(
    @InjectRepository(SeasonPassPrice)
    private readonly priceRepository: Repository<SeasonPassPrice>,
  ) {}

  /** The active season, or null when no price row is active. */
  async current(): Promise<ActiveSeason | null> {
    return pickActiveSeason(await this.priceRepository.find({ where: { isActive: true } }));
  }

  /** Its label, or null. */
  async label(): Promise<string | null> {
    return (await this.current())?.label ?? null;
  }
}
