import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PurchaseSeasonPassDto {
  @ApiProperty({
    example: 'upper',
    description:
      'A vásárolt árkategória azonosítója (megegyezik a `season_pass_prices.section` mezővel: `vip`, `lower`, `upper`). A választott hely szektorának ebbe az árkategóriába kell tartoznia.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  sectionId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'A vevő által a bérlet-helytérképen választott szék.',
  })
  @IsUUID('all', { message: 'Érvényes helyazonosító szükséges.' })
  seatId!: string;

  @ApiProperty({
    description:
      'A `POST /season-passes/seats/:seatId/hold` által visszaadott foglalási azonosító.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  holdToken!: string;

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
