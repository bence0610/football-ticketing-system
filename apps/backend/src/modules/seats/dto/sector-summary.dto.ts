import { ApiProperty } from '@nestjs/swagger';

/**
 * Aggregated capacity summary per sector for the stadium map header cards.
 */
export class SectorSummaryDto {
  @ApiProperty({ example: 'D/1' })
  section!: string;

  @ApiProperty({
    example: 'D/1 szektor',
    description: 'Megjelenített név; a kliens ezt írja ki, nem állítja össze.',
  })
  name!: string;

  @ApiProperty({
    nullable: true,
    enum: ['upper', 'lower'],
    description:
      'A stadion melyik ívén van (felső / alsó, főépület oldal). null: nincs szektor-adat.',
  })
  arc!: 'upper' | 'lower' | null;

  @ApiProperty({ nullable: true, example: 1, description: 'Sorrend az íven nyugatról keletre.' })
  position!: number | null;

  @ApiProperty({
    nullable: true,
    example: 2,
    description: 'A szektort kiszolgáló bejárat (1-4). null: nincs adat.',
  })
  gate!: number | null;

  @ApiProperty({
    nullable: true,
    enum: ['vip', 'upper', 'lower'],
    description: 'Árkategória: a felső ív, az alsó ív vagy a VIP. null: a vendégszektor (nincs ára).',
  })
  priceCategory!: 'vip' | 'upper' | 'lower' | null;

  @ApiProperty({
    example: false,
    description: 'Vendégszektor: a portálon keresztül nem vásárolható, bérlet sem váltható rá.',
  })
  isAway!: boolean;

  @ApiProperty({
    nullable: true,
    example: false,
    description:
      'Igaz, ha a szektor fedett (esőben száraz). null: nincs adat a szektorról - ilyenkor semmit nem állítunk a fedettségről.',
  })
  covered!: boolean | null;

  @ApiProperty({ example: 100 })
  total!: number;

  @ApiProperty({ example: 73 })
  available!: number;

  @ApiProperty({ example: 12 })
  locked!: number;

  @ApiProperty({ example: 15 })
  sold!: number;

  @ApiProperty({
    example: 6750,
    description:
      'A szektor legolcsóbb jegyára (Ft) az adott meccsre; ugyanaz az érték, amit a székek `price` mezője és a pénztár használ.',
  })
  minPrice!: number;

  @ApiProperty({ example: 6750, description: 'A szektor legdrágább jegyára (Ft).' })
  maxPrice!: number;

  @ApiProperty({
    example: 0.27,
    description: 'Foglaltsági arány 0..1 között ((locked + sold) / total).',
  })
  occupancyRatio!: number;
}
