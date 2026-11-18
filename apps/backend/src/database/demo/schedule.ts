import { Competition, MatchStatus, isPassEligibleMatch } from '../entities/match.entity';
import { HOME_TEAM, HOME_VENUE, OPPONENTS, Opponent } from './data';
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  dayNumberOf,
  dayNumberOfDateColumn,
  monthOf,
  wallClockToUtc,
  weekdayOf,
} from './time';

export type Phase = 'played' | 'live' | 'upcoming';
export type Slot = 'sat' | 'sun' | 'fri' | 'midweek';

export interface MatchPlan {
  /** Stable name of the fixture: `cur:r07`, `cur:cup2`, `prev:l03`. */
  key: string;
  /**
   * `older`: the seasons before the previous one. They exist only as a long history for the one
   * account that has been to every match for years (see olderSeasons).
   */
  season: 'current' | 'previous' | 'older';
  seasonLabel: string;
  /** League round 1..30; null for a cup tie. */
  round: number | null;
  competition: Competition;
  /** Kecskeméti TE is the home side (tickets are sold here). */
  home: boolean;
  opponentKey: string;
  opponent: Opponent;
  kickoffAt: Date;
  phase: Phase;
  status: MatchStatus;
  basePrice: number;
  /**
   * The biggest upcoming match: clearly the fullest, about 85% of the sellable seats, but never
   * sold out. (A fully ticketed league match would leave no seat for a season pass: the pass
   * rule refuses every seat that already has a ticket for an upcoming pass-eligible match.)
   */
  fullest: boolean;
  passEligible: boolean;
  slot: Slot;
  /** Day-of-week, season and round effect on the crowd (1 = an ordinary Saturday). */
  timeFactor: number;
}

export interface SeasonWindow {
  label: string;
  /** First and last day, as the DATE columns hold them (UTC midnight). */
  validFrom: Date;
  validUntil: Date;
}

/** Round 13 is the match "in progress" when the script runs. */
export const LIVE_ROUND = 13;
/** Round 15, the visit of Diósgyőri VTK, is the fullest upcoming match (not sold out). */
export const FULLEST_ROUND = 15;
export const LEAGUE_ROUNDS = 30;

interface RoundSeed {
  home: boolean;
  opponent: string;
}

/**
 * Rounds 1-15: eight home and seven away, alternating. Rounds 16-30 repeat 1-15 with the
 * venues swapped, so every opponent is met once at home and once away: 15 + 15 = 30.
 */
const FIRST_HALF: readonly RoundSeed[] = [
  { home: true, opponent: 'soroksar' },
  { home: false, opponent: 'szeged' },
  { home: true, opponent: 'karcag' },
  { home: false, opponent: 'kazincbarcika' },
  { home: true, opponent: 'tiszakecske' },
  { home: false, opponent: 'csakvar' },
  { home: true, opponent: 'gyirmot' },
  { home: false, opponent: 'bvsc' },
  { home: true, opponent: 'kozarmisleny' },
  { home: false, opponent: 'nagykanizsa' },
  { home: true, opponent: 'mezokovesd' },
  { home: false, opponent: 'szentlorinc' },
  { home: true, opponent: 'ajka' },
  { home: false, opponent: 'videoton' },
  { home: true, opponent: 'dvtk' },
];

export function leagueRounds(): Array<RoundSeed & { round: number }> {
  const rounds = FIRST_HALF.map((r, i) => ({ ...r, round: i + 1 }));
  const second = FIRST_HALF.map((r, i) => ({ opponent: r.opponent, home: !r.home, round: i + 16 }));
  return [...rounds, ...second];
}

/** Midweek, Friday-evening and Sunday rounds; every other round is a Saturday. */
const MIDWEEK_ROUNDS = new Set([5, 11, 21, 26]);
const FRIDAY_ROUNDS = new Set([9, 19, 24]);
const SUNDAY_ROUNDS = new Set([3, 7, 16, 22, 28]);

function slotOf(round: number): Slot {
  if (MIDWEEK_ROUNDS.has(round)) return 'midweek';
  if (FRIDAY_ROUNDS.has(round)) return 'fri';
  if (SUNDAY_ROUNDS.has(round)) return 'sun';
  return 'sat';
}

const SLOT_OFFSET_DAYS: Readonly<Record<Slot, number>> = { midweek: -3, fri: -1, sat: 0, sun: 1 };

/** Local kickoff time: later in summer, early in the dark months. */
function kickoffTime(month: number, slot: Slot): [number, number] {
  const summer = month >= 4 && month <= 9;
  switch (slot) {
    case 'midweek':
      return summer ? [19, 0] : [17, 30];
    case 'fri':
      return summer ? [19, 30] : [18, 30];
    case 'sun':
      return summer ? [17, 0] : [15, 0];
    default:
      if (summer) return [17, 0];
      return month === 12 || month <= 2 ? [14, 0] : [15, 0];
  }
}

const SLOT_FACTOR: Readonly<Record<Slot, number>> = { sat: 1, sun: 0.95, fri: 0.92, midweek: 0.7 };

function monthFactor(month: number): number {
  if (month === 12 || month === 1 || month === 2) return 0.85;
  if (month === 3 || month === 10 || month === 11) return 0.95;
  return 1;
}

/**
 * The base ticket price (the cheapest, upper-arc seat; the other tiers multiply it). A strong
 * visitor costs more, a cup tie less than any league match. The league prices are set so that
 * buying the home matches still to come one by one costs clearly more than the season pass in
 * every tier, even part-way through the season (the pass price is fixed, not prorated): with
 * the eight matches left in mid-November the upper arc, the cheapest tier, comes to about 26,400 Ft
 * against the 22,000 Ft pass. The audit checks it.
 */
function priceFor(competition: Competition, draw: number): number {
  if (competition === Competition.MAGYAR_KUPA) return 2400;
  if (draw >= 1.25) return 3800;
  if (draw >= 1.0) return 3400;
  return 3000;
}

function weekdayMatch(day: number, weekday: number, direction: 1 | -1): number {
  let d = day;
  while (weekdayOf(d) !== weekday) d += direction;
  return d;
}

export interface ScheduleResult {
  current: MatchPlan[];
  previous: MatchPlan[];
  /** Days between the Saturdays of the rounds still to come (7 unless the season window is tight). */
  roundSpacingDays: number;
}

function plan(
  partial: Omit<MatchPlan, 'opponent' | 'timeFactor' | 'status' | 'basePrice' | 'passEligible'> & {
    cup: boolean;
  },
): MatchPlan {
  const opponent = OPPONENTS[partial.opponentKey];
  const { cup, ...rest } = partial;
  const month = monthOf(dayNumberOf(rest.kickoffAt));
  const opening = rest.round === 1 ? 1.1 : 1;
  const timeFactor = SLOT_FACTOR[rest.slot] * monthFactor(month) * (cup ? 0.85 : 1) * opening;
  let status: MatchStatus;
  if (rest.phase === 'played') status = MatchStatus.FINISHED;
  else if (rest.phase === 'live') status = MatchStatus.ON_SALE;
  else if (!rest.home) status = MatchStatus.SCHEDULED;
  else status = MatchStatus.ON_SALE;
  return {
    ...rest,
    opponent,
    status,
    timeFactor,
    basePrice: rest.home ? priceFor(rest.competition, opponent.draw) : 0,
    // The pass covers every home match of the league and the Magyar Kupa (not friendlies).
    passEligible: isPassEligibleMatch(rest.competition, rest.home),
  };
}

/**
 * Builds the fixture list around `now`: rounds 1-12 are played, round 13 kicked off 40
 * minutes ago, rounds 14-30 are still to come, plus two cup ties; and the previous
 * season's home matches, 52 weeks earlier.
 *
 * Throws when the season window cannot hold the rounds (the script was run too late in the
 * season, or the first round would fall before the season began).
 */
export function buildSchedule(
  now: Date,
  season: SeasonWindow,
  previousLabel: string,
): ScheduleResult {
  const today = dayNumberOf(now);
  const seasonStart = dayNumberOfDateColumn(season.validFrom);
  const seasonEnd = dayNumberOfDateColumn(season.validUntil);

  const lastSat = weekdayMatch(today - 1, 6, -1);
  const nextSat = weekdayMatch(today + 1, 6, 1);

  const lastAllowed = seasonEnd - 2;
  let spacing = 7;
  if (nextSat + 7 * 16 > lastAllowed) {
    spacing = Math.floor((lastAllowed - nextSat) / 16);
  }
  if (spacing < 3) {
    throw new Error(
      `Season ${season.label} ends too soon after today for the 17 rounds still to come ` +
        `(window ends ${new Date(seasonEnd * DAY_MS).toISOString().slice(0, 10)}). Run the script earlier, ` +
        'or move the season window.',
    );
  }

  const saturdayOf = (round: number): number =>
    round < LIVE_ROUND ? lastSat - 7 * (LIVE_ROUND - 1 - round) : nextSat + spacing * (round - 14);

  const firstRound = saturdayOf(1) + SLOT_OFFSET_DAYS[slotOf(1)];
  if (firstRound < seasonStart) {
    throw new Error(
      `Round 1 would fall on ${new Date(firstRound * DAY_MS).toISOString().slice(0, 10)}, before season ` +
        `${season.label} begins. Run the script later, or move the season window.`,
    );
  }

  const kickoffOn = (day: number, slot: Slot): Date => {
    const [h, m] = kickoffTime(monthOf(day), slot);
    return wallClockToUtc(day, h, m);
  };

  const current: MatchPlan[] = [];
  const homeLeague: MatchPlan[] = [];

  for (const r of leagueRounds()) {
    let slot = spacing < 7 ? 'sat' : slotOf(r.round);
    let kickoffAt: Date;
    let phase: Phase;
    if (r.round === LIVE_ROUND) {
      slot = 'sat';
      kickoffAt = new Date(now.getTime() - 40 * MINUTE_MS);
      phase = 'live';
    } else if (r.round < LIVE_ROUND) {
      kickoffAt = kickoffOn(saturdayOf(r.round) + SLOT_OFFSET_DAYS[slot as Slot], slot as Slot);
      if (kickoffAt.getTime() > now.getTime() - 4 * HOUR_MS) {
        slot = 'sat';
        kickoffAt = kickoffOn(saturdayOf(r.round), 'sat');
      }
      phase = 'played';
    } else {
      kickoffAt = kickoffOn(saturdayOf(r.round) + SLOT_OFFSET_DAYS[slot as Slot], slot as Slot);
      if (kickoffAt.getTime() < now.getTime() + 20 * HOUR_MS) {
        slot = 'sat';
        kickoffAt = kickoffOn(saturdayOf(r.round), 'sat');
      }
      phase = 'upcoming';
    }
    const match = plan({
      key: `cur:r${String(r.round).padStart(2, '0')}`,
      season: 'current',
      seasonLabel: season.label,
      round: r.round,
      competition: Competition.NB2,
      home: r.home,
      opponentKey: r.opponent,
      kickoffAt,
      phase,
      fullest: r.home && r.round === FULLEST_ROUND,
      slot: slot as Slot,
      cup: false,
    });
    current.push(match);
    if (r.home) homeLeague.push(match);
  }

  // Two Magyar Kupa home ties: one played on a Wednesday, one still to come.
  const cupDay1 = saturdayOf(8) + 4;
  const cupDay2 = saturdayOf(16) + (spacing >= 7 ? 4 : Math.max(1, Math.floor(spacing / 2)));
  const cup1 = plan({
    key: 'cur:cup1',
    season: 'current',
    seasonLabel: season.label,
    round: null,
    competition: Competition.MAGYAR_KUPA,
    home: true,
    opponentKey: 'csakvar',
    kickoffAt: kickoffOn(cupDay1, 'midweek'),
    phase: 'played',
    fullest: false,
    slot: 'midweek',
    cup: true,
  });
  const cup2 = plan({
    key: 'cur:cup2',
    season: 'current',
    seasonLabel: season.label,
    round: null,
    competition: Competition.MAGYAR_KUPA,
    home: true,
    opponentKey: 'gyirmot',
    kickoffAt: kickoffOn(cupDay2, 'midweek'),
    phase: 'upcoming',
    fullest: false,
    slot: 'midweek',
    cup: true,
  });
  current.push(cup1, cup2);
  current.sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());

  // Previous season: the same Saturdays 52 weeks earlier, against the opponents in a shifted order.
  const previous: MatchPlan[] = [];
  const homeOpponents = homeLeague.map((m) => m.opponentKey);
  homeLeague.forEach((m, i) => {
    const day = dayNumberOf(m.kickoffAt) - 364;
    previous.push(
      plan({
        key: `prev:l${String(i + 1).padStart(2, '0')}`,
        season: 'previous',
        seasonLabel: previousLabel,
        round: null,
        competition: Competition.NB2,
        home: true,
        opponentKey: homeOpponents[(i + 5) % homeOpponents.length],
        kickoffAt: kickoffOn(day, m.slot),
        phase: 'played',
        fullest: false,
        slot: m.slot,
        cup: false,
      }),
    );
  });
  previous.push(
    plan({
      key: 'prev:cup1',
      season: 'previous',
      seasonLabel: previousLabel,
      round: null,
      competition: Competition.MAGYAR_KUPA,
      home: true,
      opponentKey: 'karcag',
      kickoffAt: kickoffOn(dayNumberOf(cup1.kickoffAt) - 364, 'midweek'),
      phase: 'played',
      fullest: false,
      slot: 'midweek',
      cup: true,
    }),
  );
  previous.sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());

  return { current, previous, roundSpacingDays: spacing };
}

/**
 * The home matches of the seasons before last season, `count` of them, as copies of last season's
 * shifted back 52 weeks at a time. Loyalty measures attendance and a person can earn at most
 * about 1,300 points a season (a pass and every home match), so reaching KTE Legenda by attending
 * takes four seasons: this is the history of the one account that has done that.
 */
export function olderSeasons(
  previous: readonly MatchPlan[],
  labelBefore: (label: string) => string,
  count: number,
): MatchPlan[] {
  const out: MatchPlan[] = [];
  let label = previous[0].seasonLabel;
  for (let k = 1; k <= count; k += 1) {
    label = labelBefore(label);
    for (const p of previous) {
      out.push({
        ...p,
        key: `old${k}:${p.key.slice('prev:'.length)}`,
        season: 'older',
        seasonLabel: label,
        kickoffAt: new Date(p.kickoffAt.getTime() - 364 * k * DAY_MS),
      });
    }
  }
  return out;
}

export function venueFor(m: Pick<MatchPlan, 'home' | 'opponent'>): string {
  return m.home ? HOME_VENUE : `${m.opponent.city} – vendégpálya`;
}

export function homeTeamOf(m: Pick<MatchPlan, 'home' | 'opponent'>): string {
  return m.home ? HOME_TEAM : m.opponent.name;
}

export function awayTeamOf(m: Pick<MatchPlan, 'home' | 'opponent'>): string {
  return m.home ? m.opponent.name : HOME_TEAM;
}
