import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmEmailVerificationDto {
  @ApiProperty({ description: 'A megerősítő levélben kapott link titkos kódja.' })
  @IsString({ message: 'A megerősítő kód szöveg legyen.' })
  @MinLength(16, { message: 'A megerősítő kód érvénytelen.' })
  @MaxLength(128, { message: 'A megerősítő kód érvénytelen.' })
  token!: string;
}

export class EmailVerifiedDto {
  @ApiProperty()
  message!: string;

  @ApiProperty({ example: 'fan@kte.hu', description: 'A megerősített e-mail-cím.' })
  email!: string;
}

export class VerificationResentDto {
  @ApiProperty()
  message!: string;

  @ApiProperty({ description: 'Igaz, ha a cím már meg volt erősítve (új levél nem ment).' })
  alreadyVerified!: boolean;
}
