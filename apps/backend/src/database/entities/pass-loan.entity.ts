import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { SeasonPass } from './season-pass.entity';
import { User } from './user.entity';
import { Match } from './match.entity';

export enum PassLoanStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  /** The lender withdrew an accepted loan. Reserved: no code path sets it yet. */
  REVOKED = 'revoked',
  /** The pass owner had already entered, so the entry right could not be lent. */
  OWNER_ENTERED = 'owner_entered',
  EXPIRED = 'expired',
  USED = 'used',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Entity({ name: 'pass_loans' })
@Index('idx_pass_loans_pass', ['seasonPassId'])
@Index('idx_pass_loans_borrower', ['borrowerUserId'])
@Index('idx_pass_loans_match', ['matchId'])
@Index('idx_pass_loans_status_match', ['status', 'matchId'])
@Index('IDX_pass_loans_token', ['invitationToken'], { unique: true })
@Index('uq_pass_loans_qr_jti', ['qrJti'], { unique: true })
export class PassLoan extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'season_pass_id' })
  seasonPassId!: string;

  @Column({ type: 'varchar', length: 36, name: 'lender_user_id' })
  lenderUserId!: string;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'borrower_user_id' })
  borrowerUserId?: string;

  @Column({ type: 'varchar', length: 36, name: 'match_id' })
  matchId!: string;

  @Column({ type: 'varchar', length: 255, name: 'borrower_email' })
  borrowerEmail!: string;

  @Column({ type: 'enum', enum: PassLoanStatus, default: PassLoanStatus.PENDING })
  status!: PassLoanStatus;

  @Column({ type: 'varchar', length: 64, name: 'invitation_token' })
  invitationToken!: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'accepted_at' })
  acceptedAt?: Date;

  @Column({ type: 'varchar', length: 36, nullable: true, name: 'qr_jti' })
  qrJti?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'qr_revoked_at' })
  qrRevokedAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'cancelled_at' })
  cancelledAt?: Date;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'cancellation_reason' })
  cancellationReason?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt?: Date;

  @ManyToOne(() => SeasonPass, (pass) => pass.loans, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'season_pass_id' })
  seasonPass?: SeasonPass;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'lender_user_id' })
  lender?: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'borrower_user_id' })
  borrower?: User;

  @ManyToOne(() => Match, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'match_id' })
  match?: Match;
}
