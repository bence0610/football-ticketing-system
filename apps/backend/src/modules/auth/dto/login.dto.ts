import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsWithinBcryptLimit, PASSWORD_BYTES_AT_LOGIN_MESSAGE } from './password.decorator';

export class LoginDto {
  @ApiProperty({ example: 'fan@kte.hu' })
  @IsEmail({}, { message: 'Érvényes e-mail-cím szükséges (pl. nev@pelda.hu).' })
  @MaxLength(255, { message: 'Az e-mail-cím legfeljebb 255 karakter lehet.' })
  email!: string;

  @ApiProperty({ example: 'StrongPass123' })
  @IsString({ message: 'A jelszó szöveg típusú érték legyen.' })
  @MinLength(8, { message: 'A jelszónak legalább 8 karakteresnek kell lennie.' })
  // Over 72 bytes bcrypt would compare only a prefix: refuse instead, and say how to recover.
  @IsWithinBcryptLimit({ message: PASSWORD_BYTES_AT_LOGIN_MESSAGE })
  password!: string;
}
