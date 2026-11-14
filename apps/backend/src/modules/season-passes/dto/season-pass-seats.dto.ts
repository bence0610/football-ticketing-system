import { ApiProperty } from '@nestjs/swagger';
import { SeatCategory } from '../../../database/entities';
import type { PassSeatStatus } from '../season-pass-seat-rule';

/** One sector of a price tier, counted by the season-pass seat rule. */
export class SeasonPassSectorDto {
  @ApiProperty({ example: 'D/1' })
  section!: string;

  @ApiProperty({ example: 'D/1 szektor' })
  name!: string;

  @ApiProperty({ enum: ['upper', 'lower'], nullable: true })
  arc!: 'upper' | 'lower' | null;

  @ApiProperty({ example: 1, nullable: true, description: 'Helye az íven (nyugatról keletre).' })
  position!: number | null;

  @ApiProperty({ example: 2, nullable: true, description: 'A szektort kiszolgáló kapu (1-4).' })
  gate!: number | null;

  @ApiProperty({ example: true })
  covered!: boolean;

  @ApiProperty({ example: 216, description: 'A szektor aktív helyeinek száma.' })
  total!: number;

  @ApiProperty({
    example: 180,
    description:
      'Erre a szezonra bérletre még kiadható helyek (a vásárlás szabályával: aktív hely, nem vendégszektor, és nincs rá bérletsor ebben a szezonban, bármilyen állapotban). Az egyes meccsekre eladott jegyek nem számítanak.',
  })
  freeSeats!: number;
}

export class SeasonPassTierSectorsDto {
  @ApiProperty({ enum: ['vip', 'upper', 'lower'] })
  tier!: 'vip' | 'upper' | 'lower';

  @ApiProperty({ example: '2026/2027' })
  seasonLabel!: string;

  @ApiProperty({ example: 30000, description: 'A bérlet ára ebben az árkategóriában.' })
  price!: number;

  @ApiProperty({ type: [SeasonPassSectorDto], description: 'Stadionsorrendben, vendégszektor nélkül.' })
  sectors!: SeasonPassSectorDto[];
}

export class SeasonPassSeatDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'D/1' })
  section!: string;

  @ApiProperty({ example: '3' })
  row!: string;

  @ApiProperty({ example: 14 })
  number!: number;

  @ApiProperty({ enum: SeatCategory })
  category!: SeatCategory;

  @ApiProperty({ example: 30000, description: 'Az árkategória bérletára (minden helyen ugyanaz).' })
  price!: number;

  @ApiProperty({
    enum: ['available', 'season_pass', 'locked', 'disabled', 'ticketed'],
    description:
      '`available` választható; `season_pass` erre a szezonra már bérlet szól rá; `locked` egy másik vásárló épp fizet érte; `disabled` nem értékesíthető hely.',
  })
  status!: PassSeatStatus;

  @ApiProperty()
  isAccessible!: boolean;
}

export class SeasonPassSeatMapDto {
  @ApiProperty({ example: 'D/1' })
  section!: string;

  @ApiProperty({ example: 'D/1 szektor' })
  name!: string;

  @ApiProperty({ enum: ['upper', 'lower'], nullable: true })
  arc!: 'upper' | 'lower' | null;

  @ApiProperty({ example: 2, nullable: true })
  gate!: number | null;

  @ApiProperty()
  covered!: boolean;

  @ApiProperty({ enum: ['vip', 'upper', 'lower'] })
  tier!: 'vip' | 'upper' | 'lower';

  @ApiProperty({ example: 30000, description: 'Az árkategória bérletára.' })
  price!: number;

  @ApiProperty({ example: '2026/2027' })
  seasonLabel!: string;

  @ApiProperty({ type: [Number], example: [9], description: 'Ezek után a székszámok után van lépcső (folyosó).' })
  aisles!: number[];

  @ApiProperty({ example: 12, description: 'A leghosszabb egymás melletti választható sor hossza.' })
  longestRun!: number;

  @ApiProperty({ type: [SeasonPassSeatDto] })
  seats!: SeasonPassSeatDto[];
}

export class SeasonPassHoldResponseDto {
  @ApiProperty({ format: 'uuid' })
  seatId!: string;

  @ApiProperty({ description: 'A foglalás azonosítója: a vásárlásnál és a feloldásnál kell megadni.' })
  holdToken!: string;

  @ApiProperty({ example: 900 })
  ttlSeconds!: number;

  @ApiProperty({ example: '2026-11-14T10:15:00.000Z' })
  expiresAt!: string;
}
