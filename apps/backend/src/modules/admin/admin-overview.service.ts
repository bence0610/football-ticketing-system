import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Match,
  MatchStatus,
  Seat,
  SeasonPass,
  SeasonPassPrice,
  SeasonPassStatus,
  Ticket,
  TicketSource,
  TicketStatus,
} from '../../database/entities';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';
import {
  OverviewDto,
  OverviewMatchDto,
  OverviewPeriod,
  OverviewSeasonDto,
  SeatSalesDto,
} from './dto/overview.dto';

const SOLD_STATUSES = [TicketStatus.PAID, TicketStatus.USED];
const DAY_MS = 86_400_000;

interface Season extends OverviewSeasonDto {
  from: Date;
  to: Date;
}

interface TicketAggregate {
  matchId: string;
  status: TicketStatus;
  source: TicketSource;
  n: string;
  amount: string;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Percent 0..100, rounded; 0 for an empty denominator. */
function percent(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part / whole) * 100);
}

function seasonDto(season: Season | null): OverviewSeasonDto | null {
  return season
    ? { label: season.label, validFrom: season.validFrom, validUntil: season.validUntil }
    : null;
}

/**
 * Read-only figures for the admin overview and seat heatmap. Nothing here
 * writes; every number comes from tickets as they were actually charged and
 * scanned.
 */
@Injectable()
export class AdminOverviewService {
  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(Seat) private readonly seatRepository: Repository<Seat>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(SeasonPass) private readonly passRepository: Repository<SeasonPass>,
    @InjectRepository(SeasonPassPrice)
    private readonly priceRepository: Repository<SeasonPassPrice>,
  ) {}

  /** The active season, from the price list the pass purchase uses. */
  async currentSeason(): Promise<Season | null> {
    const rows = await this.priceRepository.find({ where: { isActive: true } });
    if (rows.length === 0) return null;
    const row = rows.reduce((a, b) => (b.validUntil > a.validUntil ? b : a));
    const from = new Date(row.validFrom);
    const until = new Date(row.validUntil);
    return {
      label: row.seasonLabel,
      validFrom: dateOnly(from),
      validUntil: dateOnly(until),
      from,
      to: new Date(until.getTime() + DAY_MS - 1),
    };
  }

  async getOverview(period: OverviewPeriod, now = new Date()): Promise<OverviewDto> {
    const season = await this.currentSeason();

    const query = this.matchRepository
      .createQueryBuilder('m')
      .where('m.status != :cancelled', { cancelled: MatchStatus.CANCELLED })
      .orderBy('m.kickoffAt', 'ASC');
    if (period === 'season' && season) {
      query.andWhere('m.kickoffAt BETWEEN :from AND :to', { from: season.from, to: season.to });
    } else if (period !== 'season') {
      const days = period === '90d' ? 90 : 30;
      query.andWhere('m.kickoffAt >= :since', { since: new Date(now.getTime() - days * DAY_MS) });
    }
    const matches = await query.getMany();

    const capacity = await this.seatRepository.count({ where: { isActive: true } });
    const matchIds = matches.map((m) => m.id);

    // Per match: tickets by status and source, with the money actually charged.
    const ticketRows: TicketAggregate[] =
      matchIds.length === 0
        ? []
        : await this.ticketRepository
            .createQueryBuilder('t')
            .select('t.matchId', 'matchId')
            .addSelect('t.status', 'status')
            .addSelect('t.source', 'source')
            .addSelect('COUNT(t.id)', 'n')
            .addSelect('COALESCE(SUM(t.pricePaid), 0)', 'amount')
            .where('t.matchId IN (:...matchIds)', { matchIds })
            .groupBy('t.matchId')
            .addGroupBy('t.status')
            .addGroupBy('t.source')
            .getRawMany<TicketAggregate>();

    const passSeats = await this.activePassSeatIds();
    const seatsWithTicket = await this.passSeatsWithTicket(matchIds, passSeats);

    const rows: OverviewMatchDto[] = matches.map((match) => {
      let ticketCount = 0;
      let passEntryCount = 0;
      let occupyingTickets = 0;
      let revenue = 0;
      for (const r of ticketRows) {
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
      const withTicket = seatsWithTicket.get(match.id) ?? new Set<string>();
      const heldOnly = [...passSeats].filter((id) => !withTicket.has(id)).length;
      const occupiedSeats = Math.min(capacity, occupyingTickets + heldOnly);
      return {
        matchId: match.id,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        kickoffAt: match.kickoffAt.toISOString(),
        status: match.status,
        final: match.status === MatchStatus.FINISHED || match.kickoffAt <= now,
        ticketCount,
        passEntryCount,
        occupiedSeats,
        capacity,
        occupancyPercent: percent(occupiedSeats, capacity),
        revenue: Math.round(revenue),
      };
    });

    const finals = rows.filter((r) => r.final);
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
      season: seasonDto(season),
      period,
      generatedAt: now.toISOString(),
      metrics: {
        revenue: rows.reduce((a, r) => a + r.revenue, 0),
        ticketsSold: rows.reduce((a, r) => a + r.ticketCount, 0),
        passEntries: rows.reduce((a, r) => a + r.passEntryCount, 0),
        averageOccupancyPercent:
          finals.length === 0
            ? null
            : Math.round(finals.reduce((a, r) => a + r.occupancyPercent, 0) / finals.length),
        finalMatchCount: finals.length,
        redemptionPercent: playedTickets === 0 ? null : percent(scannedTickets, playedTickets),
        scannedTickets,
        playedTickets,
      },
      matches: rows,
    };
  }

  /** How often each seat was taken across the matches played this season. */
  async getSeatSales(now = new Date()): Promise<SeatSalesDto> {
    const season = await this.currentSeason();
    const query = this.matchRepository
      .createQueryBuilder('m')
      .where('m.status NOT IN (:...skip)', { skip: [MatchStatus.CANCELLED, MatchStatus.POSTPONED] })
      .andWhere('m.kickoffAt <= :now', { now });
    if (season) {
      query.andWhere('m.kickoffAt BETWEEN :from AND :to', { from: season.from, to: season.to });
    }
    const played = await query.getMany();
    const matchIds = played.map((m) => m.id);

    const seats = await this.seatRepository.find({
      where: { isActive: true },
      order: { section: 'ASC', row: 'ASC', number: 'ASC' },
    });
    const taken = new Map<string, number>();
    const bump = (seatId: string): void => {
      taken.set(seatId, (taken.get(seatId) ?? 0) + 1);
    };

    if (matchIds.length > 0) {
      const tickets = await this.ticketRepository.find({
        where: { matchId: In(matchIds), status: In([...OCCUPYING_TICKET_STATUSES]) },
        select: ['matchId', 'seatId'],
      });
      const ticketSeatsByMatch = new Map<string, Set<string>>();
      for (const t of tickets) {
        bump(t.seatId);
        const set = ticketSeatsByMatch.get(t.matchId) ?? new Set<string>();
        set.add(t.seatId);
        ticketSeatsByMatch.set(t.matchId, set);
      }
      // A seat held by an active pass is taken for every match, ticket or not.
      const passSeats = await this.activePassSeatIds();
      for (const match of played) {
        const withTicket = ticketSeatsByMatch.get(match.id) ?? new Set<string>();
        for (const seatId of passSeats) {
          if (!withTicket.has(seatId)) bump(seatId);
        }
      }
    }

    return {
      season: seasonDto(season),
      generatedAt: now.toISOString(),
      matchCount: played.length,
      seats: seats.map((s) => ({
        section: s.section,
        row: s.row,
        number: s.number,
        taken: taken.get(s.id) ?? 0,
      })),
    };
  }

  private async activePassSeatIds(): Promise<Set<string>> {
    const passes = await this.passRepository.find({
      where: { status: SeasonPassStatus.ACTIVE },
      select: ['seatId'],
    });
    return new Set(passes.map((p) => p.seatId).filter((id): id is string => !!id));
  }

  /** For each match, which pass-held seats already have an occupying ticket. */
  private async passSeatsWithTicket(
    matchIds: string[],
    passSeats: Set<string>,
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (matchIds.length === 0 || passSeats.size === 0) return out;
    const rows = await this.ticketRepository.find({
      where: {
        matchId: In(matchIds),
        seatId: In([...passSeats]),
        status: In([...OCCUPYING_TICKET_STATUSES]),
      },
      select: ['matchId', 'seatId'],
    });
    for (const r of rows) {
      const set = out.get(r.matchId) ?? new Set<string>();
      set.add(r.seatId);
      out.set(r.matchId, set);
    }
    return out;
  }
}
