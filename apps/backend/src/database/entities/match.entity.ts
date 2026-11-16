import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Ticket } from './ticket.entity';
import { Waitlist } from './waitlist.entity';

export enum MatchStatus {
  SCHEDULED = 'scheduled',
  ON_SALE = 'on_sale',
  SOLD_OUT = 'sold_out',
  POSTPONED = 'postponed',
  CANCELLED = 'cancelled',
  FINISHED = 'finished',
}

export enum Competition {
  NB1 = 'NB1',
  NB2 = 'NB2',
  MAGYAR_KUPA = 'magyar_kupa',
  FRIENDLY = 'friendly',
}

@Entity({ name: 'matches' })
@Index('idx_matches_kickoff', ['kickoffAt'])
@Index('idx_matches_status', ['status'])
export class Match extends BaseEntity {
  @Column({ type: 'varchar', length: 100, name: 'home_team' })
  homeTeam!: string;

  @Column({ type: 'varchar', length: 100, name: 'away_team' })
  awayTeam!: string;

  // The club plays in the NB II. Keep in step with migration CompetitionDefaultNb2.
  @Column({ type: 'enum', enum: Competition, default: Competition.NB2 })
  competition!: Competition;

  @Column({ type: 'varchar', length: 200 })
  venue!: string;

  @Column({ type: 'timestamp', name: 'kickoff_at' })
  kickoffAt!: Date;

  @Column({ type: 'enum', enum: MatchStatus, default: MatchStatus.SCHEDULED })
  status!: MatchStatus;

  @Column({ type: 'int', unsigned: true, default: 0 })
  capacity!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'base_price' })
  basePrice!: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'banner_image_url' })
  bannerImageUrl?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'boolean', default: true, name: 'is_season_pass_eligible' })
  isSeasonPassEligible!: boolean;

  @OneToMany(() => Ticket, (ticket) => ticket.match)
  tickets?: Ticket[];

  @OneToMany(() => Waitlist, (entry) => entry.match)
  waitlistEntries?: Waitlist[];
}
