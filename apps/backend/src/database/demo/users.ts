import { LoyaltyTier, UserRole } from '../entities/user.entity';
import { FEMALE_FIRST_NAMES, LAST_NAMES, MALE_FIRST_NAMES, asciiFold } from './data';
import type { DemoUser, FanClass, ForcedOrder } from './model';
import type { Rng } from './rng';
import { DAY_MS, HOUR_MS } from './time';

export const DEMO_EMAIL_DOMAIN = 'kte-demo.test';
export const DEMO_PASSWORD = 'Demo1234!';

/** Share of the crowd in each habit class. */
const CROWD_MIX: ReadonlyArray<readonly [FanClass, number]> = [
  ['idle', 0.08],
  ['casual', 0.35],
  ['frequent', 0.33],
  ['devoted', 0.2],
  ['regular', 0.04],
];

/** How likely an account is picked for an order, relative to a casual fan. */
export const CLASS_WEIGHT: Readonly<Record<FanClass, number>> = {
  staff: 0,
  idle: 0,
  casual: 1,
  frequent: 7,
  devoted: 38,
  regular: 90,
  scripted: 0,
};

/** Weights for a usual group of 1..6, per class. */
const GROUP_PREF: Readonly<Record<FanClass, readonly number[]>> = {
  staff: [1, 1, 1, 1, 1, 1],
  idle: [25, 38, 12, 17, 3, 5],
  casual: [25, 38, 12, 17, 3, 5],
  frequent: [15, 40, 12, 25, 3, 5],
  devoted: [4, 24, 14, 38, 8, 12],
  regular: [0, 25, 10, 40, 5, 20],
  scripted: [1, 1, 1, 1, 1, 1],
};

interface NamedSpec {
  key: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  fanClass: FanClass;
  createdDaysAgo: number;
  profileDone: boolean;
  forced?: ForcedOrder[];
  expectedTier?: LoyaltyTier;
  purpose: string;
  passHolder?: boolean;
}

const scanned = (matchKey: string, size: number): ForcedOrder => ({
  matchKey,
  size,
  scanned: true,
});
const repeat = (keys: string[], size: number): ForcedOrder[] => keys.map((k) => scanned(k, size));

/**
 * The named demo accounts. Every tier account gets a hand-planned ticket history, sized so
 * it lands in the middle of its tier (see the arithmetic next to each) and cannot drift out
 * of it by a small change elsewhere. The totals are checked after the ledger is replayed.
 */
const NAMED: readonly NamedSpec[] = [
  {
    key: 'admin',
    firstName: 'Eszter',
    lastName: 'Szabó',
    role: UserRole.ADMIN,
    fanClass: 'staff',
    createdDaysAgo: 600,
    profileDone: false,
    purpose:
      'Admin: áttekintő, helytérkép-hőtérkép, bevétel, kihasználtság, jegy- és bérletstatisztika.',
  },
  {
    key: 'kapus',
    firstName: 'Gábor',
    lastName: 'Kovács',
    role: UserRole.GATE,
    fanClass: 'staff',
    createdDaysAgo: 600,
    profileDone: false,
    purpose:
      'Beléptető (kizárólag a kapu képernyő): QR-beolvasás (BELÉPHET / MÁR FELHASZNÁLVA / LEJÁRT / ELMARADT); belépés után a /gate-re kerül, minden más oldal és szurkolói végpont zárt számára.',
  },
  {
    key: 'ures',
    firstName: 'Anna',
    lastName: 'Tóth',
    role: UserRole.FAN,
    fanClass: 'idle',
    createdDaysAgo: 9,
    profileDone: false,
    purpose:
      'Szurkoló, akinek még nincs semmije: üres profil, üres jegylista, regisztrációs pontok.',
  },
  {
    key: 'jegyes',
    firstName: 'Bence',
    lastName: 'Varga',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 120,
    profileDone: true,
    forced: [{ matchKey: 'cur:r17', size: 2 }],
    purpose:
      'Közelgő jeggyel: két jegy a következő hazai meccsre, QR megnyitása, aktív jegyek lap.',
  },
  {
    key: 'hasznalt',
    firstName: 'Péter',
    lastName: 'Nagy',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 200,
    profileDone: true,
    forced: [scanned('cur:r05', 3), scanned('cur:r09', 2)],
    purpose:
      'Felhasznált jeggyel: lejátszott meccsek beolvasott jegyei, "Felhasznált" lap, beolvasás ideje.',
  },
  {
    key: 'berletes',
    firstName: 'István',
    lastName: 'Horváth',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 420,
    profileDone: true,
    passHolder: true,
    purpose:
      'Bérletes: felső ívi bérlet, meccsenkénti QR, korábbi belépések, kölcsönzési meghívó küldése.',
  },
  {
    key: 'kolcsonzo',
    firstName: 'László',
    lastName: 'Molnár',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 520,
    profileDone: true,
    passHolder: true,
    purpose:
      'Bérletes, aki már kölcsönadott egy meccset: lezárt, felhasznált kölcsönzés és a +25 pont.',
  },
  {
    key: 'kolcsonvevo',
    firstName: 'Dávid',
    lastName: 'Farkas',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 90,
    profileDone: true,
    purpose:
      'Kölcsönvevő: elfogadta, majd felhasználta a bérletes belépőjét (kölcsönzött jegy a profilján).',
  },
  {
    key: 'meghivott',
    firstName: 'Zsófia',
    lastName: 'Papp',
    role: UserRole.FAN,
    fanClass: 'idle',
    createdDaysAgo: 30,
    profileDone: false,
    purpose:
      'Függő meghívással: a bérletes kölcsönzési meghívóját még nem fogadta el (elfogadó oldal).',
  },
  {
    key: 'vevo',
    firstName: 'Katalin',
    lastName: 'Németh',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 380,
    profileDone: true,
    purpose: 'Vevő, aki bérletet vett valaki másnak: a bérlet a profilján, a birtokos más személy.',
  },
  {
    key: 'birtokos',
    firstName: 'Máté',
    lastName: 'Németh',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 300,
    profileDone: true,
    passHolder: true,
    purpose:
      'A fenti bérlet birtokosa: saját fiókjából látja és használja a nem általa vett bérletet.',
  },
  {
    // 150 (registration + profile) + 3 tickets x 50 = 300 points: Lila (0-499).
    key: 'lila',
    firstName: 'Réka',
    lastName: 'Juhász',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 45,
    profileDone: true,
    forced: [scanned('cur:r07', 2), scanned('cur:r11', 1)],
    expectedTier: LoyaltyTier.BRONZE,
    purpose: 'Lila szint: a belépő szint, 0% kedvezmény, a következő szintig hátralévő pontok.',
  },
  {
    // Attends 5 matches last season (150 + 250 = 400, 70% kept = 280) and 6 this season (+300): 580, Ezüst (300-999).
    key: 'ezust',
    firstName: 'Tamás',
    lastName: 'Balogh',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 700,
    profileDone: true,
    forced: [
      ...repeat(['cur:r01', 'cur:r03', 'cur:r05', 'cur:r07', 'cur:r09', 'cur:r11'], 2),
      ...repeat(['prev:l02', 'prev:l05', 'prev:l09', 'prev:l11', 'prev:l13'], 2),
    ],
    expectedTier: LoyaltyTier.SILVER,
    purpose:
      'Ezüst szint: 5% kedvezmény látható az árakban, szezonváltáskori pontkonverzió (70% marad) a főkönyvben.',
  },
  {
    // A pass holder who attends most home matches, with a few tickets for friends besides: about 1,700 points, Arany (1000-2499).
    key: 'arany',
    firstName: 'Zoltán',
    lastName: 'Takács',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 760,
    profileDone: true,
    forced: [...repeat(['cur:r05', 'cur:r09', 'prev:l04', 'prev:l08', 'prev:l11'], 2)],
    expectedTier: LoyaltyTier.GOLD,
    purpose: 'Arany szint: 10% kedvezmény, kedvezményes jegyárak a kosárban és a jegyeken.',
  },
  {
    // A supporter since 2022 with a pass of their own in every season, who has been to every home match (a scanned
    // pass entry, the cup ties included): 50 points per match, once, and 500 per pass. Four seasons of that is
    // what reaching KTE Legenda by attending takes.
    key: 'legenda',
    firstName: 'Sándor',
    lastName: 'Lakatos',
    role: UserRole.FAN,
    fanClass: 'scripted',
    createdDaysAgo: 1600,
    profileDone: true,
    forced: [],
    expectedTier: LoyaltyTier.PLATINUM,
    purpose: 'KTE Legenda szint: a legmagasabb szint, 15% kedvezmény, a ranglista tetején.',
  },
];

/** The named accounts in the order they are listed, with what each is good for. */
export const NAMED_ACCOUNTS: ReadonlyArray<{ email: string; purpose: string }> = NAMED.map((n) => ({
  email: `demo-${n.key}@${DEMO_EMAIL_DOMAIN}`,
  purpose: n.purpose,
}));

function pickWeighted<T>(rng: Rng, items: ReadonlyArray<readonly [T, number]>): T {
  return items[rng.weightedIndex(items.map((i) => i[1]))][0];
}

function floorSecond(ms: number): Date {
  return new Date(Math.floor(ms / 1000) * 1000);
}

export interface UserBuildInput {
  now: Date;
  /** First day of the current season. */
  seasonStart: Date;
  crowdSize: number;
}

export function buildUsers(input: UserBuildInput, rng: Rng): DemoUser[] {
  const nowMs = input.now.getTime();
  const seasonStartMs = input.seasonStart.getTime();
  const prevStartMs = seasonStartMs - 365 * DAY_MS;
  const users: DemoUser[] = [];
  const usedEmails = new Set<string>();

  const emailFor = (last: string, first: string, n: number): string => {
    const base = `${asciiFold(last)}.${asciiFold(first)}${String(n).padStart(4, '0')}`;
    return `${base}@${DEMO_EMAIL_DOMAIN}`;
  };

  const profileFor = (
    createdMs: number,
    done: boolean,
  ): Pick<DemoUser, 'phoneNumber' | 'dateOfBirth' | 'profileCompletedAt'> => {
    if (!done) return { phoneNumber: null, dateOfBirth: null, profileCompletedAt: null };
    const age = rng.between(14, 76);
    const dob = new Date(Math.floor((nowMs - age * 365.25 * DAY_MS) / DAY_MS) * DAY_MS);
    const completedMs = Math.min(nowMs - HOUR_MS, createdMs + rng.between(0.2, 25) * DAY_MS);
    return {
      phoneNumber: `+36 ${rng.pick(['20', '30', '70'])} ${rng.int(100, 999)} ${rng.int(1000, 9999)}`,
      dateOfBirth: dob,
      profileCompletedAt: floorSecond(completedMs),
    };
  };

  const loginFor = (createdMs: number): Date | null => {
    if (!rng.chance(0.65)) return null;
    const ms = nowMs - rng.exponential(25) * DAY_MS;
    return floorSecond(Math.max(createdMs + HOUR_MS, Math.min(ms, nowMs - 600_000)));
  };

  // Named accounts first.
  NAMED.forEach((spec, i) => {
    const createdMs = nowMs - spec.createdDaysAgo * DAY_MS - rng.int(0, 86_000) * 1000;
    const email = `demo-${spec.key}@${DEMO_EMAIL_DOMAIN}`;
    usedEmails.add(email);
    users.push({
      id: rng.uuid(),
      key: spec.key,
      email,
      firstName: spec.firstName,
      lastName: spec.lastName,
      role: spec.role,
      fanClass: spec.fanClass,
      groupPref: 2,
      createdAt: floorSecond(createdMs),
      ...profileFor(createdMs, spec.profileDone),
      lastLoginAt: loginFor(createdMs),
      forced: spec.forced ?? [],
      expectedTier: spec.expectedTier,
      purpose: spec.purpose,
      passHolder: spec.passHolder,
    });
    void i;
  });

  // The crowd.
  for (let n = 1; n <= input.crowdSize; n += 1) {
    const fanClass = pickWeighted(rng, CROWD_MIX);
    const male = rng.chance(0.68);
    const firstName = rng.pick(male ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const email = emailFor(lastName, firstName, n);
    if (usedEmails.has(email)) throw new Error(`Duplicate demo e-mail ${email}`);
    usedEmails.add(email);

    // Regulars have been around for years; the rest are spread over three eras.
    const era =
      fanClass === 'devoted' || fanClass === 'regular'
        ? rng.chance(0.85)
          ? 0
          : 1
        : rng.weightedIndex([60, 25, 15]);
    let createdMs: number;
    if (era === 0)
      createdMs = rng.between(prevStartMs - 3 * 365 * DAY_MS, prevStartMs - 10 * DAY_MS);
    else if (era === 1) createdMs = rng.between(prevStartMs, seasonStartMs - 2 * DAY_MS);
    else
      createdMs = seasonStartMs + (nowMs - 2 * DAY_MS - seasonStartMs) * Math.pow(rng.next(), 1.6);

    users.push({
      id: rng.uuid(),
      email,
      firstName,
      lastName,
      role: UserRole.FAN,
      fanClass,
      groupPref: rng.weightedIndex(GROUP_PREF[fanClass]) + 1,
      createdAt: floorSecond(createdMs),
      ...profileFor(createdMs, rng.chance(0.55)),
      lastLoginAt: loginFor(createdMs),
      forced: [],
    });
  }
  return users;
}
