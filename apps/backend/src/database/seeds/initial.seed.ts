import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Match, MatchStatus, Competition } from '../entities/match.entity';
import { Seat, SeatCategory } from '../entities/seat.entity';
import { SeasonPassPrice } from '../entities/season-pass-price.entity';
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
  const seasonPassPriceRepo = dataSource.getRepository(SeasonPassPrice);

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

  // 4. Mark past-season matches as FINISHED (idempotent housekeeping).
  // The previous season's NB1 fixtures (e.g. KTE vs Ferencvárosi TC on 2026-07-05)
  // are kept for historical reference but moved to FINISHED so they no longer
  // appear in the on-sale listings.
  const pastSeasonMatches = await matchRepo.find({
    where: [{ homeTeam: 'Kecskeméti TE', awayTeam: 'Ferencvárosi TC' }],
  });
  for (const past of pastSeasonMatches) {
    if (past.status !== MatchStatus.FINISHED) {
      past.status = MatchStatus.FINISHED;
      await matchRepo.save(past);
      logger.log(`Marked past-season match as finished: ${past.homeTeam} vs ${past.awayTeam}`);
    }
  }

  // 5. Upcoming friendly matches (pre-season July 2026)
  const totalCapacity = await seatRepo.count({ where: { isActive: true } });

  interface FriendlyBlueprint {
    homeTeam: string;
    awayTeam: string;
    competition: Competition;
    venue: string;
    kickoffAt: Date;
    basePrice: string;
    description: string;
  }

  // Budapest local time is CEST (UTC+2) in July => subtract 2 hours for UTC.
  const upcomingMatches: FriendlyBlueprint[] = [
    {
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Újpest FC',
      competition: Competition.FRIENDLY,
      venue: 'Széktói Stadion, Kecskemét',
      // 2026-07-12 (Saturday) 18:00 local => 16:00 UTC
      kickoffAt: new Date('2026-07-12T16:00:00.000Z'),
      basePrice: '3500.00',
      description:
        'Felkészülési mérkőzés. KTE vs Újpest FC — nyári előszezoni teszt a Széktói Stadionban.',
    },
    {
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Paksi FC',
      competition: Competition.FRIENDLY,
      venue: 'Széktói Stadion, Kecskemét',
      // 2026-07-26 (Sunday) 17:00 local => 15:00 UTC
      kickoffAt: new Date('2026-07-26T15:00:00.000Z'),
      basePrice: '3000.00',
      description:
        'Felkészülési mérkőzés. KTE vs Paksi FC — utolsó főpróba a bajnoki rajt előtt.',
    },
  ];

  for (const blueprint of upcomingMatches) {
    const existing = await matchRepo.findOne({
      where: {
        homeTeam: blueprint.homeTeam,
        awayTeam: blueprint.awayTeam,
        kickoffAt: blueprint.kickoffAt,
      },
    });
    if (existing) {
      logger.log(
        `Friendly already present: ${blueprint.homeTeam} vs ${blueprint.awayTeam} at ${blueprint.kickoffAt.toISOString()}, skipping.`,
      );
      continue;
    }

    const match = matchRepo.create({
      id: randomUUID(),
      homeTeam: blueprint.homeTeam,
      awayTeam: blueprint.awayTeam,
      competition: blueprint.competition,
      venue: blueprint.venue,
      kickoffAt: blueprint.kickoffAt,
      status: MatchStatus.ON_SALE,
      capacity: totalCapacity,
      basePrice: blueprint.basePrice,
      description: blueprint.description,
      isSeasonPassEligible: false,
    });
    await matchRepo.save(match);
    logger.log(
      `Created friendly: ${blueprint.homeTeam} vs ${blueprint.awayTeam} at ${blueprint.kickoffAt.toISOString()}`,
    );
  }

  // 6. Season pass prices for 2026/2027 (idempotent per (section, seasonLabel))
  interface SeasonPassPriceBlueprint {
    section: string;
    sectionLabel: string;
    price: number;
  }

  const SEASON_LABEL = '2026/2027';
  const SEASON_VALID_FROM = new Date('2026-07-01T00:00:00.000Z');
  const SEASON_VALID_UNTIL = new Date('2027-06-30T00:00:00.000Z');

  const seasonPassPriceBlueprints: SeasonPassPriceBlueprint[] = [
    { section: 'VIP', sectionLabel: 'VIP szektor', price: 45000 },
    { section: 'A', sectionLabel: 'A szektor', price: 30000 },
    { section: 'B', sectionLabel: 'B szektor', price: 25000 },
    { section: 'C', sectionLabel: 'C szektor', price: 20000 },
  ];

  for (const blueprint of seasonPassPriceBlueprints) {
    const existing = await seasonPassPriceRepo.findOne({
      where: { section: blueprint.section, seasonLabel: SEASON_LABEL },
    });
    if (existing) {
      logger.log(
        `Season pass price already present: ${blueprint.section} ${SEASON_LABEL}, skipping.`,
      );
      continue;
    }
    const row = seasonPassPriceRepo.create({
      id: randomUUID(),
      section: blueprint.section,
      sectionLabel: blueprint.sectionLabel,
      seasonLabel: SEASON_LABEL,
      price: blueprint.price,
      currency: 'HUF',
      validFrom: SEASON_VALID_FROM,
      validUntil: SEASON_VALID_UNTIL,
      isActive: true,
    });
    await seasonPassPriceRepo.save(row);
    logger.log(
      `Created season pass price: ${blueprint.section} ${SEASON_LABEL} = ${blueprint.price} HUF`,
    );
  }
}
