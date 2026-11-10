import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, MaxLength } from 'class-validator';

export class RequestPasswordResetDto {
  @ApiProperty({ example: 'fan@kte.hu' })
  @IsEmail({}, { message: 'Érvényes e-mail-cím szükséges (pl. nev@pelda.hu).' })
  @MaxLength(255, { message: 'Az e-mail-cím legfeljebb 255 karakter lehet.' })
  email!: string;
}

export class PasswordResetRequestedDto {
  @ApiProperty({
    description:
      'Ugyanaz a válasz, akár létezik a cím, akár nem: a végpont nem árulja el, ki regisztrált.',
  })
  message!: string;
}
