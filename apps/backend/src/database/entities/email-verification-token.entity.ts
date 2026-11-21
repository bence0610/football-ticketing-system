import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * The link that proves a registrant owns the address they gave. Same shape as PasswordResetToken
 * (the one-time token mechanism of the password reset): a long random token (nanoid(48)) travels
 * only in the emailed URL, only its SHA-256 hash is stored, and the link is single use with an
 * expiry.
 *
 * Instead of the password fingerprint it carries the address it was issued for: if the account's
 * address changed since (an e-mail change), the link no longer proves anything about the new
 * address and is refused.
 */
@Entity({ name: 'email_verification_tokens' })
@Index('IDX_email_verification_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_email_verification_tokens_user', ['userId'])
export class EmailVerificationToken extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** SHA-256 (hex) of the emailed token. The token itself is never stored. */
  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  /** The address the link was sent to (lower case). */
  @Column({ type: 'varchar', length: 255, name: 'email' })
  email!: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  /** Set when the link is used, or superseded by a newer one. */
  @Column({ type: 'timestamp', nullable: true, name: 'used_at' })
  usedAt?: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
