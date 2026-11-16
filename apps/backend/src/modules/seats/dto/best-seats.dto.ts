import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SeatStatusDto } from './seat-status.dto';

/** The most seats one request may ask for: the cart holds six tickets. */
export const MAX_BEST_SEATS = 6;

export class BestSeatsRequestDto {
  @ApiProperty({ example: 'C/2', description: 'A szektor kódja. A vendégszektor nem kérhető.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  section!: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: MAX_BEST_SEATS, description: 'Hányan vannak.' })
  @IsInt()
  @Min(1)
  @Max(MAX_BEST_SEATS)
  count!: number;

  @ApiPropertyOptional({
    default: false,
    description:
      'Igaz: ha nincs elég hosszú összefüggő sor, két rövidebb sort is elfogad (és zárol). Hamis: ilyenkor 409 `no_adjacent_run` válasz érkezik, benne a felajánlható megoldással.',
  })
  @IsOptional()
  @IsBoolean()
  allowSplit?: boolean;
}

export class SeatRunDto {
  @ApiProperty({ example: '3' })
  row!: string;

  @ApiProperty({
    type: [SeatStatusDto],
    description: 'Egymás melletti székek, szám szerint növekvő sorrendben.',
  })
  seats!: SeatStatusDto[];
}

export class BestSeatsResponseDto {
  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiProperty({ example: 'C/2' })
  section!: string;

  @ApiProperty({
    enum: ['together', 'split'],
    description:
      '`together`: egy összefüggő sor. `split`: két külön sor (csak `allowSplit` esetén).',
  })
  kind!: 'together' | 'split';

  @ApiProperty({ type: [SeatRunDto] })
  runs!: SeatRunDto[];

  @ApiProperty({
    description:
      'Mind a zárolt székhez ugyanez a token tartozik; a feloldás székenként ezzel történik.',
  })
  ownerToken!: string;

  @ApiProperty()
  ttlSeconds!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;
}
