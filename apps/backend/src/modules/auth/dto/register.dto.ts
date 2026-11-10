import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IsAccountPassword } from './password.decorator';

export class RegisterDto {
  @ApiProperty({ example: 'fan@kte.hu' })
  @IsEmail({}, { message: 'Érvényes e-mail-cím szükséges (pl. nev@pelda.hu).' })
  @MaxLength(255, { message: 'Az e-mail-cím legfeljebb 255 karakter lehet.' })
  email!: string;

  @ApiProperty({
    example: 'StrongPass123',
    description: 'Min. 8 karakter, legalább egy szám és egy betű.',
  })
  @IsAccountPassword()
  password!: string;

  @ApiProperty({ example: 'Béla', description: 'Keresztnév' })
  @IsString({ message: 'A keresztnév szöveg típusú érték legyen.' })
  @MinLength(2, { message: 'A keresztnévnek legalább 2 karakteresnek kell lennie.' })
  @MaxLength(100, { message: 'A keresztnév legfeljebb 100 karakter lehet.' })
  firstName!: string;

  @ApiProperty({ example: 'Kovács', description: 'Vezetéknév' })
  @IsString({ message: 'A vezetéknév szöveg típusú érték legyen.' })
  @MinLength(2, { message: 'A vezetéknévnek legalább 2 karakteresnek kell lennie.' })
  @MaxLength(100, { message: 'A vezetéknév legfeljebb 100 karakter lehet.' })
  lastName!: string;

  @ApiProperty({ example: '+36301234567', required: false })
  @IsOptional()
  @IsString({ message: 'A telefonszám szöveg típusú érték legyen.' })
  @MaxLength(32, { message: 'A telefonszám legfeljebb 32 karakter lehet.' })
  phoneNumber?: string;
}
