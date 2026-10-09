import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';

/**
 * Stripe webhook endpoint. Mounted at `/api/webhooks/stripe` so the raw-body
 * middleware (registered in `main.ts` for this exact path) preserves the body
 * for signature verification.
 *
 * This is the ONLY Stripe webhook endpoint; it delegates verification and
 * event handling to {@link PaymentsService}, which is also responsible for
 * creating the Ticket rows on `payment_intent.succeeded`.
 */
@ApiExcludeController()
@Controller('webhooks/stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest<Request> & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true }> {
    const rawBody = req.rawBody ?? (req.body as Buffer | undefined);
    if (!rawBody) {
      this.logger.error('Stripe webhook: missing raw body (check main.ts middleware).');
      throw new BadRequestException('Raw body not available for Stripe webhook.');
    }

    const event = this.paymentsService.constructEvent(rawBody, signature);
    this.logger.log(`Received Stripe event ${event.id} (${event.type})`);
    await this.paymentsService.handleEvent(event);
    return { received: true };
  }
}
