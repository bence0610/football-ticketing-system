import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { IsAccountPassword } from './password.decorator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'A levélben kapott link titkos kódja.' })
  @IsString({ message: 'A visszaállító kód szöveg legyen.' })
  @MinLength(16, { message: 'A visszaállító kód érvénytelen.' })
  @MaxLength(128, { message: 'A visszaállító kód érvénytelen.' })
  token!: string;

  @ApiProperty({
    example: 'StrongPass123',
    description: 'Min. 8 karakter, legalább egy szám és egy betű (mint a regisztrációnál).',
  })
  @IsAccountPassword()
  password!: string;
}

export class PasswordResetDoneDto {
  @ApiProperty()
  message!: string;
}
