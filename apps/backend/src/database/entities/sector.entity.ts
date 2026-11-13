import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Sector-level reference data: everything the portal knows about a part of the
 * stadium as a whole. A sector's facts live here, once, and the UI reads them
 * from the API instead of hard-coding them. Keyed by the code the seats carry
 * in `seats.section`.
 *
 * The 19 rows of the Széktói Stadion come from the `StadiumLayout` migration;
 * the layout itself (and which parts of it are reconstruction rather than
 * survey) is documented in `database/stadium-layout.ts`.
 */
@Entity({ name: 'sectors' })
@Index('uq_sectors_code', ['code'], { unique: true })
@Index('uq_sectors_arc_position', ['arc', 'position'], { unique: true })
export class Sector extends BaseEntity {
  /** Matches `seats.section` ("D/1", "VENDÉG", "VIP"). */
  @Column({ type: 'varchar', length: 32 })
  code!: string;

  /** Display name, e.g. "D/1 szektor" or "VIP". The UI shows this as is. */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** True when the sector is under a roof: dry in the rain. */
  @Column({ type: 'boolean', default: false, name: 'is_covered' })
  isCovered!: boolean;

  /** Which arc of the stadium: the upper one, or the lower (main-building) one. */
  @Column({ type: 'varchar', length: 8 })
  arc!: 'upper' | 'lower';

  /** 1-based position on the arc, west to east. Orders every sector list. */
  @Column({ type: 'smallint', unsigned: true })
  position!: number;

  /** Entrance gate (1..4) that serves this sector. Looked up, never copied onto tickets. */
  @Column({ type: 'tinyint', unsigned: true })
  gate!: number;

  /**
   * Price tier: `upper` (the whole upper arc), `lower` (the lower arc, VIP
   * excepted) or `vip`. Null for the away section, which has no price.
   */
  @Column({ type: 'varchar', length: 16, name: 'price_category', nullable: true })
  priceCategory!: 'vip' | 'upper' | 'lower' | null;

  /** The away section: not sold through the portal, no season passes. */
  @Column({ type: 'boolean', default: false, name: 'is_away' })
  isAway!: boolean;
}
