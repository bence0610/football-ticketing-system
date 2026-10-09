import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Seat, Ticket } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { TicketsModule } from '../tickets/tickets.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhookController } from './stripe-webhook.controller';
import { stripeProvider } from './stripe.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([Match, Seat, Ticket]),
    AuthModule,
    LoyaltyModule,
    EmailModule,
    TicketsModule,
  ],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [PaymentsService, stripeProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
