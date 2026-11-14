import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Digits, spaces, "+", "-" and parentheses, 6-32 characters: "+36 (30) 123-4567". */
export const PHONE_NUMBER_PATTERN = /^[0-9+\-() ]{6,32}$/;

/**
 * The fields a signed-in user may change on their own profile. The e-mail
 * address is deliberately not here: it is the login id and changes only through
 * the confirm-before-effect flow (POST /users/me/email-change).
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Béla', description: 'Keresztnév' })
  @IsOptional()
  @IsString({ message: 'A keresztnév szöveg típusú érték legyen.' })
  @MinLength(2, { message: 'A keresztnévnek legalább 2 karakteresnek kell lennie.' })
  @MaxLength(100, { message: 'A keresztnév legfeljebb 100 karakter lehet.' })
  firstName?: string;

  @ApiPropertyOptional({ example: 'Kovács', description: 'Vezetéknév' })
  @IsOptional()
  @IsString({ message: 'A vezetéknév szöveg típusú érték legyen.' })
  @MinLength(2, { message: 'A vezetéknévnek legalább 2 karakteresnek kell lennie.' })
  @MaxLength(100, { message: 'A vezetéknév legfeljebb 100 karakter lehet.' })
  lastName?: string;

  @ApiPropertyOptional({
    example: '+36 30 123 4567',
    description:
      'Számjegyek, szóköz, "+", "-" és zárójel, 6-32 karakter. Üres szöveg ("") törli a telefonszámot.',
  })
  // "" (and null) clear the number, so the format rule only applies to a real value.
  @ValidateIf(
    (_o: unknown, value: unknown) => value !== '' && value !== null && value !== undefined,
  )
  @IsString({ message: 'A telefonszám szöveg típusú érték legyen.' })
  @Matches(PHONE_NUMBER_PATTERN, {
    message:
      'A telefonszám 6-32 karakter lehet, és csak számjegyet, szóközt, "+", "-" és zárójelet tartalmazhat.',
  })
  phoneNumber?: string | null;

  @ApiPropertyOptional({
    example: '1990-01-15',
    format: 'date',
    nullable: true,
    description: 'null törli a születési dátumot (aki tévesen adta meg).',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'A születési dátum érvényes dátum legyen (ÉÉÉÉ-HH-NN).' })
  dateOfBirth?: Date | null;
}
