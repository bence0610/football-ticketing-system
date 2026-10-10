import { ApiProperty } from '@nestjs/swagger';
import { TicketSource, TicketStatus } from '../../../database/entities';

export class MatchSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  homeTeam!: string;

  @ApiProperty()
  awayTeam!: string;

  @ApiProperty()
  venue!: string;

  @ApiProperty({ type: String })
  kickoffAt!: string;
}

export class SeatSummaryDto {
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

export class TicketResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: TicketStatus })
  status!: TicketStatus;

  @ApiProperty({ enum: TicketSource })
  source!: TicketSource;

  @ApiProperty({ example: '5500.00' })
  pricePaid!: string;

  @ApiProperty({ example: 'HUF' })
  currency!: string;

  @ApiProperty()
  match!: MatchSummaryDto;

  @ApiProperty()
  seat!: SeatSummaryDto;

  @ApiProperty({ type: String, required: false })
  scannedAt?: string;

  @ApiProperty({ type: String, required: false })
  expiredAt?: string;

  @ApiProperty({ type: String, required: false })
  usedAt?: string;
}

export class TicketQrResponseDto {
  @ApiProperty()
  ticketId!: string;

  @ApiProperty()
  dataUrl!: string;

  @ApiProperty({ description: 'The signed JWT token encoded inside the QR image' })
  token!: string;
}
