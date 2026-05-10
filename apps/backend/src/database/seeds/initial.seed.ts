import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Match, MatchStatus, Competition } from '../entities/match.entity';
import { Seat, SeatCategory } from '../entities/seat.entity';
import { User, UserRole, LoyaltyTier } from '../entities/user.entity';

const logger = new Logger('InitialSeed');

interface SeatBlueprint {
  section: string;
  rows: string[];
  seatsPerRow: number;
  category: SeatCategory;
  priceModifier: string;
  accessibleRows?: string[];
}

const STADIUM_LAYOUT: SeatBlueprint[] = [
  {
    section: 'A',
    rows: ['1', '2', '3', '4', '5'],
    seatsPerRow: 20,
    category: SeatCategory.PREMIUM,
    priceModifier: '1.50',
    accessibleRows: ['1'],
  },
  {
    section: 'B',
    rows: ['1', '2', '3', '4', '5', '6', '7', '8'],
    seatsPerRow: 25,
    category: SeatCategory.STANDARD,
    priceModifier: '1.00',
  },
  {
    section: 'C',
    rows: ['1', '2', '3', '4', '5', '6', '7', '8'],
    seatsPerRow: 25,
    category: SeatCategory.STANDARD,
    priceModifier: '1.00',
  },
  {
    section: 'VIP',
    rows: ['1', '2'],
    seatsPerRow: 12,
    category: SeatCategory.VIP,
    priceModifier: '2.50',
  },
];

export async function runInitialSeed(dataSource: DataSource): Promise<void> {
  const matchRepo = dataSource.getRepository(Match);
  const seatRepo = dataSource.getRepository(Seat);
  const userRepo = dataSource.getRepository(User);

  // 1. Admin user
  const existingAdmin = await userRepo.findOne({ where: { email: 'admin@kte.hu' } });
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('Admin123!', 12);
    const admin = userRepo.create({
      id: randomUUID(),
      email: 'admin@kte.hu',
      passwordHash,
      firstName: 'Admin',
      lastName: 'KTE',
      role: UserRole.SUPER_ADMIN,
      loyaltyTier: LoyaltyTier.PLATINUM,
      emailVerified: true,
      isActive: true,
    });
    await userRepo.save(admin);
    logger.log('Created admin@kte.hu (password: Admin123!)');
  } else {
    logger.log('Admin user already exists, skipping.');
  }

  // 2. Demo fan user
  const existingFan = await userRepo.findOne({ where: { email: 'fan@kte.hu' } });
  if (!existingFan) {
    const passwordHash = await bcrypt.hash('Fan12345!', 12);
    const fan = userRepo.create({
      id: randomUUID(),
      email: 'fan@kte.hu',
      passwordHash,
      firstName: 'Demo',
      lastName: 'Szurkolo',
      role: UserRole.FAN,
      emailVerified: true,
      isActive: true,
    });
    await userRepo.save(fan);
    logger.log('Created fan@kte.hu (password: Fan12345!)');
  }

  // 3. Seats (idempotent)
  const seatCount = await seatRepo.count();
  if (seatCount === 0) {
    const seatsToInsert: Seat[] = [];
    for (const blueprint of STADIUM_LAYOUT) {
      for (const row of blueprint.rows) {
        for (let n = 1; n <= blueprint.seatsPerRow; n += 1) {
          seatsToInsert.push(
            seatRepo.create({
              id: randomUUID(),
              section: blueprint.section,
              row,
              number: n,
              category: blueprint.category,
              priceModifier: blueprint.priceModifier,
              isAccessible: blueprint.accessibleRows?.includes(row) ?? false,
              isActive: true,
            }),
          );
        }
      }
    }
    await seatRepo.save(seatsToInsert, { chunk: 200 });
    logger.log(`Inserted ${seatsToInsert.length} seats across ${STADIUM_LAYOUT.length} sections.`);
  } else {
    logger.log(`Seats already present (${seatCount}), skipping seat seed.`);
  }

  // 4. Demo match
  const existingMatch = await matchRepo.findOne({
    where: { homeTeam: 'Kecskeméti TE', awayTeam: 'Ferencvárosi TC' },
  });
  if (!existingMatch) {
    const totalCapacity = await seatRepo.count({ where: { isActive: true } });
    // Budapest local time 19:00 on 2026-07-05 (UTC+2 in summer => 17:00 UTC)
    const kickoff = new Date('2026-07-05T17:00:00.000Z');

    const match = matchRepo.create({
      id: randomUUID(),
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Ferencvárosi TC',
      competition: Competition.NB1,
      venue: 'Széktói Stadion, Kecskemét',
      kickoffAt: kickoff,
      status: MatchStatus.ON_SALE,
      capacity: totalCapacity,
      basePrice: '4500.00',
      description:
        'NB1 hazai mérkőzés. KTE vs Ferencváros — szezon kiemelt találkozója a Széktói Stadionban.',
      isSeasonPassEligible: true,
    });
    await matchRepo.save(match);
    logger.log(`Created seed match: KTE vs FTC at ${kickoff.toISOString()}`);
  } else {
    logger.log('Seed match already present, skipping.');
  }
}
