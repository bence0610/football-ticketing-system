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

  @ApiProperty({ example: 'magyar_kupa', description: 'NB1 / NB2 / magyar_kupa (a felkészülési meccs nem része a bérletnek).' })
  competition!: string;
}

export class SeasonOverviewDto {
  @ApiProperty({ example: '2026/2027' })
  seasonLabel!: string;

  @ApiProperty({
    example: 500,
    description:
      'A bérletvásárlásért járó hűségpont (LOYALTY_SEASON_PASS_POINTS): a bérlet birtokosának jár, nem a vevőnek; birtokos-fiók nélkül senkinek.',
  })
  loyaltyPoints!: number;

  @ApiProperty({
    type: [SeasonHomeMatchDto],
    description:
      'A szezon hazai bajnoki és Magyar Kupa-mérkőzései, amelyekre a bérlet érvényes (nem törölt, bérletre jogosító, az érvényességi időn belüli); a felkészülési meccs nem tartozik ide.',
  })
  homeMatches!: SeasonHomeMatchDto[];
}
