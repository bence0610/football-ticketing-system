import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class JoinWaitlistDto {
  @ApiProperty({ description: 'Meccs azonosítója' })
  @IsUUID()
  matchId!: string;

  @ApiPropertyOptional({ description: 'Igényelt jegyszám', minimum: 1, maximum: 6, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  requestedQuantity?: number;

  @ApiPropertyOptional({ description: 'Preferált szektor (opcionális)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  preferredSection?: string;
}
