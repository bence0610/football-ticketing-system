import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Match,
  MatchStatus,
  Seat,
  SeasonPass,
  SeasonPassPrice,
  SeasonPassStatus,
  Sector,
  Ticket,
} from '../../database/entities';
import { AppConfig } from '../../config';
import { isHomeMatch } from '../matches/match-home';
import { passCoversMatch } from '../season-passes/season-pass-validity';
import { compareSeats } from '../seats/seat-order';
import { compareSectors } from '../seats/sector-catalogue.service';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';
import { passRevenueByTier, sumTiers } from './season-pass-revenue';
import { countSellableSeats } from './sellable-seats';
import { OverviewDto, OverviewPeriod, OverviewSeasonDto, SeatSalesDto } from './dto/overview.dto';
import { TicketAggregate, matchRows, overviewMetrics } from './overview-figures';

const DAY_MS = 86_400_000;

interface Season extends OverviewSeasonDto {
  from: Date;
  to: Date;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
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
    @InjectRepository(Sector) private readonly sectorRepository: Repository<Sector>,
    configService: ConfigService,
  ) {
    this.homeTeamName = configService.getOrThrow<AppConfig>('app').homeTeamName;
  }

  private readonly homeTeamName: string;

  private isHome(match: Match): boolean {
    return isHomeMatch(match, this.homeTeamName);
  }

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

    // Tickets are sold only for home matches, so away matches are neither queried for sales nor
    // measured: they stay in the list with every sold-ticket figure null.
    const sellableSeats = await countSellableSeats(this.seatRepository);
    const homeIds = matches.filter((m) => this.isHome(m)).map((m) => m.id);

    // Per match: tickets by status and source, with the money actually charged.
    const ticketRows: TicketAggregate[] =
      homeIds.length === 0
        ? []
        : await this.ticketRepository
            .createQueryBuilder('t')
            .select('t.matchId', 'matchId')
            .addSelect('t.status', 'status')
            .addSelect('t.source', 'source')
            .addSelect('COUNT(t.id)', 'n')
            .addSelect('COALESCE(SUM(t.pricePaid), 0)', 'amount')
            .where('t.matchId IN (:...homeIds)', { homeIds })
            .groupBy('t.matchId')
            .addGroupBy('t.status')
            .addGroupBy('t.source')
            .getRawMany<TicketAggregate>();

    const activePasses = await this.activePasses();
    const homeMatches = matches.filter((m) => this.isHome(m));
    const validPassSeats = new Map<string, Set<string>>(
      homeMatches.map((m) => [m.id, this.passSeatsValidFor(m, activePasses)]),
    );
    const allValidSeats = new Set([...validPassSeats.values()].flatMap((s) => [...s]));
    const seatsWithTicket = await this.passSeatsWithTicket(homeIds, allValidSeats);

    const rows = matchRows({
      matches: matches.map((m) => ({
        id: m.id,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffAt: m.kickoffAt,
        status: m.status,
        isHome: this.isHome(m),
      })),
      ticketRows,
      validPassSeats,
      passSeatsWithTicket: seatsWithTicket,
      sellableSeats,
      now,
    });

    // Season-pass money, apart from match revenue: one payment per season, never split over matches.
    const passTiers =
      period === 'season'
        ? season
          ? await passRevenueByTier(this.passRepository, { seasonLabel: season.label })
          : []
        : await passRevenueByTier(this.passRepository, {
            createdSince: new Date(now.getTime() - (period === '90d' ? 90 : 30) * DAY_MS),
          });
    const passTotals = sumTiers(passTiers);

    return {
      season: seasonDto(season),
      period,
      generatedAt: now.toISOString(),
      seasonPasses: {
        basis: period === 'season' ? 'season' : 'purchased_in_period',
        revenue: passTotals.revenue,
        passCount: passTotals.passCount,
        byTier: passTiers,
      },
      metrics: overviewMetrics(rows, ticketRows),
      matches: rows,
    };
  }

  /** How often each seat was taken across the matches played this season. */
  async getSeatSales(now = new Date()): Promise<SeatSalesDto> {
    const season = await this.currentSeason();
    // Only home matches: an away match has no sales, and the seats held by passes must not be
    // counted as "taken" for it.
    const query = this.matchRepository
      .createQueryBuilder('m')
      .where('m.status NOT IN (:...skip)', { skip: [MatchStatus.CANCELLED, MatchStatus.POSTPONED] })
      .andWhere('m.homeTeam = :home', { home: this.homeTeamName })
      .andWhere('m.kickoffAt <= :now', { now });
    if (season) {
      query.andWhere('m.kickoffAt BETWEEN :from AND :to', { from: season.from, to: season.to });
    }
    const played = await query.getMany();
    const matchIds = played.map((m) => m.id);

    // Stadium order, with rows compared as numbers (they are stored as strings).
    const sectors = (await this.sectorRepository.find()).sort(compareSectors);
    const positions = new Map(sectors.map((sec, i) => [sec.code, i + 1]));
    const seats = (await this.seatRepository.find({ where: { isActive: true } })).sort(
      compareSeats(positions),
    );
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
      // A seat held by a pass valid for the match is taken for it, ticket or not. A match the
      // pass does not cover (a friendly, a cup tie) leaves the seat empty: nothing to count.
      const activePasses = await this.activePasses();
      for (const match of played) {
        const withTicket = ticketSeatsByMatch.get(match.id) ?? new Set<string>();
        for (const seatId of this.passSeatsValidFor(match, activePasses)) {
          if (!withTicket.has(seatId)) bump(seatId);
        }
      }
    }

    return {
      season: seasonDto(season),
      generatedAt: now.toISOString(),
      matchCount: played.length,
      sectors: sectors.map((sec) => ({
        code: sec.code,
        name: sec.name,
        arc: sec.arc,
        position: sec.position,
        isAway: sec.isAway,
      })),
      seats: seats.map((s) => ({
        section: s.section,
        row: s.row,
        number: s.number,
        taken: taken.get(s.id) ?? 0,
      })),
    };
  }

  private async activePasses(): Promise<SeasonPass[]> {
    return this.passRepository.find({
      where: { status: SeasonPassStatus.ACTIVE },
      select: ['seatId', 'validFrom', 'validUntil'],
    });
  }

  /** The seats of the active passes that give an entry to this match. */
  private passSeatsValidFor(match: Match, passes: readonly SeasonPass[]): Set<string> {
    return new Set(
      passes
        .filter((p) => passCoversMatch(match, p))
        .map((p) => p.seatId)
        .filter((id): id is string => !!id),
    );
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
