import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, MoreThan, Repository } from 'typeorm';
import { ChatbotConfig } from '../../config';
import { Match, MatchStatus, Ticket, TicketStatus } from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [TicketStatus.PAID, TicketStatus.PENDING_PAYMENT];

const UPCOMING_STATUSES: MatchStatus[] = [MatchStatus.ON_SALE, MatchStatus.SCHEDULED];

export interface ChatbotMatchSnapshot {
  id: string;
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

  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
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
      upcomingMatches: matches.map((match) =>
        this.toSnapshot(match, aggregates.get(match.id) ?? 0),
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
      .andWhere('t.status IN (:...statuses)', { statuses: ACTIVE_TICKET_STATUSES })
      .groupBy('t.matchId')
      .getRawMany<{ matchId: string; soldCount: string | number }>();
    for (const row of rows) {
      result.set(row.matchId, Number(row.soldCount));
    }
    return result;
  }

  private toSnapshot(match: Match, sold: number): ChatbotMatchSnapshot {
    const available = Math.max(0, match.capacity - sold);
    const occupancy = match.capacity > 0 ? Math.round((sold / match.capacity) * 100) : 0;
    return {
      id: match.id,
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
    };
  }
}
