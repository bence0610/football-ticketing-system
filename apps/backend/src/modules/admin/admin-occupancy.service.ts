import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { Match, Seat, Ticket, TicketStatus } from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { MatchOccupancyDto, SectorOccupancyDto } from './dto/occupancy.dto';

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [TicketStatus.PAID, TicketStatus.PENDING_PAYMENT];

@Injectable()
export class AdminOccupancyService {
  private readonly logger = new Logger(AdminOccupancyService.name);

  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(Seat) private readonly seatRepository: Repository<Seat>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Returns per-sector occupancy for the heatmap, plus stadium-wide totals.
   * Reads:
   *   - seats catalogue (DB),
   *   - active tickets for the match (DB),
   *   - Redis seat-locks via a single pipeline.
   */
  async getOccupancyForMatch(matchId: string): Promise<MatchOccupancyDto> {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException('Meccs nem található.');
    }

    const seats = await this.seatRepository.find({
      where: { isActive: true },
      order: { section: 'ASC' },
    });

    const tickets = await this.ticketRepository.find({
      where: { matchId, status: In(ACTIVE_TICKET_STATUSES) },
      select: ['seatId'],
    });
    const soldSeatIds = new Set(tickets.map((t) => t.seatId));

    const lockedSeatIds = await this.fetchLockedSeats(
      matchId,
      seats.map((s) => s.id),
    );

    const sectorMap = new Map<string, SectorOccupancyDto>();
    for (const seat of seats) {
      let sector = sectorMap.get(seat.section);
      if (!sector) {
        sector = {
          section: seat.section,
          total: 0,
          sold: 0,
          locked: 0,
          available: 0,
          occupancyPercent: 0,
        };
        sectorMap.set(seat.section, sector);
      }
      sector.total += 1;
      if (soldSeatIds.has(seat.id)) {
        sector.sold += 1;
      } else if (lockedSeatIds.has(seat.id)) {
        sector.locked += 1;
      } else {
        sector.available += 1;
      }
    }

    const sectors = Array.from(sectorMap.values())
      .map((sector) => ({
        ...sector,
        occupancyPercent:
          sector.total === 0 ? 0 : Math.round(((sector.sold + sector.locked) / sector.total) * 100),
      }))
      .sort((a, b) => a.section.localeCompare(b.section));

    const totalCapacity = sectors.reduce((acc, s) => acc + s.total, 0);
    const totalSold = sectors.reduce((acc, s) => acc + s.sold, 0);
    const totalLocked = sectors.reduce((acc, s) => acc + s.locked, 0);
    const totalAvailable = totalCapacity - totalSold - totalLocked;
    const occupancyPercent =
      totalCapacity === 0 ? 0 : Math.round(((totalSold + totalLocked) / totalCapacity) * 100);

    return {
      matchId: match.id,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      kickoffAt: match.kickoffAt.toISOString(),
      venue: match.venue,
      totalCapacity,
      totalSold,
      totalLocked,
      totalAvailable: Math.max(0, totalAvailable),
      occupancyPercent,
      sectors,
      generatedAt: new Date().toISOString(),
    };
  }

  private async fetchLockedSeats(matchId: string, seatIds: string[]): Promise<Set<string>> {
    if (seatIds.length === 0) {
      return new Set();
    }
    try {
      const pipeline = this.redis.pipeline();
      for (const seatId of seatIds) {
        pipeline.get(RedisKeys.seatLock(matchId, seatId));
      }
      const results = await pipeline.exec();
      const locked = new Set<string>();
      if (!results) {
        return locked;
      }
      results.forEach(([err, value], index) => {
        if (!err && value !== null && value !== undefined) {
          locked.add(seatIds[index]);
        }
      });
      return locked;
    } catch (error) {
      this.logger.warn(
        `Redis pipeline failed in occupancy report; treating all seats as unlocked. ${(error as Error).message}`,
      );
      return new Set();
    }
  }
}
