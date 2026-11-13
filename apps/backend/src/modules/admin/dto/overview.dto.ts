import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const OVERVIEW_PERIODS = ['season', '90d', '30d'] as const;
export type OverviewPeriod = (typeof OVERVIEW_PERIODS)[number];

export class OverviewSeasonDto {
  @ApiProperty({ example: '2026/2027' }) label!: string;
  @ApiProperty({ format: 'date' }) validFrom!: string;
  @ApiProperty({ format: 'date' }) validUntil!: string;
}

export class OverviewMatchDto {
  @ApiProperty() matchId!: string;
  @ApiProperty() homeTeam!: string;
  @ApiProperty() awayTeam!: string;
  @ApiProperty({ format: 'date-time' }) kickoffAt!: string;
  @ApiProperty() status!: string;
  @ApiProperty({
    description: 'False while the match is still ahead: sales, and so the figures, can still move.',
  })
  final!: boolean;
  @ApiProperty({ description: 'Single tickets sold (paid or used).' }) ticketCount!: number;
  @ApiProperty({ description: 'Season-pass and loan entries issued for the match.' })
  passEntryCount!: number;
  @ApiProperty({ description: 'Seats taken: tickets plus seats held by an active pass.' })
  occupiedSeats!: number;
  @ApiProperty() capacity!: number;
  @ApiProperty({ description: '0..100' }) occupancyPercent!: number;
  @ApiProperty({ description: 'HUF actually charged (sum of ticket.pricePaid).' })
  revenue!: number;
}

export class OverviewMetricsDto {
  @ApiProperty({ description: 'HUF actually charged for the matches in the period.' })
  revenue!: number;
  @ApiProperty() ticketsSold!: number;
  @ApiProperty() passEntries!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Mean occupancy of the final matches, 0..100; null when there are none.',
  })
  averageOccupancyPercent!: number | null;
  @ApiProperty() finalMatchCount!: number;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Scanned share of the single tickets of matches already played; null if none.',
  })
  redemptionPercent!: number | null;
  @ApiProperty() scannedTickets!: number;
  @ApiProperty({ description: 'Single tickets of matches already played.' })
  playedTickets!: number;
}

export class OverviewDto {
  @ApiPropertyOptional({ type: OverviewSeasonDto, nullable: true })
  season!: OverviewSeasonDto | null;
  @ApiProperty({ enum: OVERVIEW_PERIODS }) period!: OverviewPeriod;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ type: OverviewMetricsDto }) metrics!: OverviewMetricsDto;
  @ApiProperty({ type: [OverviewMatchDto] }) matches!: OverviewMatchDto[];
}

export class SeatSaleDto {
  @ApiProperty() section!: string;
  @ApiProperty() row!: string;
  @ApiProperty() number!: number;
  @ApiProperty({ description: 'Played matches this seat was taken for.' }) taken!: number;
}

export class SeatSalesDto {
  @ApiPropertyOptional({ type: OverviewSeasonDto, nullable: true })
  season!: OverviewSeasonDto | null;
  @ApiProperty({ format: 'date-time' }) generatedAt!: string;
  @ApiProperty({ description: 'Matches played in the season; the denominator of every seat.' })
  matchCount!: number;
  @ApiProperty({ type: [SeatSaleDto] }) seats!: SeatSaleDto[];
}
