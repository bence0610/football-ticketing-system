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

  @ApiProperty({
    required: false,
    description: 'A kölcsönvevő neve, ha van fiókja; nélküle csak az e-mail-cím ismert.',
  })
  borrowerName?: string;

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

  @ApiProperty({
    type: String,
    description:
      'Az első lefedett pillanat (a validFrom nap kezdete a stadion időzónájában). Ezzel kell a mérkőzések kezdését összevetni.',
  })
  coversFrom!: string;

  @ApiProperty({
    type: String,
    description:
      'Az első NEM lefedett pillanat (a validUntil utáni nap kezdete a stadion időzónájában, kizáró határ): az utolsó nap egésze érvényes.',
  })
  coversBefore!: string;

  @ApiProperty({ description: 'A birtokos (a széken ülő személy) neve.' })
  holderName!: string;

  @ApiProperty({ description: 'Igaz, ha a bejelentkezett felhasználó a vásárló.' })
  isBuyer!: boolean;

  @ApiProperty({ description: 'Igaz, ha a bejelentkezett felhasználó a birtokos (fiókkal).' })
  isHolder!: boolean;

  @ApiProperty({
    required: false,
    description: 'A vásárló neve, ha nem a bejelentkezett felhasználó.',
  })
  buyerName?: string;

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

  @ApiProperty({ description: 'A kölcsönadó neve (vezetéknév + keresztnév)' })
  lenderName!: string;

  @ApiProperty({ description: 'Meghívó érvényessége (ISO 8601)' })
  expiresAt!: string;
}

export class IncomingLoanDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    description:
      'A meghívó titkos kódja: az /loans/accept/:token oldalra visz. Csak a címzettnek adjuk ki.',
  })
  invitationToken!: string;

  @ApiProperty({ description: 'A kölcsönadó neve' })
  lenderName!: string;

  @ApiProperty({ description: 'Mérkőzés neve (hazai – vendég)' })
  matchTitle!: string;

  @ApiProperty({ type: String })
  kickoffAt!: string;

  @ApiProperty({ description: 'Szektor azonosítója' })
  seatSection!: string;

  @ApiProperty({ description: 'Sor száma / jele' })
  seatRow!: string;

  @ApiProperty({ type: Number })
  seatNumber!: number;

  @ApiProperty({ type: String, description: 'Eddig fogadható el (ISO 8601)' })
  expiresAt!: string;
}
