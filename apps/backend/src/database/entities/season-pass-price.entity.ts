import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from './base.entity';

/**
 * Per-section season pass price catalogue for a given season label
 * (e.g. `2026/2027`). One row per (section, seasonLabel) pair.
 *
 * The active season is selected by `isActive: true`. The matching row
 * is what {@link SeasonPassesService.purchase} charges the buyer for
 * a given section.
 */
@Entity({ name: 'season_pass_prices' })
@Index('uq_season_pass_prices_section_season', ['section', 'seasonLabel'], { unique: true })
@Index('idx_season_pass_prices_season', ['seasonLabel'])
export class SeasonPassPrice extends BaseEntity {
  @Column({ type: 'varchar', length: 32 })
  section!: string;

  @Column({ type: 'varchar', length: 128, name: 'section_label' })
  sectionLabel!: string;

  @Column({ type: 'varchar', length: 32, name: 'season_label' })
  seasonLabel!: string;

  @Column({ type: 'int', unsigned: true })
  price!: number;

  @Column({ type: 'varchar', length: 8, default: 'HUF' })
  currency!: string;

  @Column({ type: 'date', name: 'valid_from' })
  validFrom!: Date;

  @Column({ type: 'date', name: 'valid_until' })
  validUntil!: Date;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;
}
