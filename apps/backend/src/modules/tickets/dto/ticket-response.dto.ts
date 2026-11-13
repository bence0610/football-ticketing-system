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

  @ApiProperty({
    required: false,
    description: 'A belépő személy neve (bérletnél a birtokos), a QR mellett megjelenítéshez.',
  })
  holderName?: string;
}
