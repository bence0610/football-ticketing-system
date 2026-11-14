import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { compare, hash } from 'bcrypt';
import { DataSource, IsNull } from 'typeorm';
import { JwtConfig } from '../../config';
import { PasswordResetToken, User } from '../../database/entities';
import {
  CurrentPasswordVerifier,
  PASSWORD_CHANGE_BUDGET,
} from '../users/current-password.verifier';
import { AuthService } from './auth.service';
import { ClientInfo } from './client-info';
import { AuthResponseDto } from './dto';
import { PasswordResetService } from './password-reset.service';
import { RefreshTokenStore } from './refresh-token.store';

/**
 * Changing the password while signed in (profile page).
 *
 * It ends the same way as a reset - outstanding reset links are void, every
 * refresh token of the account is revoked, the owner is mailed - with one
 * difference: the session that made the change gets a fresh token pair, so it
 * stays signed in while every other session loses its refresh token. Their
 * access tokens stay valid until they expire on their own (15 minutes by
 * default); access tokens are stateless and cannot be recalled.
 *
 * E-mail change requests made with the old password are void too: their
 * password fingerprint no longer matches (EmailChangeService).
 */
@Injectable()
export class PasswordChangeService {
  private readonly logger = new Logger(PasswordChangeService.name);
  private readonly jwtConfig: JwtConfig;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    configService: ConfigService,
    private readonly passwordVerifier: CurrentPasswordVerifier,
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
    private readonly refreshStore: RefreshTokenStore,
  ) {
    this.jwtConfig = configService.getOrThrow<JwtConfig>('jwt');
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    client?: ClientInfo,
  ): Promise<AuthResponseDto> {
    const user = await this.passwordVerifier.verify(
      userId,
      currentPassword,
      PASSWORD_CHANGE_BUDGET,
    );
    if (await compare(newPassword, user.passwordHash)) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Az új jelszó nem lehet ugyanaz, mint a jelenlegi.',
        code: 'password_unchanged',
      });
    }

    const passwordHash = await hash(newPassword, this.jwtConfig.bcryptRounds);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      // Compare-and-swap on the hash that was just checked: if another change
      // (a reset, a second tab) landed in between, nothing is overwritten.
      const changed = await manager
        .getRepository(User)
        .update({ id: user.id, passwordHash: user.passwordHash }, { passwordHash });
      if (changed.affected !== 1) {
        throw new ConflictException({
          statusCode: 409,
          message: 'A jelszavad közben megváltozott. Töltsd újra az oldalt, és próbáld újra.',
          code: 'password_changed_concurrently',
        });
      }
      // Reset links issued for the old password are void now.
      await manager
        .getRepository(PasswordResetToken)
        .update({ userId: user.id, usedAt: IsNull() }, { usedAt: now });
    });

    // Every session loses its refresh token, exactly like after a reset ...
    await this.refreshStore.revokeAll(user.id);
    // ... and then this one gets a new pair (issued after revokeAll, so it survives).
    user.passwordHash = passwordHash;
    const session = await this.authService.issueSession(user);
    this.logger.log(`Password changed (signed in) for user=${user.id}`);

    void this.passwordReset
      .notifyPasswordChanged(user, now, client, 'settings')
      .catch((error: Error) => {
        this.logger.error(
          `Password-changed notification FAILED for user=${user.id}: ${error.message}`,
        );
      });

    return session;
  }
}
