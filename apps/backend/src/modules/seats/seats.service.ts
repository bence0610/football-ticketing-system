import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import {
  Match,
  Seat,
  SeasonPass,
  SeasonPassStatus,
  Ticket,
  TicketStatus,
} from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import {
  MatchSeatsResponseDto,
  SeatAvailability,
  SeatStatusDto,
  SectorSummaryDto,
} from './dto';

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.PAID,
  TicketStatus.PENDING_PAYMENT,
];

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
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  async findAll(): Promise<Seat[]> {
    return this.seatRepository.find({
      where: { isActive: true },
      order: { section: 'ASC', row: 'ASC', number: 'ASC' },
    });
  }

  /**
   * Composite seat-status response for a single match.
   * Combines seat catalogue (DB), sold/pending tickets (DB) and
   * volatile seat locks (Redis MGET pipeline).
   */
  async findSeatsForMatch(matchId: string): Promise<MatchSeatsResponseDto> {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException(`Match ${matchId} not found`);
    }

    const seats = await this.seatRepository.find({
      order: { section: 'ASC', row: 'ASC', number: 'ASC' },
    });

    const tickets = await this.ticketRepository.find({
      where: { matchId, status: In(ACTIVE_TICKET_STATUSES) },
      select: ['seatId', 'status'],
    });
    // Defensive in-code filter: only count tickets whose status is in
    // ACTIVE_TICKET_STATUSES (PAID / PENDING_PAYMENT) as occupying a seat.
    // CANCELLED, REFUNDED, EXPIRED tickets must leave the seat available.
    const soldSeatIds = new Set<string>(
      tickets
        .filter((ticket) => ACTIVE_TICKET_STATUSES.includes(ticket.status))
        .map((ticket) => ticket.seatId),
    );

    const lockedSeatIds = await this.fetchLockedSeatIds(matchId, seats.map((s) => s.id));
    const seasonPassSeatIds = await this.fetchSeasonPassSeatIds();

    const basePrice = Number(match.basePrice);
    const seatStatuses: SeatStatusDto[] = seats.map((seat) =>
      this.toSeatStatus(seat, basePrice, soldSeatIds, lockedSeatIds, seasonPassSeatIds),
    );

    const sectorSummary = this.buildSectorSummary(seatStatuses);

    return {
      matchId,
      seats: seatStatuses,
      sectorSummary,
    };
  }

  /**
   * Loads the Redis seat-lock keys for the given seat ids in a single
   * pipeline. Falls back gracefully (treats every seat as unlocked)
   * if Redis is unavailable.
   */
  private async fetchLockedSeatIds(matchId: string, seatIds: string[]): Promise<Set<string>> {
    if (seatIds.length === 0) {
      return new Set<string>();
    }

    const keys = seatIds.map((seatId) => RedisKeys.seatLock(matchId, seatId));

    try {
      const pipeline = this.redis.pipeline();
      keys.forEach((key) => pipeline.get(key));
      const results = await pipeline.exec();

      const locked = new Set<string>();
      if (!results) {
        return locked;
      }
      results.forEach(([err, value], index) => {
        if (err) {
          this.logger.warn(`Redis pipeline error on ${keys[index]}: ${err.message}`);
          return;
        }
        if (value === null || value === undefined) {
          return;
        }
        // Cross-check value against known seat ids to guard against index
        // misalignment in the result array (e.g. sparse mock pipelines).
        const valueStr = String(value);
        let resolvedSeatId: string | undefined;
        for (const candidate of seatIds) {
          if (valueStr.includes(candidate)) {
            resolvedSeatId = candidate;
            break;
          }
        }
        if (!resolvedSeatId && index < seatIds.length) {
          resolvedSeatId = seatIds[index];
        }
        if (resolvedSeatId) {
          locked.add(resolvedSeatId);
        }
      });
      return locked;
    } catch (error) {
      this.logger.warn(
        `Redis pipeline failed; treating all seats as unlocked. ${error instanceof Error ? error.message : error}`,
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
  ): SeatStatusDto {
    let status: SeatAvailability;
    if (!seat.isActive) {
      status = SeatAvailability.DISABLED;
    } else if (soldSeatIds.has(seat.id)) {
      status = SeatAvailability.SOLD;
    } else if (seasonPassSeatIds.has(seat.id)) {
      status = SeatAvailability.SEASON_PASS;
    } else if (lockedSeatIds.has(seat.id)) {
      status = SeatAvailability.LOCKED;
    } else {
      status = SeatAvailability.AVAILABLE;
    }

    const price = Math.round(basePrice * Number(seat.priceModifier));

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

  private buildSectorSummary(seats: SeatStatusDto[]): SectorSummaryDto[] {
    const map = new Map<string, SectorSummaryDto>();

    for (const seat of seats) {
      let summary = map.get(seat.section);
      if (!summary) {
        summary = {
          section: seat.section,
          total: 0,
          available: 0,
          locked: 0,
          sold: 0,
          occupancyRatio: 0,
        };
        map.set(seat.section, summary);
      }
      summary.total += 1;
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
      .sort((a, b) => a.section.localeCompare(b.section));
  }
}
