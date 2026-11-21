import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Match } from './match.entity';
import { Seat } from './seat.entity';
import { User } from './user.entity';
import { SeasonPass } from './season-pass.entity';

export enum TicketStatus {
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  USED = 'used',
  EXPIRED = 'expired',
}

export enum TicketSource {
  SINGLE = 'single',
  SEASON_PASS = 'season_pass',
  LOAN = 'loan',
}

@Entity({ name: 'tickets' })
// Only a ticket that occupies its seat holds the (match, seat) slot: see activeSlot and migration
// TicketSlotOnlyForOccupying. A void ticket (cancelled / refunded / expired) leaves the seat free.
@Index('uq_tickets_match_seat', ['matchId', 'seatId', 'activeSlot'], { unique: true })
@Index('IDX_tickets_qr', ['qrCode'], { unique: true })
@Index('uq_tickets_qr_jti', ['qrJti'], { unique: true })
@Index('idx_tickets_user', ['userId'])
@Index('idx_tickets_status', ['status'])
@Index('idx_tickets_payment_intent', ['stripePaymentIntentId'])
@Index('idx_tickets_match_status', ['matchId', 'status'])
export class Ticket extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'match_id' })
  matchId!: string;

  @Column({ type: 'varchar', length: 36, name: 'seat_id' })
  seatId!: string;

  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** 1 while the ticket occupies its seat, NULL otherwise (database-generated; never written). */
  @Column({
    type: 'tinyint',
    name: 'active_slot',
    nullable: true,
    insert: false,
    update: false,
    select: false,
    generatedType: 'STORED',
    asExpression: "CASE WHEN `status` IN ('pending_payment','paid','used') THEN 1 ELSE NULL END",
  })
  activeSlot?: number | null;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'season_pass_id' })
  seasonPassId?: string;

  @Column({ type: 'enum', enum: TicketStatus, default: TicketStatus.PENDING_PAYMENT })
  status!: TicketStatus;

  @Column({ type: 'enum', enum: TicketSource, default: TicketSource.SINGLE })
  source!: TicketSource;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'price_paid' })
  pricePaid!: string;

  @Column({ type: 'varchar', length: 8, default: 'HUF' })
  currency!: string;

  @Column({ type: 'varchar', length: 64, name: 'qr_code' })
  qrCode!: string;

  @Column({ type: 'varchar', length: 36, name: 'qr_jti' })
  qrJti!: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'stripe_payment_intent_id' })
  stripePaymentIntentId?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'used_at' })
  usedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'scanned_at' })
  scannedAt?: Date;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'scanned_by_user_id' })
  scannedByUserId?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'expired_at' })
  expiredAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'confirmation_email_sent_at' })
  confirmationEmailSentAt?: Date;

  @ManyToOne(() => Match, (match) => match.tickets, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'match_id' })
  match?: Match;

  @ManyToOne(() => Seat, (seat) => seat.tickets, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'seat_id' })
  seat?: Seat;

  @ManyToOne(() => User, (user) => user.tickets, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @ManyToOne(() => SeasonPass, (pass) => pass.tickets, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'season_pass_id' })
  seasonPass?: SeasonPass;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'scanned_by_user_id' })
  scannedBy?: User;
}
