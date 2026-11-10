import { ApiProperty } from '@nestjs/swagger';

export class SeasonPassPriceDto {
  @ApiProperty({ example: 'A' })
  sectionId!: string;

  @ApiProperty({ example: 'A szektor' })
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
      'Ebben a szektorban jelenleg kiadható bérletes helyek száma (ugyanazzal a szabállyal, mint a vásárlásnál).',
  })
  freeSeats!: number;

  @ApiProperty({ example: 200, description: 'A szektor aktív helyeinek száma.' })
  totalSeats!: number;

  @ApiProperty({ example: 12, description: 'Az erre a szezonra kiadott aktív bérletek száma.' })
  passesSold!: number;

  @ApiProperty({
    example: true,
    nullable: true,
    description: 'Fedett-e a szektor; null, ha nincs szektor-adat.',
  })
  isCovered!: boolean | null;

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
      'null, ha a szektor helyeinek árszorzója nem egységes, vagy nincs hátralévő meccs.',
  })
  singleMatchTotal!: number | null;
}
