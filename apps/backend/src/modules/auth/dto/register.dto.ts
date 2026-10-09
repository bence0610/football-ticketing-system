import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'fan@kte.hu' })
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'StrongPass123',
    description: 'Min. 8 karakter, legalább egy szám és egy betű.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(/(?=.*[A-Za-z])(?=.*\d).+/, {
    message: 'A jelszó tartalmazzon legalább egy betűt és egy számot.',
  })
  password!: string;

  @ApiProperty({ example: 'Kovács' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Béla' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: '+36301234567', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phoneNumber?: string;
}
