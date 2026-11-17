import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

export enum LoyaltyTransactionType {
  EARN = 'earn',
  REDEEM = 'redeem',
  ADJUSTMENT = 'adjustment',
  EXPIRY = 'expiry',
}

export enum LoyaltyTransactionSource {
  /** History only: buying a ticket earned points until attendance replaced it. */
  TICKET_PURCHASE = 'ticket_purchase',
  SEASON_PASS_PURCHASE = 'season_pass_purchase',
  PROMOTION = 'promotion',
  REWARD_REDEEM = 'reward_redeem',
  ADMIN = 'admin',
  PROFILE_COMPLETION = 'profile_completion',
  PASS_LOAN = 'pass_loan',
  SEASON_CARRYOVER = 'season_carryover',
  REGISTRATION = 'registration',
  /** History only: the per-entry pass award that attendance replaced; reference `ticket:<entry id>`. */
  PASS_ATTENDANCE = 'pass_attendance',
  /** Entering a match, once per user per match; the reference is `match:<match id>:<user id>`. */
  ATTENDANCE = 'attendance',
}

@Entity({ name: 'loyalty_transactions' })
@Unique('uq_loyalty_source_reference', ['source', 'referenceId'])
@Index('idx_loyalty_user', ['userId'])
@Index('idx_loyalty_created', ['createdAt'])
export class LoyaltyTransaction extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  @Column({ type: 'enum', enum: LoyaltyTransactionType })
  type!: LoyaltyTransactionType;

  @Column({ type: 'enum', enum: LoyaltyTransactionSource })
  source!: LoyaltyTransactionSource;

  @Column({ type: 'int' })
  points!: number;

  @Column({ type: 'int', unsigned: true, name: 'balance_after' })
  balanceAfter!: number;

  @Column({ type: 'varchar', length: 191, nullable: true, name: 'reference_id' })
  referenceId?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  description?: string;

  @ManyToOne(() => User, (user) => user.loyaltyTransactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
