import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PurchaseSeasonPassDto {
  @ApiProperty({
    example: 'A',
    description:
      'A vásárolt szektor azonosítója (megegyezik a `season_pass_prices.section` mezővel).',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  sectionId!: string;

  @ApiProperty({
    example: 'pm_card_visa',
    description:
      'Stripe PaymentMethod azonosító (kliens oldalon a Payment Element állítja elő).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentMethodId?: string;
}
