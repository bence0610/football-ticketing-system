import { assertMatchNotStarted } from '../matches/match-sale';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { Match, Seat, SeasonPass, SeasonPassStatus, Sector, Ticket } from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';
import { compareSeats } from './seat-order';
import { seatUnitPrice } from './seat-pricing';
import { compareSectors } from './sector-catalogue.service';
import { MatchSeatsResponseDto, SeatAvailability, SeatStatusDto, SectorSummaryDto } from './dto';

@Injectable()
export class SeatsService {
  private readonly logger = new Logger(SeatsService.name);

  constructor(
    @InjectRepository(Seat)
    private readonly seatRepository: Repository<Seat>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
    @InjectRepository(SeasonPass)
    private readonly seasonPassRepository: Repository<SeasonPass>,
    @InjectRepository(Sector)
    private readonly sectorRepository: Repository<Sector>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async findAll(): Promise<Seat[]> {
    const [seats, sectors] = await Promise.all([
      this.seatRepository.find({ where: { isActive: true } }),
      this.loadSectors(),
    ]);
    return seats.sort(compareSeats(this.positionsOf(sectors)));
  }

  /**
   * Composite seat-status response for a single match.
   * Combines seat catalogue (DB), sold/pending tickets (DB) and
   * volatile seat locks (one Redis MGET).
   */
  async findSeatsForMatch(matchId: string): Promise<MatchSeatsResponseDto> {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }

    // Only the columns the seat map shows: hydrating the timestamp and version columns of
    // 5,468 rows into entities was about half of this call's time (see seat-map-perf).
    const [allSeats, sectors] = await Promise.all([
      this.seatRepository.find({
        select: [
          'id',
          'section',
          'row',
          'number',
          'category',
          'priceModifier',
          'isAccessible',
          'isActive',
        ],
      }),
      this.loadSectors(),
    ]);
    // Stadium order (sector position, then numeric row, then seat number); the
    // database cannot sort rows numerically because they are stored as strings.
    const seats = allSeats.sort(compareSeats(this.positionsOf(sectors)));

    const tickets = await this.ticketRepository.find({
      where: { matchId, status: In([...OCCUPYING_TICKET_STATUSES]) },
      select: ['seatId', 'status'],
    });
    // Defensive in-code filter: only count tickets whose status is in
    // OCCUPYING_TICKET_STATUSES (PENDING_PAYMENT / PAID / USED) as occupying
    // a seat. CANCELLED, REFUNDED, EXPIRED tickets must leave the seat available.
    const soldSeatIds = new Set<string>(
      tickets
        .filter((ticket) => OCCUPYING_TICKET_STATUSES.includes(ticket.status))
        .map((ticket) => ticket.seatId),
    );

    const lockedSeatIds = await this.fetchLockedSeatIds(
      matchId,
      seats.map((s) => s.id),
    );
    const seasonPassSeatIds = await this.fetchSeasonPassSeatIds();
    const awaySections = this.awaySectionsOf(sectors);

    const basePrice = Number(match.basePrice);
    const seatStatuses: SeatStatusDto[] = seats.map((seat) =>
      this.toSeatStatus(
        seat,
        basePrice,
        soldSeatIds,
        lockedSeatIds,
        seasonPassSeatIds,
        awaySections,
      ),
    );

    const sectorSummary = this.buildSectorSummary(seatStatuses, sectors);

    return {
      matchId,
      seats: seatStatuses,
      sectorSummary,
    };
  }

  /**
   * Refuses a match that cannot be bought: unknown (404), or already kicked off
   * (409 `match_started`). The seat lock calls this before anything else.
   */
  async assertMatchOpenForSale(matchId: string): Promise<void> {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }
    assertMatchNotStarted(match);
  }

  /**
   * Resolves the current availability of the given seats for a specific match.
   * Queries DB and Redis at call time — safe to use at payment time to guard
   * against races that occurred after the initial seat lock.
   */
  async resolveAvailabilityForSeats(
    matchId: string,
    seatIds: string[],
  ): Promise<Map<string, SeatAvailability>> {
    if (seatIds.length === 0) {
      return new Map();
    }

    const seats = await this.seatRepository.find({
      where: { id: In(seatIds) },
    });

    const tickets = await this.ticketRepository.find({
      where: { matchId, seatId: In(seatIds), status: In([...OCCUPYING_TICKET_STATUSES]) },
      select: ['seatId'],
    });
    const soldSeatIds = new Set<string>(tickets.map((t) => t.seatId));

    const lockedSeatIds = await this.fetchLockedSeatIds(matchId, seatIds);
    const seasonPassSeatIds = await this.fetchSeasonPassSeatIds();
    const awaySections = this.awaySectionsOf(await this.loadSectors());

    const result = new Map<string, SeatAvailability>();
    for (const seat of seats) {
      result.set(
        seat.id,
        this.computeSeatAvailability(
          seat,
          soldSeatIds,
          lockedSeatIds,
          seasonPassSeatIds,
          awaySections,
        ),
      );
    }
    return result;
  }

  /**
   * Loads the Redis seat-lock keys for the given seat ids with ONE `MGET`, which
   * returns the values in key order. (It replaced a pipeline of one GET per seat:
   * at 5,468 seats the pipeline's per-command overhead made the Redis step about
   * two and a half times slower - see test/seat-map-perf.e2e-spec.ts.) Falls back
   * gracefully (treats every seat as unlocked) if Redis is unavailable.
   */
  private async fetchLockedSeatIds(matchId: string, seatIds: string[]): Promise<Set<string>> {
    if (seatIds.length === 0) {
      return new Set<string>();
    }

    try {
      const values = await this.redis.mget(
        ...seatIds.map((seatId) => RedisKeys.seatLock(matchId, seatId)),
      );
      const locked = new Set<string>();
      values.forEach((value, index) => {
        if (value !== null && value !== undefined) {
          locked.add(seatIds[index]);
        }
      });
      return locked;
    } catch (error) {
      this.logger.warn(
        `Redis MGET failed; treating all seats as unlocked. ${error instanceof Error ? error.message : error}`,
      );
      return new Set<string>();
    }
  }

  /**
   * Fetches the set of seat ids occupied by ACTIVE season passes. These
   * seats are surfaced on the seat map with a distinct status so the
   * UI can render them visually different (and disable click-to-buy).
   * Gracefully degrades to an empty set if the lookup fails.
   */
  private async fetchSeasonPassSeatIds(): Promise<Set<string>> {
    try {
      const rows = await this.seasonPassRepository.find({
        where: { status: SeasonPassStatus.ACTIVE },
        select: ['seatId'],
      });
      return new Set(
        rows
          .map((r) => r.seatId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to load season-pass seat ids: ${error instanceof Error ? error.message : error}`,
      );
      return new Set<string>();
    }
  }

  private toSeatStatus(
    seat: Seat,
    basePrice: number,
    soldSeatIds: Set<string>,
    lockedSeatIds: Set<string>,
    seasonPassSeatIds: Set<string>,
    awaySections: ReadonlySet<string>,
  ): SeatStatusDto {
    const status = this.computeSeatAvailability(
      seat,
      soldSeatIds,
      lockedSeatIds,
      seasonPassSeatIds,
      awaySections,
    );
    const price = seatUnitPrice(basePrice, seat.priceModifier);

    return {
      id: seat.id,
      section: seat.section,
      row: seat.row,
      number: seat.number,
      category: seat.category,
      price,
      status,
      isAccessible: seat.isAccessible,
    };
  }

  private computeSeatAvailability(
    seat: Seat,
    soldSeatIds: Set<string>,
    lockedSeatIds: Set<string>,
    seasonPassSeatIds: Set<string>,
    awaySections: ReadonlySet<string>,
  ): SeatAvailability {
    if (!seat.isActive) {
      return SeatAvailability.DISABLED;
    }
    // The away section is never for sale through the portal, whatever else is true of the seat.
    if (awaySections.has(seat.section)) {
      return SeatAvailability.AWAY;
    }
    if (soldSeatIds.has(seat.id)) {
      return SeatAvailability.SOLD;
    }
    if (seasonPassSeatIds.has(seat.id)) {
      return SeatAvailability.SEASON_PASS;
    }
    if (lockedSeatIds.has(seat.id)) {
      return SeatAvailability.LOCKED;
    }
    return SeatAvailability.AVAILABLE;
  }

  /** The `sectors` table, the single source of truth for coverage, gate, order and away flag. */
  private async loadSectors(): Promise<Map<string, Sector>> {
    const sectors = await this.sectorRepository.find();
    return new Map(sectors.map((s) => [s.code, s]));
  }

  private awaySectionsOf(sectors: ReadonlyMap<string, Sector>): Set<string> {
    return new Set([...sectors.values()].filter((s) => s.isAway).map((s) => s.code));
  }

  /** code -> place in the stadium order (upper arc first, west to east). */
  private positionsOf(sectors: ReadonlyMap<string, Sector>): Map<string, number> {
    return new Map([...sectors.values()].sort(compareSectors).map((s, i) => [s.code, i + 1]));
  }

  private buildSectorSummary(
    seats: SeatStatusDto[],
    sectors: ReadonlyMap<string, Sector> = new Map(),
  ): SectorSummaryDto[] {
    const map = new Map<string, SectorSummaryDto>();

    for (const seat of seats) {
      let summary = map.get(seat.section);
      if (!summary) {
        const sector = sectors.get(seat.section);
        summary = {
          section: seat.section,
          // no row for a sector means no information, not "open" and not "gate 1"
          name: sector?.name ?? seat.section,
          arc: sector?.arc ?? null,
          position: sector?.position ?? null,
          gate: sector?.gate ?? null,
          priceCategory: sector?.priceCategory ?? null,
          isAway: sector?.isAway ?? false,
          covered: sector ? sector.isCovered : null,
          total: 0,
          available: 0,
          locked: 0,
          sold: 0,
          occupancyRatio: 0,
          minPrice: seat.price,
          maxPrice: seat.price,
        };
        map.set(seat.section, summary);
      }
      summary.total += 1;
      summary.minPrice = Math.min(summary.minPrice, seat.price);
      summary.maxPrice = Math.max(summary.maxPrice, seat.price);
      switch (seat.status) {
        case SeatAvailability.AVAILABLE:
          summary.available += 1;
          break;
        case SeatAvailability.LOCKED:
          summary.locked += 1;
          break;
        case SeatAvailability.SOLD:
          summary.sold += 1;
          break;
        default:
          break;
      }
    }

    return Array.from(map.values())
      .map((summary) => ({
        ...summary,
        occupancyRatio:
          summary.total === 0
            ? 0
            : Number(((summary.locked + summary.sold) / summary.total).toFixed(2)),
      }))
      .sort((a, b) => compareSectors(sectorLike(a), sectorLike(b)));
  }
}

function sectorLike(s: SectorSummaryDto): Pick<Sector, 'arc' | 'position' | 'code'> {
  return {
    arc: s.arc ?? 'lower',
    position: s.position ?? Number.MAX_SAFE_INTEGER,
    code: s.section,
  };
}
