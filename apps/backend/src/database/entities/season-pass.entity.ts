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
export class SeasonPass extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

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

  @ManyToOne(() => Seat, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'seat_id' })
  seat?: Seat;

  @OneToMany(() => Ticket, (ticket) => ticket.seasonPass)
  tickets?: Ticket[];

  @OneToMany(() => PassLoan, (loan) => loan.seasonPass)
  loans?: PassLoan[];
}
