import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SlidingWindowLimiter } from '../../common/rate-limit/sliding-window.limiter';
import {
  EmailVerificationToken,
  LoyaltyTransaction,
  PasswordResetToken,
  User,
} from '../../database/entities';
import { EmailModule } from '../email/email.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { EmailVerificationController } from './email-verification.controller';
import { EmailVerificationService } from './email-verification.service';
import { PasswordChangeService } from './password-change.service';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { RefreshTokenStore } from './refresh-token.store';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      LoyaltyTransaction,
      PasswordResetToken,
      EmailVerificationToken,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // secrets passed per-call in AuthService
    ConfigModule,
    UsersModule,
    EmailModule,
  ],
  controllers: [AuthController, PasswordResetController, EmailVerificationController],
  providers: [
    AuthService,
    PasswordResetService,
    EmailVerificationService,
    PasswordChangeService,
    SlidingWindowLimiter,
    JwtStrategy,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
    RefreshTokenStore,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    OptionalJwtAuthGuard,
    RolesGuard,
    RefreshTokenStore,
    JwtStrategy,
    PassportModule,
  ],
})
export class AuthModule {}
