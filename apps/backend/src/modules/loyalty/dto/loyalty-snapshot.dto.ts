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

  @ApiProperty({
    required: false,
    example: 'ticket:7c1e…',
    description:
      'Reference of the event that earned the points. (source, referenceId) is unique, so one event can never be credited twice.',
  })
  referenceId?: string;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class LoyaltyEarningRulesDto {
  @ApiProperty({ example: 100 })
  registrationPoints!: number;

  @ApiProperty({ example: 50 })
  profileCompletionPoints!: number;

  @ApiProperty({ example: 50, description: 'Flat points per purchased ticket (not per forint).' })
  ticketPointsPerTicket!: number;

  @ApiProperty({ example: 500 })
  seasonPassPoints!: number;

  @ApiProperty({ example: 25 })
  passLoanPoints!: number;

  @ApiProperty({
    example: 50,
    description: 'Percent of the balance kept at the season-end conversion.',
  })
  carryoverPercent!: number;
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

  @ApiProperty({
    example: 50,
    description: 'Points earned for each ticket bought (LOYALTY_TICKET_POINTS_PER_TICKET).',
  })
  ticketPointsPerTicket!: number;

  @ApiProperty({ type: () => LoyaltyEarningRulesDto })
  earning!: LoyaltyEarningRulesDto;

  @ApiProperty({ example: 4, description: 'Distinct matches entered (a ticket with a gate scan).' })
  matchesAttended!: number;

  @ApiProperty({
    example: 31,
    description: 'Whole ledger size; recentTransactions holds the newest page.',
  })
  totalTransactions!: number;

  @ApiProperty({ type: () => [LoyaltyTransactionResponseDto] })
  recentTransactions!: LoyaltyTransactionResponseDto[];
}
