import { ApiProperty } from '@nestjs/swagger';
import { PassLoanStatus, SeasonPassStatus } from '../../../database/entities';

export class PassLoanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: PassLoanStatus })
  status!: PassLoanStatus;

  @ApiProperty()
  borrowerEmail!: string;

  @ApiProperty({ required: false })
  borrowerUserId?: string;

  @ApiProperty()
  matchId!: string;

  @ApiProperty({ required: false })
  matchTitle?: string;

  @ApiProperty({ required: false, type: String })
  kickoffAt?: string;

  @ApiProperty({ type: String })
  expiresAt!: string;

  @ApiProperty({ type: String })
  createdAt!: string;

  @ApiProperty({ type: String, required: false })
  acceptedAt?: string;

  @ApiProperty({ type: String, required: false })
  cancelledAt?: string;

  @ApiProperty({ type: String, required: false })
  completedAt?: string;
}

export class SeasonPassResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: SeasonPassStatus })
  status!: SeasonPassStatus;

  @ApiProperty({ example: '2026/2027' })
  seasonLabel!: string;

  @ApiProperty({ type: String })
  validFrom!: string;

  @ApiProperty({ type: String })
  validUntil!: string;

  @ApiProperty({ required: false })
  seatLabel?: string;

  @ApiProperty({
    required: false,
    description: 'A szektor azonosítója, ha a bérlethez konkrét szék tartozik.',
  })
  section?: string;

  @ApiProperty({
    type: String,
    description: 'A bérlet vásárlásának dátuma (createdAt).',
  })
  purchasedAt!: string;

  @ApiProperty({ required: false, description: 'Fizetett ár forintban.' })
  pricePaid?: string;

  @ApiProperty({ required: false, default: 'HUF' })
  currency?: string;

  @ApiProperty({ type: () => [PassLoanResponseDto] })
  loans!: PassLoanResponseDto[];
}

export class LoanPreviewDto {
  @ApiProperty({ description: 'Mérkőzés neve (hazai – vendég)' })
  matchTitle!: string;

  @ApiProperty({ description: 'Helyszín neve' })
  matchVenue!: string;

  @ApiProperty({ description: 'Mérkőzés kezdési időpontja ISO 8601 formában' })
  kickoffAt!: string;

  @ApiProperty({ description: 'Szektor azonosítója' })
  seatSection!: string;

  @ApiProperty({ description: 'Sor száma / jele' })
  seatRow!: string;

  @ApiProperty({ description: 'Szék száma', type: Number })
  seatNumber!: number;

  @ApiProperty({ description: 'A kölcsönadó neve (keresztnév + vezetéknév)' })
  lenderName!: string;

  @ApiProperty({ description: 'Meghívó érvényessége (ISO 8601)' })
  expiresAt!: string;
}
