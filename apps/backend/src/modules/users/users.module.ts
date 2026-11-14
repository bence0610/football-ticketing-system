import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SlidingWindowLimiter } from '../../common/rate-limit/sliding-window.limiter';
import {
  EmailChangeToken,
  PassLoan,
  PasswordResetToken,
  Ticket,
  User,
} from '../../database/entities';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { CurrentPasswordVerifier } from './current-password.verifier';
import { EmailChangeService } from './email-change.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Ticket, EmailChangeToken, PasswordResetToken, PassLoan]),
    LoyaltyModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, CurrentPasswordVerifier, EmailChangeService, SlidingWindowLimiter],
  exports: [UsersService, CurrentPasswordVerifier, EmailChangeService],
})
export class UsersModule {}
