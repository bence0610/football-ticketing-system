import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ScanTicketDto {
  @ApiProperty({ example: 'eyJhbGciOi...' })
  @IsString()
  @MinLength(20)
  token!: string;
}

export class ScanMatchInfoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  homeTeam!: string;

  @ApiProperty()
  awayTeam!: string;

  @ApiProperty()
  venue!: string;

  @ApiProperty()
  kickoffAt!: string;
}

export class ScanSeatInfoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  section!: string;

  @ApiProperty()
  row!: string;

  @ApiProperty()
  number!: number;

  @ApiProperty()
  category!: string;
}

export class TicketScanResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ enum: ['ok', 'already_used', 'invalid', 'expired', 'wrong_match'] })
  result!: 'ok' | 'already_used' | 'invalid' | 'expired' | 'wrong_match';

  @ApiProperty({ required: false })
  ticketId?: string;

  @ApiProperty({ required: false })
  scannedAt?: string;

  @ApiProperty({ required: false })
  message?: string;

  @ApiProperty({ required: false, type: ScanMatchInfoDto })
  match?: ScanMatchInfoDto;

  @ApiProperty({ required: false, type: ScanSeatInfoDto })
  seat?: ScanSeatInfoDto;
}
