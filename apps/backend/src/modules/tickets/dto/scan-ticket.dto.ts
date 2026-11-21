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

  @ApiProperty({ description: 'A szektor megjelenített neve ("D/1 szektor", "VIP").' })
  sectorName!: string;

  @ApiProperty({
    nullable: true,
    example: 3,
    description: 'A szektort kiszolgáló bejárat (1-4); null, ha nincs adat.',
  })
  gate!: number | null;

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

  @ApiProperty({
    enum: [
      'ok',
      'already_used',
      'invalid',
      'expired',
      'wrong_match',
      'match_cancelled',
      'match_postponed',
      'not_today',
    ],
    description:
      '`not_today`: the ticket is for a match whose scan window (a few hours before kickoff until 4 hours after) is not open now; the ticket stays unused. `match_postponed`: the match is postponed.',
  })
  result!:
    | 'ok'
    | 'already_used'
    | 'invalid'
    | 'expired'
    | 'wrong_match'
    | 'match_cancelled'
    | 'match_postponed'
    | 'not_today';

  @ApiProperty({ required: false })
  ticketId?: string;

  @ApiProperty({ required: false })
  scannedAt?: string;

  @ApiProperty({ required: false })
  message?: string;

  @ApiProperty({ required: false, description: 'Ticket source: single | season_pass | loan' })
  source?: string;

  @ApiProperty({
    required: false,
    description:
      'A belépő személy neve: bérletnél a birtokos, kölcsönzésnél a kölcsönvevő, egyébként a jegy tulajdonosa.',
  })
  holderName?: string;

  @ApiProperty({ required: false, type: ScanMatchInfoDto })
  match?: ScanMatchInfoDto;

  @ApiProperty({ required: false, type: ScanSeatInfoDto })
  seat?: ScanSeatInfoDto;
}
