import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoyaltyTier, TicketStatus, UserRole } from '../../../database/entities';

export class ProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'fan@kte.hu' })
  email!: string;

  @ApiProperty({ example: 'Kovács' })
  firstName!: string;

  @ApiProperty({ example: 'Béla' })
  lastName!: string;

  @ApiPropertyOptional({ example: '+36301234567' })
  phoneNumber?: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ enum: LoyaltyTier })
  loyaltyTier!: LoyaltyTier;

  @ApiProperty({ example: 100 })
  loyaltyPoints!: number;

  @ApiProperty({ example: false })
  emailVerified!: boolean;

  @ApiProperty({ example: false })
  twoFactorEnabled!: boolean;

  @ApiPropertyOptional({ format: 'date-time' })
  lastLoginAt?: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ProfileTicketDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiProperty()
  homeTeam!: string;

  @ApiProperty()
  awayTeam!: string;

  @ApiProperty({ format: 'date-time' })
  kickoffAt!: string;

  @ApiProperty()
  venue!: string;

  @ApiProperty()
  section!: string;

  @ApiProperty({ description: 'A szektor megjelenített neve ("D/1 szektor", "VIP").' })
  sectorName!: string;

  @ApiProperty({
    nullable: true,
    example: 3,
    description: 'A szektort kiszolgáló bejárat (1-4); null, ha nincs adat.',
  })
  gate!: number | null;

  @ApiProperty()
  row!: string;

  @ApiProperty()
  seatNumber!: number;

  @ApiProperty()
  category!: string;

  @ApiProperty({ enum: TicketStatus })
  status!: TicketStatus;

  @ApiProperty()
  pricePaid!: number;

  @ApiProperty({ example: 'HUF' })
  currency!: string;

  @ApiProperty()
  qrCode!: string;

  @ApiProperty({ format: 'date-time' })
  purchasedAt!: string;

  @ApiProperty()
  isActive!: boolean;
}

export class ProfileTicketsDto {
  @ApiProperty({ type: [ProfileTicketDto] })
  items!: ProfileTicketDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  offset!: number;
}
