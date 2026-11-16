import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SectorOccupancyDto {
  @ApiProperty({ description: 'Szektor azonosító (pl. A-Tribün, B, K1)' }) section!: string;
  @ApiProperty({ description: 'Összes szék a szektorban' }) total!: number;
  @ApiProperty({ description: 'Eladott jegyek (paid + pending)' }) sold!: number;
  @ApiProperty({ description: 'Aktív Redis foglalások a szektorban' }) locked!: number;
  @ApiProperty({ description: 'Szabad helyek (total - sold - locked)' }) available!: number;
  @ApiProperty({ description: 'Foglaltsági arány 0..100' }) occupancyPercent!: number;
}

export class MatchOccupancyDto {
  @ApiProperty() matchId!: string;
  @ApiProperty() homeTeam!: string;
  @ApiProperty() awayTeam!: string;
  @ApiProperty({ format: 'date-time' }) kickoffAt!: string;
  @ApiProperty() venue!: string;

  @ApiProperty({ description: 'Értékesíthető székek (a vendégszektor nélkül)' })
  totalCapacity!: number;
  @ApiProperty() totalSold!: number;
  @ApiProperty() totalLocked!: number;
  @ApiProperty() totalAvailable!: number;
  @ApiProperty({ description: 'Foglaltsági arány 0..100' }) occupancyPercent!: number;

  @ApiProperty({ type: [SectorOccupancyDto] }) sectors!: SectorOccupancyDto[];

  @ApiPropertyOptional({ format: 'date-time', description: 'Utolsó frissítés' })
  generatedAt!: string;
}
