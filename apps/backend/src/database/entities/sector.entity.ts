import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Sector-level reference data. Until now a "sector" existed only as the
 * `section` string on each seat, so a fact about the whole sector (is it under
 * a roof?) had nowhere to live and was hard-coded in the clients. One row per
 * sector, keyed by the same code the seats carry in `seats.section`.
 */
@Entity({ name: 'sectors' })
@Index('uq_sectors_code', ['code'], { unique: true })
export class Sector extends BaseEntity {
  /** Matches `seats.section` (A, B, C, VIP). */
  @Column({ type: 'varchar', length: 32 })
  code!: string;

  /** Display name, e.g. "A szektor". */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** True when the sector is under a roof: dry in the rain. */
  @Column({ type: 'boolean', default: false, name: 'is_covered' })
  isCovered!: boolean;
}
