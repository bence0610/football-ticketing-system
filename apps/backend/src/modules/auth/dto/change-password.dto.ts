import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { IsAccountPassword } from './password.decorator';
import { IsWithinBcryptLimit, PASSWORD_BYTES_AT_LOGIN_MESSAGE } from './password.decorator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'A jelenlegi jelszó.' })
  @IsString({ message: 'A jelenlegi jelszó szöveg típusú érték legyen.' })
  @IsNotEmpty({ message: 'Add meg a jelenlegi jelszavad.' })
  @IsWithinBcryptLimit({ message: PASSWORD_BYTES_AT_LOGIN_MESSAGE })
  currentPassword!: string;

  @ApiProperty({
    example: 'StrongPass123',
    description: 'Min. 8 karakter, legalább egy szám és egy betű (mint a regisztrációnál).',
  })
  @IsAccountPassword()
  newPassword!: string;
}
