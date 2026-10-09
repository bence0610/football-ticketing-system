import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { JwtConfig } from '../../config';
import {
  LoyaltyTier,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
  User,
  UserRole,
} from '../../database/entities';
import { AuthResponseDto, AuthUserDto, LoginDto, RegisterDto } from './dto';
import { RefreshTokenStore } from './refresh-token.store';
import { JwtPayload } from './strategies/jwt.strategy';

interface RefreshPayload extends JwtPayload {
  jti: string;
}

const REGISTRATION_BONUS_POINTS = 100;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtConfig: JwtConfig;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly refreshStore: RefreshTokenStore,
  ) {
    this.jwtConfig = this.configService.getOrThrow<JwtConfig>('jwt');
    this.accessTtlSeconds = parseDurationToSeconds(this.jwtConfig.accessExpiresIn);
    this.refreshTtlSeconds = parseDurationToSeconds(this.jwtConfig.refreshExpiresIn);
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email: normalizedEmail } });
    if (existing) {
      throw new ConflictException('Ez az e-mail cím már regisztrálva van.');
    }

    const passwordHash = await hash(dto.password, this.jwtConfig.bcryptRounds);

    const user = await this.userRepository.manager.transaction(async (em) => {
      const created = em.create(User, {
        email: normalizedEmail,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phoneNumber: dto.phoneNumber?.trim(),
        role: UserRole.FAN,
        loyaltyTier: LoyaltyTier.BRONZE,
        loyaltyPoints: REGISTRATION_BONUS_POINTS,
        emailVerified: false,
        twoFactorEnabled: false,
        isActive: true,
      });
      const saved = await em.save(User, created);

      const loyaltyTx = em.create(LoyaltyTransaction, {
        userId: saved.id,
        type: LoyaltyTransactionType.EARN,
        source: LoyaltyTransactionSource.PROMOTION,
        points: REGISTRATION_BONUS_POINTS,
        balanceAfter: REGISTRATION_BONUS_POINTS,
        description: 'Regisztrációs üdvözlő bónusz',
      });
      await em.save(LoyaltyTransaction, loyaltyTx);
      return saved;
    });

    this.logger.log(`Registered user ${user.id} (${user.email})`);
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email: normalizedEmail } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Hibás e-mail vagy jelszó.');
    }
    const passwordOk = await compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Hibás e-mail vagy jelszó.');
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    return this.buildAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    if (!refreshToken) {
      throw new UnauthorizedException('Hiányzik a refresh token.');
    }
    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.jwtConfig.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Érvénytelen refresh token.');
    }

    const stored = await this.refreshStore.exists(payload.sub, payload.jti);
    if (!stored) {
      throw new UnauthorizedException('Visszavont refresh token.');
    }

    // Rotate: revoke the consumed token before issuing a new pair.
    await this.refreshStore.revoke(payload.sub, payload.jti);

    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('A felhasználói fiók nem aktív.');
    }

    return this.buildAuthResponse(user);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) {
      return;
    }
    try {
      const payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.jwtConfig.refreshSecret,
      });
      await this.refreshStore.revoke(payload.sub, payload.jti);
    } catch {
      // Token invalid or expired — nothing to revoke.
    }
  }

  toAuthUserDto(user: User): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      loyaltyTier: user.loyaltyTier,
      loyaltyPoints: user.loyaltyPoints,
    };
  }

  private async buildAuthResponse(user: User): Promise<AuthResponseDto> {
    const accessToken = await this.signAccessToken(user);
    const { token: refreshToken, jti } = await this.signRefreshToken(user);
    await this.refreshStore.save(user.id, jti, this.refreshTtlSeconds);
    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSeconds,
      user: this.toAuthUserDto(user),
    };
  }

  private signAccessToken(user: User): Promise<string> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    return this.jwtService.signAsync(payload, {
      secret: this.jwtConfig.accessSecret,
      expiresIn: this.jwtConfig.accessExpiresIn,
    });
  }

  private async signRefreshToken(user: User): Promise<{ token: string; jti: string }> {
    const jti = randomUUID();
    const payload: RefreshPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti,
    };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.jwtConfig.refreshSecret,
      expiresIn: this.jwtConfig.refreshExpiresIn,
    });
    return { token, jti };
  }

  /** Used by health/diagnostic endpoints. */
  ping(): { module: string; status: 'ready' } {
    return { module: 'auth', status: 'ready' };
  }
}

/**
 * Parses simple duration strings like "15m", "7d", "3600s", "1h" to seconds.
 * Accepts plain numeric strings as already-seconds.
 */
function parseDurationToSeconds(value: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)([smhd])?$/i);
  if (!match) {
    throw new Error(`Cannot parse duration: ${value}`);
  }
  const amount = parseInt(match[1], 10);
  const unit = (match[2] ?? 's').toLowerCase();
  switch (unit) {
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86400;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
}
