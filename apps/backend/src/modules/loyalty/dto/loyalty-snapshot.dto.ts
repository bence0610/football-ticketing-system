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

  @ApiProperty({ example: 1000 })
  minPoints!: number;

  @ApiProperty({ example: 10 })
  discountPercent!: number;

  @ApiProperty({ example: '#FFD700' })
  color!: string;
}

export class LoyaltyTransactionMatchDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ example: 'Kecskeméti TE' })
  homeTeam!: string;

  @ApiProperty({ example: 'Diósgyőri VTK' })
  awayTeam!: string;

  @ApiProperty({ format: 'date-time' })
  kickoffAt!: string;
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
    example: 'match:7c1e…:9a2f…',
    description:
      'Reference of the event that earned the points (internal; the UI never shows it). (source, referenceId) is unique, so one event can never be credited twice.',
  })
  referenceId?: string;

  @ApiProperty({
    required: false,
    type: () => LoyaltyTransactionMatchDto,
    description:
      'The match the row belongs to (attendance, an old ticket purchase, a loan), when there is one.',
  })
  match?: LoyaltyTransactionMatchDto;

  @ApiProperty({ type: String })
  createdAt!: string;
}

export class LoyaltyEarningRulesDto {
  @ApiProperty({ example: 100 })
  registrationPoints!: number;

  @ApiProperty({ example: 50 })
  profileCompletionPoints!: number;

  @ApiProperty({
    example: 50,
    description:
      'Points for entering a match (LOYALTY_ATTENDANCE_POINTS): once per person per match, with a ticket, a pass entry or a borrowed entry.',
  })
  attendancePoints!: number;

  @ApiProperty({
    example: 500,
    description:
      "The season-pass points go to the pass holder's account (not the buyer); a pass for a holder without an account credits nobody.",
  })
  seasonPassPoints!: number;

  @ApiProperty({ example: 25 })
  passLoanPoints!: number;

  @ApiProperty({
    example: 50,
    description: 'Percent of the balance kept at the season-end conversion.',
  })
  carryoverPercent!: number;

  @ApiProperty({
    example: 2,
    description:
      'The tier discount applies to at most this many tickets per buyer per match, counting the ones already bought for it; further tickets are full price.',
  })
  discountTicketLimit!: number;
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
    example: '2028-06-30',
    required: false,
    description:
      'Present while the tier is kept without the points to match it: the last day it is kept.',
  })
  tierKeptUntil?: string;

  @ApiProperty({
    example: 835,
    required: false,
    description: 'With tierKeptUntil: how many points the balance is short of the kept tier.',
  })
  pointsToKeepTier?: number;

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
