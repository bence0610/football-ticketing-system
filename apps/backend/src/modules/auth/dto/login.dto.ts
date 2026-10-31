import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'fan@kte.hu' })
  @IsEmail({}, { message: 'Érvényes e-mail-cím szükséges (pl. nev@pelda.hu).' })
  @MaxLength(255, { message: 'Az e-mail-cím legfeljebb 255 karakter lehet.' })
  email!: string;

  @ApiProperty({ example: 'StrongPass123' })
  @IsString({ message: 'A jelszó szöveg típusú érték legyen.' })
  @MinLength(8, { message: 'A jelszónak legalább 8 karakteresnek kell lennie.' })
  @MaxLength(72, { message: 'A jelszó legfeljebb 72 karakter lehet.' })
  password!: string;
}
