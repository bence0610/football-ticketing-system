import { ApiProperty } from '@nestjs/swagger';

export class SeasonPassPriceDto {
  @ApiProperty({
    example: 'upper',
    description:
      'Az árkategória azonosítója (`vip`, `lower`, `upper`): a bérlet árkategóriára szól, a hely kiosztása vásárláskor történik.',
  })
  sectionId!: string;

  @ApiProperty({ example: 'Felső ív' })
  sectionName!: string;

  @ApiProperty({ example: 30000 })
  price!: number;

  @ApiProperty({ example: 'HUF' })
  currency!: string;

  @ApiProperty({ example: '2026/2027' })
  seasonLabel!: string;

  @ApiProperty({ example: '2026-08-01', description: 'A bérlet érvényességének első napja.' })
  validFrom!: string;

  @ApiProperty({ example: '2027-06-30', description: 'A bérlet érvényességének utolsó napja.' })
  validUntil!: string;

  @ApiProperty({
    example: 120,
    description:
      'Ebben az árkategóriában jelenleg kiadható bérletes helyek száma (ugyanazzal a szabállyal, mint a vásárlásnál).',
  })
  freeSeats!: number;

  @ApiProperty({ example: 200, description: 'Az árkategória aktív helyeinek száma.' })
  totalSeats!: number;

  @ApiProperty({ example: 12, description: 'Az erre a szezonra kiadott aktív bérletek száma.' })
  passesSold!: number;

  @ApiProperty({
    example: true,
    nullable: true,
    description: 'Fedett-e a kategória minden szektora; null, ha vegyes vagy nincs szektor-adat.',
  })
  isCovered!: boolean | null;

  @ApiProperty({
    nullable: true,
    enum: ['vip', 'upper', 'lower'],
    description: 'Árkategória (megegyezik a `sectionId`-val).',
  })
  priceCategory!: 'vip' | 'upper' | 'lower' | null;

  @ApiProperty({
    nullable: true,
    enum: ['upper', 'lower'],
    description: 'Az ív, ha a kategória egyetlen ívre esik.',
  })
  arc!: 'upper' | 'lower' | null;

  @ApiProperty({ nullable: true, example: 1, description: 'Mindig null: a bérlet árkategóriára szól, nem szektorra.' })
  position!: number | null;

  @ApiProperty({ nullable: true, example: 2, description: 'A bejárat (1-4), ha a kategória minden szektorát ugyanaz a kapu szolgálja ki; különben null.' })
  gate!: number | null;

  @ApiProperty({
    example: 15,
    description: 'A még le nem játszott, bérlettel látogatható hazai mérkőzések száma.',
  })
  upcomingHomeMatches!: number;

  @ApiProperty({
    example: 94500,
    nullable: true,
    description:
      'Ennyibe kerülne ugyanez a hely a hátralévő hazai meccsekre egyenként megvéve. ' +
      'null, ha a kategória helyeinek árszorzója nem egységes, vagy nincs hátralévő meccs.',
  })
  singleMatchTotal!: number | null;
}
