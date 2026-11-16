import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  IsWithinBcryptLimit,
  PASSWORD_BYTES_AT_LOGIN_MESSAGE,
} from '../../auth/dto/password.decorator';

export class RequestEmailChangeDto {
  @ApiProperty({
    example: 'uj.cim@pelda.hu',
    description: 'Az új e-mail-cím (kisbetűsítve, szóközök nélkül tároljuk).',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'Érvényes e-mail-cím szükséges (pl. nev@pelda.hu).' })
  @MaxLength(255, { message: 'Az e-mail-cím legfeljebb 255 karakter lehet.' })
  newEmail!: string;

  @ApiProperty({ description: 'A jelenlegi jelszó: a cím módosításához újra meg kell adni.' })
  @IsString({ message: 'A jelenlegi jelszó szöveg típusú érték legyen.' })
  @IsNotEmpty({ message: 'Add meg a jelenlegi jelszavad.' })
  @IsWithinBcryptLimit({ message: PASSWORD_BYTES_AT_LOGIN_MESSAGE })
  currentPassword!: string;
}

export class EmailChangeRequestedDto {
  @ApiProperty()
  message!: string;

  @ApiProperty({
    example: 'uj.cim@pelda.hu',
    description: 'A megerősítésre váró új cím. A fiók címe a megerősítésig nem változik.',
  })
  pendingEmail!: string;
}
