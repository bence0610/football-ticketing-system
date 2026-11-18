import { BeforeInsert, Column, Entity, Index, OneToMany } from 'typeorm';
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

/**
 * THE rule for whether a season pass covers a match, by what the match IS: a home league match
 * (NB1 / NB2) or a home Magyar Kupa tie. A friendly is not covered, and no away match is (no
 * tickets are sold for it). Everything that decides the stored `isSeasonPassEligible` flag
 * (the entity default below, the migration, the seeds, the demo data) asks this.
 */
export function isPassEligibleMatch(competition: Competition, isHome: boolean): boolean {
  return isHome && competition !== Competition.FRIENDLY;
}

/** Same default as `app.config` (`HOME_TEAM_NAME`); read here because an entity has no DI. */
function configuredHomeTeam(): string {
  return process.env.HOME_TEAM_NAME ?? 'Kecskeméti TE';
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

  /**
   * Whether season passes cover this match. Left unset on creation it is DECIDED from the match
   * itself (see {@link isPassEligibleMatch}), so a cup tie added after the passes were sold is
   * covered from its first instant: its pass seats are held and no single ticket is sold on them.
   * An explicit value is kept. The column default is 0 (keep in step with migration
   * PassEligibleDefaultOff): an insert that bypasses the entity is NOT covered, the safe failure.
   */
  @Column({ type: 'boolean', default: false, name: 'is_season_pass_eligible' })
  isSeasonPassEligible!: boolean;

  @BeforeInsert()
  decidePassEligibility(): void {
    if (this.isSeasonPassEligible === undefined || this.isSeasonPassEligible === null) {
      this.isSeasonPassEligible = isPassEligibleMatch(
        this.competition ?? Competition.NB2,
        this.homeTeam === configuredHomeTeam(),
      );
    }
  }

  @OneToMany(() => Ticket, (ticket) => ticket.match)
  tickets?: Ticket[];

  @OneToMany(() => Waitlist, (entry) => entry.match)
  waitlistEntries?: Waitlist[];
}
