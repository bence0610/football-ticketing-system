import { ApiProperty } from '@nestjs/swagger';
import {
  LoyaltyTier,
  LoyaltyTransactionSource,
  LoyaltyTransactionType,
} from '../../../database/entities';

export class LoyaltyTierResponseDto {
  @ApiProperty({ enum: LoyaltyTier })
  tier!: LoyaltyTier;

  @ApiProperty({ example: 'Arany' })
  label!: string;

  @ApiProperty({ example: 1500 })
  minPoints!: number;

  @ApiProperty({ example: 10 })
  discountPercent!: number;

  @ApiProperty({ example: '#FFD700' })
  color!: string;
}

export class LoyaltyTransactionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: LoyaltyTransactionType })
  type!: LoyaltyTransactionType;

  @ApiProperty({ enum: LoyaltyTransactionSource })
  source!: LoyaltyTransactionSource;

  @ApiProperty({ example: 50 })
  points!: number;

  @ApiProperty({ example: 250 })
  balanceAfter!: number;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class LoyaltySnapshotResponseDto {
  @ApiProperty({ example: 250 })
  points!: number;

  @ApiProperty({ type: () => LoyaltyTierResponseDto })
  tier!: LoyaltyTierResponseDto;

  @ApiProperty({ type: () => LoyaltyTierResponseDto, required: false })
  nextTier?: LoyaltyTierResponseDto;

  @ApiProperty({ example: 250, required: false })
  pointsToNextTier?: number;

  @ApiProperty({ type: () => [LoyaltyTransactionResponseDto] })
  recentTransactions!: LoyaltyTransactionResponseDto[];
}
