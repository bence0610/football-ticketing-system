import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmEmailChangeDto {
  @ApiProperty({ description: 'A megerősítő levélben kapott link titkos kódja.' })
  @IsString({ message: 'A megerősítő kód szöveg legyen.' })
  @MinLength(16, { message: 'A megerősítő kód érvénytelen.' })
  @MaxLength(128, { message: 'A megerősítő kód érvénytelen.' })
  token!: string;
}

export class EmailChangeConfirmedDto {
  @ApiProperty()
  message!: string;

  @ApiProperty({ example: 'uj.cim@pelda.hu', description: 'A fiók új e-mail-címe.' })
  email!: string;
}
