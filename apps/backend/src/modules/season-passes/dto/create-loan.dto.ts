import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLoanDto {
  @ApiProperty({ description: 'Match identifier the loan applies to.' })
  @IsString({ message: 'A mérkőzés-azonosítónak szöveg típusúnak kell lennie.' })
  @IsNotEmpty({ message: 'A mérkőzés-azonosító megadása kötelező.' })
  @IsUUID('4', { message: 'Érvénytelen mérkőzés-azonosító.' })
  matchId!: string;

  @ApiProperty({ description: 'Email address of the borrower.' })
  @IsEmail({}, { message: 'Érvényes e-mail-cím szükséges a kölcsönzéshez (pl. nev@pelda.hu).' })
  borrowerEmail!: string;
}

export class CancelLoanDto {
  @ApiProperty({ required: false, example: 'Mégsem tudok jönni' })
  @IsOptional()
  @IsString({ message: 'A visszavonás indoka szöveg típusú érték legyen.' })
  reason?: string;
}
