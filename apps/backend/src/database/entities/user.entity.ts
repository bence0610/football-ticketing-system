import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from './base.entity';
import { Ticket } from './ticket.entity';
import { SeasonPass } from './season-pass.entity';
import { LoyaltyTransaction } from './loyalty-transaction.entity';
import { Waitlist } from './waitlist.entity';

export enum UserRole {
  FAN = 'fan',
  GATE = 'gate',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin',
}

export enum LoyaltyTier {
  BRONZE = 'bronze',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

@Entity({ name: 'users' })
@Index('idx_users_email', ['email'], { unique: true })
export class User extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  email!: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100, name: 'first_name' })
  firstName!: string;

  @Column({ type: 'varchar', length: 100, name: 'last_name' })
  lastName!: string;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'phone_number' })
  phoneNumber?: string;

  @Column({ type: 'date', nullable: true, name: 'date_of_birth' })
  dateOfBirth?: Date;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.FAN })
  role!: UserRole;

  @Column({ type: 'enum', enum: LoyaltyTier, default: LoyaltyTier.BRONZE, name: 'loyalty_tier' })
  loyaltyTier!: LoyaltyTier;

  @Column({ type: 'int', unsigned: true, default: 0, name: 'loyalty_points' })
  loyaltyPoints!: number;

  @Column({ type: 'boolean', default: false, name: 'email_verified' })
  emailVerified!: boolean;

  @Column({ type: 'boolean', default: false, name: 'two_factor_enabled' })
  twoFactorEnabled!: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'two_factor_secret' })
  twoFactorSecret?: string;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login_at' })
  lastLoginAt?: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'profile_completed_at' })
  profileCompletedAt?: Date;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive!: boolean;

  @OneToMany(() => Ticket, (ticket) => ticket.user)
  tickets?: Ticket[];

  @OneToMany(() => SeasonPass, (pass) => pass.user)
  seasonPasses?: SeasonPass[];

  @OneToMany(() => LoyaltyTransaction, (tx) => tx.user)
  loyaltyTransactions?: LoyaltyTransaction[];

  @OneToMany(() => Waitlist, (entry) => entry.user)
  waitlistEntries?: Waitlist[];
}
