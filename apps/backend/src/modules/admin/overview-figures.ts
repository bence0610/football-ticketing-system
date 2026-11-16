import { MatchStatus, TicketSource, TicketStatus } from '../../database/entities';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';
import { OverviewMatchDto, OverviewMetricsDto } from './dto/overview.dto';

/**
 * The arithmetic behind the admin overview, with no database in it.
 *
 * One rule runs through all of it: tickets are sold only for HOME matches. An away match
 * stays in the list (it is part of the season) but it is never measured: its figures are
 * `null`, it adds nothing to any total, and it is not one of the matches an average is
 * taken over. In particular the seats held by season passes are NOT counted as occupied
 * for an away match, which is what used to show every away round at "1%".
 */
const SOLD_STATUSES = [TicketStatus.PAID, TicketStatus.USED];

export interface FigureMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date;
  status: MatchStatus;
  /** The club is the home side. */
  isHome: boolean;
}

export interface TicketAggregate {
  matchId: string;
  status: TicketStatus;
  source: TicketSource;
  n: string | number;
  amount: string | number;
}

/** A row of a home match: every figure present. */
export type HomeRow = OverviewMatchDto & {
  isHome: true;
  ticketCount: number;
  passEntryCount: number;
  occupiedSeats: number;
  capacity: number;
  occupancyPercent: number;
  revenue: number;
};

export const isHomeRow = (row: OverviewMatchDto): row is HomeRow => row.isHome;

/** Percent 0..100, rounded; 0 for an empty denominator. */
export function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

export interface RowInput {
  matches: readonly FigureMatch[];
  ticketRows: readonly TicketAggregate[];
  /** Seats held by an active season pass. */
  passSeats: ReadonlySet<string>;
  /** For each match, the pass-held seats that already have an occupying ticket. */
  passSeatsWithTicket: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * The seats a home match can sell: every active seat outside the away section. This is the
   * denominator of every occupancy figure, so a fully sold home match reads exactly 100%.
   */
  sellableSeats: number;
  now: Date;
}

export function matchRows(input: RowInput): OverviewMatchDto[] {
  const { sellableSeats, now } = input;
  return input.matches.map((match) => {
    const base = {
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt.toISOString(),
      status: match.status,
      final: match.status === MatchStatus.FINISHED || match.kickoffAt <= now,
      isHome: match.isHome,
    };
    if (!match.isHome) {
      return {
        ...base,
        ticketCount: null,
        passEntryCount: null,
        occupiedSeats: null,
        capacity: null,
        occupancyPercent: null,
        revenue: null,
      };
    }

    let ticketCount = 0;
    let passEntryCount = 0;
    let occupyingTickets = 0;
    let revenue = 0;
    for (const r of input.ticketRows) {
      if (r.matchId !== match.id) continue;
      const n = Number(r.n);
      if (SOLD_STATUSES.includes(r.status)) {
        revenue += Number(r.amount);
        if (r.source === TicketSource.SINGLE) ticketCount += n;
      }
      if (OCCUPYING_TICKET_STATUSES.includes(r.status)) {
        occupyingTickets += n;
        if (r.source !== TicketSource.SINGLE) passEntryCount += n;
      }
    }
    const withTicket = input.passSeatsWithTicket.get(match.id) ?? new Set<string>();
    const heldOnly = [...input.passSeats].filter((id) => !withTicket.has(id)).length;
    const occupiedSeats = Math.min(sellableSeats, occupyingTickets + heldOnly);
    return {
      ...base,
      ticketCount,
      passEntryCount,
      occupiedSeats,
      capacity: sellableSeats,
      occupancyPercent: percent(occupiedSeats, sellableSeats),
      revenue: Math.round(revenue),
    };
  });
}

/** The tiles above the table: home matches only, in every sum and every average. */
export function overviewMetrics(
  rows: readonly OverviewMatchDto[],
  ticketRows: readonly TicketAggregate[],
): OverviewMetricsDto {
  const home = rows.filter(isHomeRow);
  const finals = home.filter((r) => r.final);
  const played = new Set(finals.map((r) => r.matchId));
  let playedTickets = 0;
  let scannedTickets = 0;
  for (const r of ticketRows) {
    if (!played.has(r.matchId) || r.source !== TicketSource.SINGLE) continue;
    if (!SOLD_STATUSES.includes(r.status)) continue;
    playedTickets += Number(r.n);
    if (r.status === TicketStatus.USED) scannedTickets += Number(r.n);
  }
  return {
    revenue: home.reduce((a, r) => a + r.revenue, 0),
    ticketsSold: home.reduce((a, r) => a + r.ticketCount, 0),
    passEntries: home.reduce((a, r) => a + r.passEntryCount, 0),
    averageOccupancyPercent:
      finals.length === 0
        ? null
        : Math.round(finals.reduce((a, r) => a + r.occupancyPercent, 0) / finals.length),
    finalMatchCount: finals.length,
    redemptionPercent: playedTickets === 0 ? null : percent(scannedTickets, playedTickets),
    scannedTickets,
    playedTickets,
  };
}
