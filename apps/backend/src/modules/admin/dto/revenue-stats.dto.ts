import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SeasonPassTierRevenueDto } from './overview.dto';

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

export class SeasonPassDailyPointDto {
  @ApiProperty({ format: 'date', example: '2026-07-04' }) date!: string;
  @ApiProperty({ description: 'Aznap megvásárolt bérletek bevétele HUF-ban' }) amount!: number;
  @ApiProperty({ description: 'Aznap megvásárolt bérletek darabszáma' }) passCount!: number;
}

/**
 * Bérletbevétel, a meccsjegy-bevételtől külön. A bérlet egyetlen fizetés egy egész
 * szezonra, ezért nem osztjuk szét meccsekre: sem a `summary`, sem a `daily`, sem a
 * `byMatch` nem tartalmazza.
 */
export class SeasonPassRevenueDto {
  @ApiProperty({ description: 'Ma megvásárolt bérletek bevétele HUF-ban' }) todayRevenue!: number;
  @ApiProperty({ description: 'Az aktuális hónapban megvásárolt bérletek bevétele HUF-ban' }) monthRevenue!: number;
  @ApiProperty() todayPassCount!: number;
  @ApiProperty() monthPassCount!: number;
  @ApiProperty({ type: [SeasonPassDailyPointDto], description: 'Napi bérletbevétel (vásárlás napja szerint), ugyanazon az időablakon, mint a `daily`' })
  daily!: SeasonPassDailyPointDto[];
  @ApiProperty({ type: [SeasonPassTierRevenueDto], description: 'Összes (aktív vagy lejárt) bérlet árkategóriánként, minden szezonra' })
  byTier!: SeasonPassTierRevenueDto[];
}

export class RevenueStatsDto {
  @ApiProperty({ type: RevenueSummaryDto, description: 'Csak meccsjegyek (PAID + USED, egyedi jegyek); bérlet nélkül' })
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

  @ApiProperty({ type: SeasonPassRevenueDto, description: 'Bérletbevétel, külön a meccsjegyektől; nincs meccsekre szétosztva' })
  seasonPasses!: SeasonPassRevenueDto;
}
