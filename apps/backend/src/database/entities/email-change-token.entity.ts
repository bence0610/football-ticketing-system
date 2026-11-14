import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.entity';
import { User } from './user.entity';

/**
 * A pending change of a user's e-mail address, confirmed by a link sent to the
 * NEW address. Same shape as PasswordResetToken: a long random token
 * (nanoid(48)) travels only in the emailed URL, only its SHA-256 hash is
 * stored, and the link is single use with an expiry.
 *
 * The address on the account does not change until this link is opened: the
 * e-mail is the login id and the password-reset address, so a typo or a
 * hijacker who got into a session must not be able to move it somewhere the
 * owner cannot reach.
 */
@Entity({ name: 'email_change_tokens' })
@Index('IDX_email_change_tokens_hash', ['tokenHash'], { unique: true })
@Index('idx_email_change_tokens_user', ['userId'])
export class EmailChangeToken extends BaseEntity {
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId!: string;

  /** The requested address, trimmed and lowercased. */
  @Column({ type: 'varchar', length: 255, name: 'new_email' })
  newEmail!: string;

  /** SHA-256 (hex) of the emailed token. The token itself is never stored. */
  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash!: string;

  /**
   * SHA-256 (hex) of the user's password hash when the change was requested.
   * A password change (or reset) before confirmation voids the request.
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
