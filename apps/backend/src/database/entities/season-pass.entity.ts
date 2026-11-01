import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Seat } from './seat.entity';
import { Ticket } from './ticket.entity';
import { PassLoan } from './pass-loan.entity';
import { dateColumnTransformer } from './typeorm.transformers';

export enum SeasonPassStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
  PENDING_PAYMENT = 'pending_payment',
}

@Entity({ name: 'season_passes' })
@Index('IDX_season_passes_qr', ['qrCode'], { unique: true })
@Index('idx_season_passes_user', ['userId'])
@Index('idx_season_passes_status', ['status'])
// Physical rule: one pass per seat per season.
@Index('uq_season_passes_seat_season', ['seatId', 'seasonLabel'], { unique: true })
// An account holds at most one pass per season (NULL holders — children — are unconstrained).
@Index('uq_season_passes_holder_season', ['holderUserId', 'seasonLabel'], { unique: true })
export class SeasonPass extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** Name of the person who occupies the seat (shown at the gate). Always set. */
  @Column({ type: 'varchar', length: 120, name: 'holder_name' })
  holderName!: string;

  /** Optional account of the holder. NULL when the holder has no account. */
  @Column({ type: 'varchar', length: 36, nullable: true, name: 'holder_user_id' })
  holderUserId?: string | null;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'seat_id' })
  seatId?: string;

  @Column({ type: 'varchar', length: 32, name: 'season_label' })
  seasonLabel!: string;

  @Column({ type: 'date', name: 'valid_from', transformer: dateColumnTransformer })
  validFrom!: Date;

  @Column({ type: 'date', name: 'valid_until', transformer: dateColumnTransformer })
  validUntil!: Date;

  @Column({ type: 'enum', enum: SeasonPassStatus, default: SeasonPassStatus.PENDING_PAYMENT })
  status!: SeasonPassStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'price_paid' })
  pricePaid!: string;

  @Column({ type: 'varchar', length: 8, default: 'HUF' })
  currency!: string;

  @Column({ type: 'varchar', length: 64, name: 'qr_code' })
  qrCode!: string;

  @Column({ type: 'boolean', default: false, name: 'auto_renew' })
  autoRenew!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'stripe_payment_intent_id' })
  stripePaymentIntentId?: string;

  @ManyToOne(() => User, (user) => user.seasonPasses, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'holder_user_id' })
  holder?: User | null;

  @ManyToOne(() => Seat, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'seat_id' })
  seat?: Seat;

  @OneToMany(() => Ticket, (ticket) => ticket.seasonPass)
  tickets?: Ticket[];

  @OneToMany(() => PassLoan, (loan) => loan.seasonPass)
  loans?: PassLoan[];
}
