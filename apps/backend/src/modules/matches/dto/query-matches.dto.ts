import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MatchStatus } from '../../../database/entities';

export class QueryMatchesDto {
  @ApiPropertyOptional({
    enum: MatchStatus,
    description:
      'Szűrés meccs státuszra (scheduled, on_sale, sold_out, postponed, cancelled, finished).',
  })
  @IsOptional()
  @IsEnum(MatchStatus)
  status?: MatchStatus;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Csak a megadott dátum után kezdődő meccsek (ISO 8601).',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Csak a megadott dátum előtt kezdődő meccsek (ISO 8601).',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 100,
    default: 50,
    description: 'Visszaadott elemek maximális száma.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
