import { DataSource, MoreThan } from 'typeorm';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Match, MatchStatus, Competition, isPassEligibleMatch } from '../entities/match.entity';
import { dayNumberOf, wallClockToUtc, weekdayOf } from '../demo/time';
import { Seat } from '../entities/seat.entity';
import { Sector } from '../entities/sector.entity';
import { SeasonPassPrice } from '../entities/season-pass-price.entity';
import { User, UserRole, LoyaltyTier } from '../entities/user.entity';

import {
  SEASON_PASS_TIER_PRICE,
  STADIUM_LAYOUT,
  TIERS,
  TIER_LABEL,
  priceModifierFor,
  seatCategoryFor,
  totalSeatCount,
} from '../stadium-layout';

const logger = new Logger('InitialSeed');

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

  // 3. Gate operator user
  const existingGate = await userRepo.findOne({ where: { email: 'kapu@kte.hu' } });
  if (!existingGate) {
    const passwordHash = await bcrypt.hash('Kapu123!', 12);
    const gate = userRepo.create({
      id: randomUUID(),
      email: 'kapu@kte.hu',
      passwordHash,
      firstName: 'Kapu',
      lastName: 'Operator',
      role: UserRole.GATE,
      emailVerified: true,
      isActive: true,
    });
    await userRepo.save(gate);
    logger.log('Created kapu@kte.hu (password: Kapu123!)');
  } else {
    logger.log('Gate user already exists, skipping.');
  }

  // 4b. Sectors. The StadiumLayout migration inserts them; this only fills in a
  // sector that is missing (idempotent per code, never overwrites a changed value).
  const sectorRepo = dataSource.getRepository(Sector);
  for (const layout of STADIUM_LAYOUT) {
    const existing = await sectorRepo.findOne({ where: { code: layout.code } });
    if (!existing) {
      await sectorRepo.save(
        sectorRepo.create({
          id: randomUUID(),
          code: layout.code,
          name: layout.name,
          isCovered: layout.isCovered,
          arc: layout.arc,
          position: layout.position,
          gate: layout.gate,
          priceCategory: layout.priceCategory,
          isAway: layout.isAway,
        }),
      );
      logger.log(`Created sector ${layout.code} (covered: ${layout.isCovered})`);
    }
  }

  // 5. Seats, generated from the stadium layout (idempotent).
  // A database that already holds seats must hold exactly this layout: a stale one
  // (the old four-sector stadium) is refused, never silently kept.
  const seatCount = await seatRepo.count();
  const expectedSeats = totalSeatCount();
  if (seatCount === 0) {
    const seatsToInsert: Seat[] = [];
    for (const sector of STADIUM_LAYOUT) {
      for (let row = 1; row <= sector.rows; row += 1) {
        for (let n = 1; n <= sector.seatsPerRow; n += 1) {
          seatsToInsert.push(
            seatRepo.create({
              id: randomUUID(),
              section: sector.code,
              row: String(row),
              number: n,
              category: seatCategoryFor(sector.priceCategory),
              priceModifier: priceModifierFor(sector.priceCategory),
              isAccessible: sector.accessibleRows?.includes(String(row)) ?? false,
              isActive: true,
            }),
          );
        }
      }
    }
    // Bulk insert: `save` would look each of the 5,468 rows up first, which is slow.
    for (let i = 0; i < seatsToInsert.length; i += 500) {
      await seatRepo.insert(seatsToInsert.slice(i, i + 500));
    }
    logger.log(`Inserted ${seatsToInsert.length} seats across ${STADIUM_LAYOUT.length} sectors.`);
  } else if (seatCount !== expectedSeats) {
    throw new Error(
      `The database holds ${seatCount} seats but the stadium layout has ${expectedSeats}. ` +
        'Run the StadiumLayout migration (it clears the old seats), then seed again.',
    );
  } else {
    logger.log(`Seats already present (${seatCount}), skipping seat seed.`);
  }

  // 6. Mark past-season matches as FINISHED (idempotent housekeeping).
  // The previous season's fixtures (e.g. KTE vs Diósgyőri VTK) are kept for historical
  // reference but moved to FINISHED so they no longer appear in the on-sale listings.
  const pastSeasonMatches = await matchRepo.find({
    where: [{ homeTeam: 'Kecskeméti TE', awayTeam: 'Diósgyőri VTK' }],
  });
  for (const past of pastSeasonMatches) {
    if (past.status !== MatchStatus.FINISHED) {
      past.status = MatchStatus.FINISHED;
      await matchRepo.save(past);
      logger.log(`Marked past-season match as finished: ${past.homeTeam} vs ${past.awayTeam}`);
    }
  }

  // 7. Upcoming friendly matches (pre-season July 2026)
  // A match's capacity is what it can SELL: the active seats outside the away section, which
  // is never sold here. With the whole stadium as capacity a sold-out match would still show
  // 280 free seats (and the waitlist rule could never trigger).
  const totalCapacity = await seatRepo
    .createQueryBuilder('seat')
    .innerJoin(Sector, 'sector', 'sector.code = seat.section')
    .where('seat.isActive = 1')
    .andWhere('sector.isAway = 0')
    .getCount();
  // Matches created before a layout change carry the old seat count. Away matches have no
  // stock (capacity 0) and are left alone.
  await dataSource
    .createQueryBuilder()
    .update(Match)
    .set({ capacity: totalCapacity })
    .where('capacity != :totalCapacity', { totalCapacity })
    .andWhere('capacity > 0')
    .execute();

  interface FriendlyBlueprint {
    homeTeam: string;
    awayTeam: string;
    competition: Competition;
    venue: string;
    kickoffAt: Date;
    basePrice: string;
    description: string;
  }

  // The friendlies are dated relative to the day the seed runs, so they are always still ahead
  // (fixed dates went stale: two July 2026 friendlies sat in the past with no tickets). The next
  // Saturday at least two weeks away at 18:00, and the Sunday after the one four weeks away at
  // 17:00, Budapest time (the conversion handles summer and winter time).
  const today = dayNumberOf(new Date());
  const onOrAfter = (day: number, weekday: number): number => {
    let d = day;
    while (weekdayOf(d) !== weekday) d += 1;
    return d;
  };
  const upcomingMatches: FriendlyBlueprint[] = [
    {
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Szeged',
      competition: Competition.FRIENDLY,
      venue: 'Széktói Stadion, Kecskemét',
      kickoffAt: wallClockToUtc(onOrAfter(today + 14, 6), 18, 0),
      basePrice: '3500.00',
      description: 'Felkészülési mérkőzés. KTE vs Szeged — előszezoni teszt a Széktói Stadionban.',
    },
    {
      homeTeam: 'Kecskeméti TE',
      awayTeam: 'Szentlőrinc',
      competition: Competition.FRIENDLY,
      venue: 'Széktói Stadion, Kecskemét',
      kickoffAt: wallClockToUtc(onOrAfter(today + 28, 0), 17, 0),
      basePrice: '3000.00',
      description:
        'Felkészülési mérkőzés. KTE vs Szentlőrinc — főpróba a bajnoki mérkőzések előtt.',
    },
  ];

  for (const blueprint of upcomingMatches) {
    // Already there if this fixture has an upcoming friendly. Matching on the exact kickoff would
    // create a new pair on every run now that the dates move; a friendly that has been played
    // does not count, so the seed provides fresh ones once they are over.
    const existing = await matchRepo.findOne({
      where: {
        homeTeam: blueprint.homeTeam,
        awayTeam: blueprint.awayTeam,
        competition: Competition.FRIENDLY,
        kickoffAt: MoreThan(new Date()),
      },
    });
    if (existing) {
      logger.log(
        `Friendly already present: ${blueprint.homeTeam} vs ${blueprint.awayTeam} at ${existing.kickoffAt.toISOString()}, skipping.`,
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
      // By the one rule (a friendly is not covered by the pass).
      isSeasonPassEligible: isPassEligibleMatch(blueprint.competition, true),
    });
    await matchRepo.save(match);
    logger.log(
      `Created friendly: ${blueprint.homeTeam} vs ${blueprint.awayTeam} at ${blueprint.kickoffAt.toISOString()}`,
    );
  }

  // 8. Season pass prices for 2026/2027 (idempotent per (section, seasonLabel))
  const SEASON_LABEL = '2026/2027';
  const SEASON_VALID_FROM = new Date('2026-07-01T00:00:00.000Z');
  const SEASON_VALID_UNTIL = new Date('2027-06-30T00:00:00.000Z');

  // One row per price tier, not per sector: a pass is bought for the whole upper
  // arc, the whole lower arc or VIP, and the purchase picks the seat inside it.
  // The row's `section` carries the tier key. The away section has no row.
  const seasonPassPriceBlueprints = TIERS.map((tier) => ({
    section: tier,
    sectionLabel: TIER_LABEL[tier],
    price: SEASON_PASS_TIER_PRICE[tier],
  }));

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
