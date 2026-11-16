import { Repository } from 'typeorm';
import { Seat, Sector } from '../../database/entities';

/** Out only when the sector is KNOWN to be the away section (a seat with no sector row stays in). */
export const SELLABLE_SECTOR = '(sector.isAway = 0 OR sector.isAway IS NULL)';

/**
 * The seats a home match can actually sell: active seats outside the away section. The away
 * section (VENDÉG) is never sold through the portal, so it can never be occupied here and
 * must not be in the denominator of any occupancy figure: a sold-out home match reads 100%
 * of THIS number, not 95% of the whole stadium.
 */
export async function countSellableSeats(seats: Repository<Seat>): Promise<number> {
  return seats
    .createQueryBuilder('seat')
    .leftJoin(Sector, 'sector', 'sector.code = seat.section')
    .where('seat.isActive = 1')
    .andWhere(SELLABLE_SECTOR)
    .getCount();
}

/** Active seats outside the away section, with everything the heatmap needs. */
export async function findSellableSeats(seats: Repository<Seat>): Promise<Seat[]> {
  return seats
    .createQueryBuilder('seat')
    .leftJoin(Sector, 'sector', 'sector.code = seat.section')
    .where('seat.isActive = 1')
    .andWhere(SELLABLE_SECTOR)
    .orderBy('seat.section', 'ASC')
    .getMany();
}
