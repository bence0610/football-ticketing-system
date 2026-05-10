import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ConfirmPaymentDto {
  @ApiProperty({
    description: 'A Stripe által visszaadott PaymentIntent azonosítója (pl. `pi_3PA...`).',
    example: 'pi_3PA1234567890abcdefg',
  })
  @IsString()
  @Matches(/^pi_[A-Za-z0-9]+$/, {
    message: 'Érvénytelen Stripe PaymentIntent azonosító.',
  })
  paymentIntentId!: string;
}

export class ConfirmPaymentResponseDto {
  @ApiProperty({
    description:
      'true, ha a webhook már korábban feldolgozta a fizetést — ilyenkor új jegy nem jött létre, csak a meglévőek azonosítóit adjuk vissza.',
  })
  alreadyProcessed!: boolean;

  @ApiProperty({
    type: [String],
    description: 'A PaymentIntenthez tartozó összes Ticket azonosítója.',
  })
  ticketIds!: string[];
}
