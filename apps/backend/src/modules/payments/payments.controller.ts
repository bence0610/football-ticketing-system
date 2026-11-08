import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  ConfirmPaymentDto,
  ConfirmPaymentResponseDto,
  CreatePaymentIntentDto,
  PaymentIntentResponseDto,
  PaymentStatusResponseDto,
} from './dto';
import { PaymentsService } from './payments.service';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-intent')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Stripe PaymentIntent létrehozása',
    description:
      'Szerveroldalon ellenőrzi, hogy minden szék zárolva van-e a hívó nevére, kiszámolja a végösszeget, és létrehoz egy Stripe PaymentIntentet idempotency kulccsal. A `clientSecret`-tel a frontend Stripe Elements-szel megerősíti a fizetést.',
  })
  @ApiCreatedResponse({ type: PaymentIntentResponseDto })
  async createIntent(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePaymentIntentDto,
  ): Promise<PaymentIntentResponseDto> {
    return this.paymentsService.createPaymentIntent(user.id, dto);
  }

  @Get(':paymentIntentId/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Egy fizetés állapota (megerősítő oldalhoz)',
    description:
      'Csak a hívó saját fizetésére válaszol. `issued`: a jegyek létrejöttek (az összeg és a jóváírt pontok a valós adatbázisból jönnek). `processing`: a Stripe már feldolgozza/feldolgozta a fizetést, de a jegyek még nem készültek el. `failed`: a fizetés nem sikerült.',
  })
  @ApiOkResponse({ type: PaymentStatusResponseDto })
  async getStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentIntentId') paymentIntentId: string,
  ): Promise<PaymentStatusResponseDto> {
    return this.paymentsService.getPaymentStatus(paymentIntentId, user.id);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Sikeres fizetés véglegesítése (frontend-driven fallback)',
    description:
      'A frontend hívja közvetlenül `stripe.confirmPayment()` után, hogy a webhook esetleges késedelmétől függetlenül létrejöjjenek a Ticket rekordok. Idempotens: ha a webhook már feldolgozta ugyanezt a PaymentIntentet, csak az `alreadyProcessed: true` jelzést adja vissza.',
  })
  @ApiOkResponse({ type: ConfirmPaymentResponseDto })
  async confirmPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmPaymentDto,
  ): Promise<ConfirmPaymentResponseDto> {
    return this.paymentsService.confirmPaymentAndCreateTicket(dto.paymentIntentId, user.id);
  }
}
