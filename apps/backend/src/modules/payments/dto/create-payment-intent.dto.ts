import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class PaymentIntentSeatDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  seatId!: string;

  @ApiProperty({
    description:
      'A `POST /matches/:matchId/seats/:seatId/lock` válaszában kapott ownerToken — szerveroldalon ellenőrizzük, hogy még mindig a hívóé a szék.',
  })
  @IsString()
  ownerToken!: string;
}

/** Most seats one purchase may contain; also quoted to visitors by the chatbot. */
export const MAX_SEATS_PER_ORDER = 6;

export class CreatePaymentIntentDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  matchId!: string;

  @ApiProperty({ type: [PaymentIntentSeatDto], minItems: 1, maxItems: MAX_SEATS_PER_ORDER })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEATS_PER_ORDER)
  @ValidateNested({ each: true })
  @Type(() => PaymentIntentSeatDto)
  seats!: PaymentIntentSeatDto[];
}
