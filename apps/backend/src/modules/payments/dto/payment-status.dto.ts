import { ApiProperty } from '@nestjs/swagger';

export type PaymentStatusKind = 'issued' | 'processing' | 'failed';

export class PaymentStatusSeatDto {
  @ApiProperty() section!: string;
  @ApiProperty() row!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ description: 'Amount paid for this ticket (HUF).' }) price!: number;
}

export class PaymentStatusMatchDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() homeTeam!: string;
  @ApiProperty() awayTeam!: string;
  @ApiProperty() venue!: string;
  @ApiProperty({ type: String, format: 'date-time' }) kickoffAt!: string;
}

export class PaymentStatusResponseDto {
  @ApiProperty({
    enum: ['issued', 'processing', 'failed'],
    description:
      '`issued`: tickets exist. `processing`: Stripe has the payment (or is still working on it) but the tickets are not written yet. `failed`: the payment did not go through.',
  })
  status!: PaymentStatusKind;

  @ApiProperty({ type: [String] })
  ticketIds!: string[];

  @ApiProperty({ example: 8312, description: 'Sum of the ticket prices actually paid (HUF). 0 until issued.' })
  amountPaid!: number;

  @ApiProperty({ example: 'huf' })
  currency!: string;

  @ApiProperty({
    example: 100,
    description: 'Loyalty points credited for these tickets, read from the loyalty ledger. 0 until credited.',
  })
  pointsCredited!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When the confirmation email was handed to the mail server, or null while it has not been sent (yet). It is sent shortly AFTER the tickets are issued, so it can still be null right after `issued`. Null means "do not claim an email went out".',
  })
  confirmationEmailSentAt!: string | null;

  @ApiProperty({ type: () => PaymentStatusMatchDto, nullable: true })
  match!: PaymentStatusMatchDto | null;

  @ApiProperty({ type: () => [PaymentStatusSeatDto] })
  seats!: PaymentStatusSeatDto[];
}
