import { ApiProperty } from '@nestjs/swagger';

export class SeasonHomeMatchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Újpest FC' })
  awayTeam!: string;

  @ApiProperty({ example: '2026-08-15T16:00:00.000Z' })
  kickoffAt!: string;

  @ApiProperty({ example: 'on_sale' })
  status!: string;
}

export class SeasonOverviewDto {
  @ApiProperty({ example: '2026/2027' })
  seasonLabel!: string;

  @ApiProperty({
    example: 500,
    description: 'A bérletvásárlásért járó hűségpont (LOYALTY_SEASON_PASS_POINTS).',
  })
  loyaltyPoints!: number;

  @ApiProperty({
    type: [SeasonHomeMatchDto],
    description:
      'A szezon hazai mérkőzései, amelyekre a bérlet érvényes (nem törölt, bérletre jogosító, az érvényességi időn belüli).',
  })
  homeMatches!: SeasonHomeMatchDto[];
}
