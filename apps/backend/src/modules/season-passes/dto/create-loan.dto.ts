import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateLoanDto {
  @ApiProperty({ description: 'Match identifier the loan applies to.' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  matchId!: string;

  @ApiProperty({ description: 'Email address of the borrower.' })
  @IsEmail()
  borrowerEmail!: string;
}

export class CancelLoanDto {
  @ApiProperty({ required: false, example: 'Mégsem tudok jönni' })
  @IsOptional()
  @IsString()
  reason?: string;
}
