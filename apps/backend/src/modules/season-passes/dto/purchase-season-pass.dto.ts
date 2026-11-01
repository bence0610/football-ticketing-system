import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
    description: 'Stripe PaymentMethod azonosító (kliens oldalon a Payment Element állítja elő).',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  paymentMethodId?: string;

  @ApiProperty({
    required: false,
    example: 'Kovács Anna',
    description:
      'A bérlet birtokosának (aki a széken ül) neve. Elhagyható: ekkor a vásárló a birtokos. ' +
      'Fiók nélküli birtokosnál (pl. gyerek) elég a név.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  holderName?: string;

  @ApiProperty({
    required: false,
    example: 'anna@example.com',
    description:
      'A birtokos regisztrált fiókjának e-mail-címe. Ha megadod, a bérlet a birtokos profiljában is megjelenik.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Érvényes e-mail-cím szükséges a birtokoshoz.' })
  @MaxLength(255)
  holderEmail?: string;
}
