import { TIER_LABEL } from '../stadium-layout';
import { FEMALE_FIRST_NAMES, LAST_NAMES, MALE_FIRST_NAMES } from './data';
import { CLASS_WEIGHT } from './users';
import { SeatRef, Stadium, rowWeightOf, sectorWeights } from './demand';
import type { DemoPass, DemoUser, PassTier } from './model';
import type { Rng } from './rng';
import { DAY_MS } from './time';

export const PASS_TIERS: readonly PassTier[] = ['vip', 'lower', 'upper'];
export { TIER_LABEL };

/** Pass counts per tier this season: "a few dozen" across the three tiers. */
const TIER_COUNTS: Readonly<Record<PassTier, number>> = { vip: 4, lower: 12, upper: 20 };

export interface PassBuildInput {
  stadium: Stadium;
  users: readonly DemoUser[];
  now: Date;
  season: { label: string; validFrom: Date; validUntil: Date; prices: Record<PassTier, number> };
  previous: { label: string; validFrom: Date; validUntil: Date; prices: Record<PassTier, number> };
  /** Seats held by passes that are not demo data. */
  foreignPassSeatIds: ReadonlySet<string>;
}

const floorSecond = (ms: number): Date => new Date(Math.floor(ms / 1000) * 1000);

function pickSeat(
  stadium: Stadium,
  tier: PassTier,
  taken: ReadonlySet<string>,
  rng: Rng,
  preferredSector?: string,
): SeatRef {
  const weights = sectorWeights(stadium, { draw: 1.2, cold: false });
  const candidates: SeatRef[] = [];
  const w: number[] = [];
  for (const sector of stadium.sectors) {
    if (sector.isAway || sector.priceCategory !== tier) continue;
    const rows = stadium.grid.get(sector.code);
    if (!rows) continue;
    const rowCount = rows.size;
    for (const [rowNo, seats] of rows) {
      for (const seat of seats) {
        if (taken.has(seat.id)) continue;
        candidates.push(seat);
        w.push(
          (weights.get(sector.code) ?? 0.1) *
            rowWeightOf(rowNo, rowCount) *
            (preferredSector && sector.code === preferredSector ? 6 : 1),
        );
      }
    }
  }
  if (candidates.length === 0) throw new Error(`No free ${tier} seat left for a pass.`);
  return candidates[rng.weightedIndex(w)];
}

function childName(rng: Rng, surname: string): string {
  const first = rng.chance(0.5) ? rng.pick(MALE_FIRST_NAMES) : rng.pick(FEMALE_FIRST_NAMES);
  return `${surname} ${first} (gyerek)`;
}

function guestName(rng: Rng): string {
  const first = rng.chance(0.7) ? rng.pick(MALE_FIRST_NAMES) : rng.pick(FEMALE_FIRST_NAMES);
  return `${rng.pick(LAST_NAMES)} ${first} (vendég)`;
}

interface Slot {
  tier: PassTier;
  buyer: DemoUser;
  holder: DemoUser | null;
  holderName: string;
  sector?: string;
  alwaysAttends?: boolean;
}

/**
 * The season passes: the named demo accounts' passes, a patron who bought five for guests,
 * a parent who bought one for a child, three bought for another account, and the rest bought
 * by their own holder. The previous season's passes are mostly the same people renewing.
 */
export function buildPasses(input: PassBuildInput, rng: Rng): DemoPass[] {
  const { stadium, users, now } = input;
  const byKey = new Map(users.filter((u) => u.key).map((u) => [u.key as string, u]));
  const get = (key: string): DemoUser => {
    const u = byKey.get(key);
    if (!u) throw new Error(`Missing named account ${key}`);
    return u;
  };
  const crowd = users.filter((u) => !u.key);
  const pool: PassTier[] = [];
  for (const t of PASS_TIERS) for (let i = 0; i < TIER_COUNTS[t]; i += 1) pool.push(t);
  const takeTier = (t: PassTier): PassTier => {
    const i = pool.indexOf(t);
    if (i < 0) throw new Error(`No ${t} pass left in the plan.`);
    pool.splice(i, 1);
    return t;
  };

  const holders = new Set<string>();
  const claim = (u: DemoUser): DemoUser => {
    if (holders.has(u.id)) throw new Error('Account would hold two passes in one season.');
    holders.add(u.id);
    u.passHolder = true;
    return u;
  };
  const sellDate = (): number =>
    input.season.validFrom.getTime() + DAY_MS * (1 + Math.floor(rng.exponential(22)));
  const latestSale = now.getTime() - 21 * DAY_MS;
  const regulars = rng.shuffle(crowd.filter((u) => u.fanClass === 'regular'));
  const devoted = rng.shuffle(crowd.filter((u) => u.fanClass === 'devoted'));
  const frequent = rng.shuffle(crowd.filter((u) => u.fanClass === 'frequent'));
  const olderThanSeason = (u: DemoUser): boolean =>
    u.createdAt.getTime() < input.season.validFrom.getTime() - 60 * DAY_MS;
  const nextFree = (list: DemoUser[]): DemoUser => {
    const u = list.find((c) => !holders.has(c.id) && olderThanSeason(c));
    if (!u) throw new Error('Not enough accounts to hold the planned passes.');
    return u;
  };

  const slots: Slot[] = [];
  const berletes = claim(get('berletes'));
  slots.push({
    tier: takeTier('upper'),
    buyer: berletes,
    holder: berletes,
    holderName: nameOf(berletes),
    sector: 'B/2',
    alwaysAttends: true,
  });
  const kolcsonzo = claim(get('kolcsonzo'));
  slots.push({
    tier: takeTier('lower'),
    buyer: kolcsonzo,
    holder: kolcsonzo,
    holderName: nameOf(kolcsonzo),
    sector: 'K',
    alwaysAttends: true,
  });
  const vevo = get('vevo');
  const birtokos = claim(get('birtokos'));
  slots.push({
    tier: takeTier('upper'),
    buyer: vevo,
    holder: birtokos,
    holderName: nameOf(birtokos),
    sector: 'C/1',
    alwaysAttends: true,
  });

  // A patron who bought five passes for guests, two of them VIP.
  const patron = nextFree(regulars);
  for (const t of ['upper', 'upper', 'upper', 'vip', 'vip'] as const) {
    slots.push({ tier: takeTier(t), buyer: patron, holder: null, holderName: guestName(rng) });
  }
  // The top-tier fan bought one for a guest too.
  slots.push({
    tier: takeTier('lower'),
    buyer: get('legenda'),
    holder: null,
    holderName: guestName(rng),
  });
  // A parent's pass for a child without an account.
  const parent = nextFree(devoted);
  slots.push({
    tier: takeTier('upper'),
    buyer: parent,
    holder: null,
    holderName: childName(rng, parent.lastName),
  });

  // Three passes bought for another account.
  for (let i = 0; i < 3; i += 1) {
    const buyer = nextFree(devoted);
    const holder = claim(nextFree(frequent));
    const tier = takeTier(pool.includes('lower') ? 'lower' : 'upper');
    slots.push({ tier, buyer, holder, holderName: nameOf(holder) });
  }

  // The rest are bought by their holder.
  const ownPool = [...devoted, ...regulars, ...frequent];
  while (pool.length > 0) {
    const holder = claim(nextFree(ownPool));
    slots.push({ tier: takeTier(pool[0]), buyer: holder, holder, holderName: nameOf(holder) });
  }

  const passes: DemoPass[] = [];
  const takenCurrent = new Set(input.foreignPassSeatIds);
  const price = (label: string, tier: PassTier): number =>
    label === input.season.label ? input.season.prices[tier] : input.previous.prices[tier];

  for (const slot of slots) {
    const seat = pickSeat(stadium, slot.tier, takenCurrent, rng, slot.sector);
    takenCurrent.add(seat.id);
    const floor =
      Math.max(slot.buyer.createdAt.getTime(), slot.holder ? slot.holder.createdAt.getTime() : 0) +
      2 * DAY_MS;
    const createdAt = floorSecond(Math.max(floor, Math.min(sellDate(), latestSale)));
    passes.push({
      id: rng.uuid(),
      season: 'current',
      seasonLabel: input.season.label,
      tier: slot.tier,
      buyerId: slot.buyer.id,
      holderId: slot.holder?.id ?? null,
      holderName: slot.holderName,
      seat,
      createdAt,
      price: price(input.season.label, slot.tier),
      validFrom: input.season.validFrom,
      validUntil: input.season.validUntil,
      status: 'active',
      qrCode: `KTE-SP-${rng.uuid()}`,
      alwaysAttends: slot.alwaysAttends,
    });
  }

  // Last season: most of this season's holders renewed (same seat), some did not come back,
  // and a few holders from last season did not renew.
  const prevStart = input.previous.validFrom.getTime();
  const prevSale = (): number => prevStart + DAY_MS * (1 + Math.floor(rng.exponential(22)));
  const userById = new Map(users.map((u) => [u.id, u]));
  const takenPrev = new Set<string>();
  // Iterate over a copy: the renewals are appended to `passes` as they are made.
  for (const cur of [...passes]) {
    const buyer = userById.get(cur.buyerId) as DemoUser;
    const holder = cur.holderId ? (userById.get(cur.holderId) as DemoUser) : null;
    const createdAt = floorSecond(prevSale());
    const old = (u: DemoUser): boolean => u.createdAt.getTime() < createdAt.getTime() - 2 * DAY_MS;
    if (!rng.chance(0.72) || !old(buyer) || (holder && !old(holder))) continue;
    takenPrev.add(cur.seat.id);
    passes.push({
      ...cur,
      id: rng.uuid(),
      season: 'previous',
      seasonLabel: input.previous.label,
      createdAt,
      price: price(input.previous.label, cur.tier),
      validFrom: input.previous.validFrom,
      validUntil: input.previous.validUntil,
      status: 'expired',
      qrCode: `KTE-SP-${rng.uuid()}`,
      alwaysAttends: false,
    });
  }
  const currentHolders = new Set(holders);
  const lapsed = rng.shuffle(
    crowd.filter(
      (u) =>
        !currentHolders.has(u.id) &&
        u.createdAt.getTime() < prevStart - 30 * DAY_MS &&
        CLASS_WEIGHT[u.fanClass] > 0,
    ),
  );
  for (let i = 0; i < 8 && i < lapsed.length; i += 1) {
    const holder = lapsed[i];
    const tier = rng.pick(['upper', 'upper', 'upper', 'lower', 'lower'] as const);
    const seat = pickSeat(stadium, tier, takenPrev, rng);
    takenPrev.add(seat.id);
    passes.push({
      id: rng.uuid(),
      season: 'previous',
      seasonLabel: input.previous.label,
      tier,
      buyerId: holder.id,
      holderId: holder.id,
      holderName: nameOf(holder),
      seat,
      createdAt: floorSecond(prevSale()),
      price: price(input.previous.label, tier),
      validFrom: input.previous.validFrom,
      validUntil: input.previous.validUntil,
      status: 'expired',
      qrCode: `KTE-SP-${rng.uuid()}`,
    });
  }
  return passes;
}

function nameOf(u: DemoUser): string {
  return `${u.lastName} ${u.firstName}`;
}
