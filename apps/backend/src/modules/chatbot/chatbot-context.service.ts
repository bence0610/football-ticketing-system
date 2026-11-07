import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, MoreThan, Repository } from 'typeorm';
import { AppConfig, ChatbotConfig } from '../../config';
import { Match, MatchStatus, Ticket } from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { isHomeMatch } from '../matches/match-home';
import { SeatsService } from '../seats/seats.service';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';

const UPCOMING_STATUSES: MatchStatus[] = [MatchStatus.ON_SALE, MatchStatus.SCHEDULED];

/** Per-sector counts, taken from the seat map's own sector summary. */
export interface ChatbotSectorSnapshot {
  section: string;
  total: number;
  free: number;
  sold: number;
  locked: number;
}

export interface ChatbotMatchSnapshot {
  id: string;
  /** True when the home side is the configured club (same rule as the match list). */
  isHome: boolean;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  venue: string;
  kickoffAt: string;
  status: string;
  basePrice: number;
  capacity: number;
  soldSeats: number;
  availableSeats: number;
  occupancyPercent: number;
  /** null = the sector data could not be loaded; [] never means "no seats". */
  sectors: ChatbotSectorSnapshot[] | null;
}

export interface ChatbotContextSnapshot {
  generatedAt: string;
  upcomingMatches: ChatbotMatchSnapshot[];
}

const TOP_MATCHES = 5;

@Injectable()
export class ChatbotContextService {
  private readonly logger = new Logger(ChatbotContextService.name);
  private readonly cacheTtlSeconds: number;
  private readonly homeTeamName: string;

  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly seatsService: SeatsService,
    configService: ConfigService,
  ) {
    this.homeTeamName = configService.getOrThrow<AppConfig>('app').homeTeamName;
    const config = configService.getOrThrow<ChatbotConfig>('chatbot');
    this.cacheTtlSeconds = config.contextCacheTtlSeconds;
  }

  /**
   * Returns the next 5 upcoming matches enriched with capacity / sold-out
   * aggregates. Cached in Redis for {@link cacheTtlSeconds} so the chatbot
   * doesn't hammer the DB on every prompt.
   */
  async getUpcomingMatchesSnapshot(): Promise<ChatbotContextSnapshot> {
    const cacheKey = RedisKeys.chatbotContext();
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as ChatbotContextSnapshot;
      }
    } catch (error) {
      this.logger.warn(`Chatbot context cache read failed: ${(error as Error).message}`);
    }

    const matches = await this.matchRepository.find({
      where: {
        status: In(UPCOMING_STATUSES),
        kickoffAt: MoreThan(new Date()),
      },
      order: { kickoffAt: 'ASC' },
      take: TOP_MATCHES,
    });

    const aggregates = await this.aggregateSold(matches.map((m) => m.id));
    const snapshot: ChatbotContextSnapshot = {
      generatedAt: new Date().toISOString(),
      upcomingMatches: await Promise.all(
        matches.map(async (match) =>
          this.toSnapshot(match, aggregates.get(match.id) ?? 0, await this.loadSectors(match.id)),
        ),
      ),
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(snapshot), 'EX', this.cacheTtlSeconds);
    } catch (error) {
      this.logger.warn(`Chatbot context cache write failed: ${(error as Error).message}`);
    }
    return snapshot;
  }

  private async aggregateSold(matchIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (matchIds.length === 0) {
      return result;
    }
    const rows = await this.ticketRepository
      .createQueryBuilder('t')
      .select('t.matchId', 'matchId')
      .addSelect('COUNT(t.id)', 'soldCount')
      .where('t.matchId IN (:...matchIds)', { matchIds })
      .andWhere('t.status IN (:...statuses)', { statuses: [...OCCUPYING_TICKET_STATUSES] })
      .groupBy('t.matchId')
      .getRawMany<{ matchId: string; soldCount: string | number }>();
    for (const row of rows) {
      result.set(row.matchId, Number(row.soldCount));
    }
    return result;
  }

  /** Reuses the seat map's sector summary so the chatbot and the UI agree. */
  private async loadSectors(matchId: string): Promise<ChatbotSectorSnapshot[] | null> {
    try {
      const { sectorSummary } = await this.seatsService.findSeatsForMatch(matchId);
      return sectorSummary.map((s) => ({
        section: s.section,
        total: s.total,
        free: s.available,
        sold: s.sold,
        locked: s.locked,
      }));
    } catch (error) {
      this.logger.warn(`Chatbot sector data failed for ${matchId}: ${(error as Error).message}`);
      return null;
    }
  }

  private toSnapshot(
    match: Match,
    sold: number,
    sectors: ChatbotSectorSnapshot[] | null,
  ): ChatbotMatchSnapshot {
    const available = Math.max(0, match.capacity - sold);
    const occupancy = match.capacity > 0 ? Math.round((sold / match.capacity) * 100) : 0;
    return {
      id: match.id,
      isHome: isHomeMatch(match, this.homeTeamName),
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      competition: match.competition,
      venue: match.venue,
      kickoffAt: match.kickoffAt.toISOString(),
      status: match.status,
      basePrice: Math.round(Number(match.basePrice)),
      capacity: match.capacity,
      soldSeats: sold,
      availableSeats: available,
      occupancyPercent: occupancy,
      sectors,
    };
  }
}
