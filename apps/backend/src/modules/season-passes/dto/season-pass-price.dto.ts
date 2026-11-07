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
}
