import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RevenueDailyPointDto {
  @ApiProperty({ format: 'date', example: '2026-04-21' })
  date!: string;

  @ApiProperty({ description: 'Aznap értékesített jegyek bevétele HUF-ban' })
  amount!: number;

  @ApiProperty({ description: 'Aznap értékesített jegyek darabszáma' })
  ticketCount!: number;
}

export class RevenueByMatchDto {
  @ApiProperty() matchId!: string;
  @ApiProperty() homeTeam!: string;
  @ApiProperty() awayTeam!: string;
  @ApiProperty({ format: 'date-time' }) kickoffAt!: string;
  @ApiProperty() ticketCount!: number;
  @ApiProperty({ description: 'Bevétel HUF-ban' }) revenue!: number;
}

export class RevenueSummaryDto {
  @ApiProperty({ description: 'Mai bevétel HUF-ban' })
  todayRevenue!: number;

  @ApiProperty({ description: 'Aktuális hónap bevétele HUF-ban' })
  monthRevenue!: number;

  @ApiProperty({ description: 'Mai értékesített jegyek darabszáma' })
  todayTicketCount!: number;

  @ApiProperty({ description: 'Aktuális hónap értékesített jegyek darabszáma' })
  monthTicketCount!: number;

  @ApiPropertyOptional({ type: RevenueByMatchDto, description: 'Legtöbb bevételt termelő meccs' })
  topMatch?: RevenueByMatchDto;
}

export class RevenueStatsDto {
  @ApiProperty({ type: RevenueSummaryDto })
  summary!: RevenueSummaryDto;

  @ApiProperty({
    type: [RevenueDailyPointDto],
    description: 'Napi bevétel idősor (utolsó 30 nap alapértelmezetten)',
  })
  daily!: RevenueDailyPointDto[];

  @ApiProperty({
    type: [RevenueByMatchDto],
    description: 'Bevétel meccs szerinti bontásban (top 10)',
  })
  byMatch!: RevenueByMatchDto[];
}
