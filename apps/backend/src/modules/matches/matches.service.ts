import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../../config';
import { Match, MatchStatus, Ticket, TicketStatus } from '../../database/entities';
import { MatchDetailDto, MatchListItemDto, QueryMatchesDto } from './dto';

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [TicketStatus.PAID, TicketStatus.PENDING_PAYMENT];

const UPCOMING_STATUSES: MatchStatus[] = [MatchStatus.ON_SALE, MatchStatus.SCHEDULED];

@Injectable()
export class MatchesService {
  private readonly homeTeamName: string;

  constructor(
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    private readonly configService: ConfigService,
  ) {
    const appConfig = this.configService.getOrThrow<AppConfig>('app');
    this.homeTeamName = appConfig.homeTeamName;
  }

  /**
   * Returns matches filtered by query params. Each row is enriched with
   * `availableSeats` (capacity - active tickets) and a `isHome` badge.
   */
  async findAll(query: QueryMatchesDto): Promise<MatchListItemDto[]> {
    const qb = this.matchRepository
      .createQueryBuilder('match')
      .orderBy('match.kickoffAt', 'ASC')
      .limit(query.limit ?? 50);

    if (query.status) {
      qb.andWhere('match.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('match.kickoffAt >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('match.kickoffAt <= :to', { to: query.to });
    }

    const matches = await qb.getMany();
    const soldByMatch = await this.aggregateSoldTickets(matches.map((m) => m.id));
    return matches.map((match) => this.toListItem(match, soldByMatch.get(match.id) ?? 0));
  }

  /**
   * Returns the next upcoming on_sale / scheduled matches, ordered by kickoff ASC.
   */
  async findUpcoming(limit = 5): Promise<MatchListItemDto[]> {
    const now = new Date();

    const matches = await this.matchRepository
      .createQueryBuilder('match')
      .where('match.status IN (:...statuses)', { statuses: UPCOMING_STATUSES })
      .andWhere('match.kickoffAt > :now', { now })
      .orderBy('match.kickoffAt', 'ASC')
      .limit(limit)
      .getMany();

    const soldByMatch = await this.aggregateSoldTickets(matches.map((m) => m.id));
    return matches.map((match) => this.toListItem(match, soldByMatch.get(match.id) ?? 0));
  }

  /**
   * Returns a single match by id, or `null` if not found.
   */
  async findOne(id: string): Promise<MatchDetailDto | null> {
    const match = await this.matchRepository.findOne({ where: { id } });
    if (!match) {
      return null;
    }
    const soldByMatch = await this.aggregateSoldTickets([id]);
    return this.toDetail(match, soldByMatch.get(id) ?? 0);
  }

  /**
   * Returns the entity-level match (used by other modules that need the
   * raw record, e.g. the Seats module).
   */
  async findEntity(id: string): Promise<Match | null> {
    return this.matchRepository.findOne({ where: { id } });
  }

  /**
   * Returns a `Map<matchId, soldCount>` for the supplied match ids.
   * Sold = paid OR pending_payment (i.e. unavailable to other buyers).
   */
  private async aggregateSoldTickets(matchIds: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (matchIds.length === 0) {
      return result;
    }

    const rows = await this.ticketRepository
      .createQueryBuilder('ticket')
      .select('ticket.matchId', 'matchId')
      .addSelect('COUNT(ticket.id)', 'soldCount')
      .where('ticket.matchId IN (:...matchIds)', { matchIds })
      .andWhere('ticket.status IN (:...statuses)', { statuses: ACTIVE_TICKET_STATUSES })
      .groupBy('ticket.matchId')
      .getRawMany<{ matchId: string; soldCount: string | number }>();

    for (const row of rows) {
      result.set(row.matchId, Number(row.soldCount));
    }
    return result;
  }

  private toListItem(match: Match, sold: number): MatchListItemDto {
    const available = Math.max(0, match.capacity - sold);
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
      availableSeats: available,
      isHome: match.homeTeam === this.homeTeamName,
      bannerImageUrl: match.bannerImageUrl,
      isSeasonPassEligible: match.isSeasonPassEligible,
    };
  }

  private toDetail(match: Match, sold: number): MatchDetailDto {
    return {
      ...this.toListItem(match, sold),
      description: match.description,
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
    };
  }
}
