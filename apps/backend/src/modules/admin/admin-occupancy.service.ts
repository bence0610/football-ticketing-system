import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, Repository } from 'typeorm';
import { AppConfig } from '../../config';
import { Match, Seat, Ticket } from '../../database/entities';
import { isHomeMatch } from '../matches/match-home';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';
import { MatchOccupancyDto, SectorOccupancyDto } from './dto/occupancy.dto';
import { findSellableSeats } from './sellable-seats';

@Injectable()
export class AdminOccupancyService {
  private readonly logger = new Logger(AdminOccupancyService.name);

  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(Seat) private readonly seatRepository: Repository<Seat>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.homeTeamName = configService.getOrThrow<AppConfig>('app').homeTeamName;
  }

  private readonly homeTeamName: string;

  /**
   * Returns per-sector occupancy for the heatmap, plus totals.
   *
   * Only the sellable seats take part: the away section is never sold here, so it is in
   * neither the sectors nor the totals, and a sold-out home match reads exactly 100%. An
   * away match has no sales to measure and is refused.
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

    if (!isHomeMatch(match, this.homeTeamName)) {
      throw new BadRequestException(
        'Idegenbeli mérkőzésre nem értékesítünk jegyet, ezért nincs kihasználtság.',
      );
    }

    const seats = await findSellableSeats(this.seatRepository);

    const tickets = await this.ticketRepository.find({
      where: { matchId, status: In([...OCCUPYING_TICKET_STATUSES]) },
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
