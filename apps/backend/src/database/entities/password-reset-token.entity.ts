import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * A password-reset link, in the same shape as a pass invitation: a long random
 * token travels in the emailed URL and is single use with an expiry.
 *
 * Unlike an invitation, only a SHA-256 hash of the token is stored. Anyone who
 * can read this table (a backup, a leaked dump) must not be able to take over an
 * account with it. The token is 48 random characters, so a plain hash (no salt,
 * no work factor) is enough: there is nothing to brute-force.
 */
@Entity({ name: 'password_reset_tokens' })
@Index('IDX_password_reset_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_password_reset_tokens_user', ['userId'])
export class PasswordResetToken extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** SHA-256 (hex) of the emailed token. The token itself is never stored. */
  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  /**
   * SHA-256 (hex) of the user's password hash at the moment the link was
   * issued. If the password changes any other way before the link is used, the
   * fingerprint no longer matches and the link is refused.
   */
  @Column({ type: 'varchar', length: 64, name: 'password_fingerprint' })
  passwordFingerprint!: string;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expiresAt!: Date;

  /** Set when the link is used, or superseded by a newer request. */
  @Column({ type: 'timestamp', nullable: true, name: 'used_at' })
  usedAt?: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
