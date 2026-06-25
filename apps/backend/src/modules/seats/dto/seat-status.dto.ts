import { ApiProperty } from '@nestjs/swagger';
import { SeatCategory } from '../../../database/entities';

export enum SeatAvailability {
  AVAILABLE = 'available',
  LOCKED = 'locked',
  SOLD = 'sold',
  SEASON_PASS = 'season_pass',
  DISABLED = 'disabled',
}

/**
 * Real-time seat status for a given match. The `status` field merges
 * the persistent ticket state (sold / disabled) with the volatile
 * Redis lock state (locked).
 */
export class SeatStatusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'A' })
  section!: string;

  @ApiProperty({ example: '3' })
  row!: string;

  @ApiProperty({ example: 14 })
  number!: number;

  @ApiProperty({ enum: SeatCategory })
  category!: SeatCategory;

  @ApiProperty({ example: 6750, description: 'Effektív ár (basePrice * priceModifier).' })
  price!: number;

  @ApiProperty({ enum: SeatAvailability })
  status!: SeatAvailability;

  @ApiProperty({ description: 'Igaz, ha a szék mozgáskorlátozott számára van fenntartva.' })
  isAccessible!: boolean;
}
