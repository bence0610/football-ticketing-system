import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { LessThan, Not, Repository } from 'typeorm';
import {
  Match,
  MatchStatus,
  Ticket,
  TicketStatus,
  Waitlist,
  WaitlistStatus,
} from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { JoinWaitlistDto, WaitlistEntryDto } from './dto';

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [TicketStatus.PAID, TicketStatus.PENDING_PAYMENT];

const ACTIVE_WAITLIST_STATUSES: WaitlistStatus[] = [WaitlistStatus.ACTIVE, WaitlistStatus.NOTIFIED];

@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @InjectRepository(Waitlist)
    private readonly waitlistRepository: Repository<Waitlist>,
    @InjectRepository(Match)
    private readonly matchRepository: Repository<Match>,
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async count(): Promise<number> {
    return this.waitlistRepository.count();
  }

  /**
   * Joins the waitlist for a match. Only allowed when:
   *  - the match exists and is not finished/cancelled,
   *  - the match is currently sold out (capacity reached for active tickets),
   *  - the user does not already have an active or notified entry.
   */
  async joinWaitlist(userId: string, dto: JoinWaitlistDto): Promise<WaitlistEntryDto> {
    const match = await this.matchRepository.findOne({ where: { id: dto.matchId } });
    if (!match) {
      throw new NotFoundException('Meccs nem található.');
    }
    if (match.status === MatchStatus.FINISHED || match.status === MatchStatus.CANCELLED) {
      throw new BadRequestException('A meccs már lezárult, nem lehet várólistára kerülni.');
    }

    const totalActive = await this.getActiveTicketCount(dto.matchId);
    if (match.capacity > 0 && totalActive < match.capacity) {
      throw new BadRequestException('A meccsen még van szabad hely, nincs szükség várólistára.');
    }

    const existing = await this.waitlistRepository.findOne({
      where: { userId, matchId: dto.matchId },
    });
    if (existing && ACTIVE_WAITLIST_STATUSES.includes(existing.status)) {
      throw new ConflictException('Már szerepelsz a várólistán erre a meccsre.');
    }

    let saved: Waitlist;
    if (existing) {
      // Re-activate cancelled / expired entries — keeps the user's history but
      // resets their queue position to "now".
      existing.status = WaitlistStatus.ACTIVE;
      existing.requestedQuantity = dto.requestedQuantity ?? 1;
      existing.preferredSection = dto.preferredSection;
      existing.notifiedAt = undefined;
      // createdAt is the FIFO key; update it so the user joins at the back.
      existing.createdAt = new Date();
      saved = await this.waitlistRepository.save(existing);
    } else {
      const entry = this.waitlistRepository.create({
        userId,
        matchId: dto.matchId,
        status: WaitlistStatus.ACTIVE,
        requestedQuantity: dto.requestedQuantity ?? 1,
        preferredSection: dto.preferredSection,
      });
      saved = await this.waitlistRepository.save(entry);
    }

    this.logger.log(`User ${userId} joined waitlist for match ${dto.matchId}`);
    return this.toDto(saved, await this.computePeopleAhead(saved));
  }

  /**
   * Removes the user from the waitlist (status -> CANCELLED). Idempotent —
   * returns silently when the entry is missing or already inactive.
   */
  async leaveWaitlist(userId: string, matchId: string): Promise<void> {
    const entry = await this.waitlistRepository.findOne({
      where: { userId, matchId },
    });
    if (!entry) {
      return;
    }
    if (entry.status === WaitlistStatus.CANCELLED || entry.status === WaitlistStatus.CONVERTED) {
      return;
    }
    entry.status = WaitlistStatus.CANCELLED;
    await this.waitlistRepository.save(entry);
    // Clear any pending claim slot.
    await this.redis.del(RedisKeys.waitlistClaim(matchId, userId));
    this.logger.log(`User ${userId} left waitlist for match ${matchId}`);
  }

  /**
   * Returns all of the user's active or notified waitlist entries enriched
   * with FIFO position, claim TTL (when notified), and match summary.
   */
  async getMyEntries(userId: string): Promise<WaitlistEntryDto[]> {
    const entries = await this.waitlistRepository
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.match', 'm')
      .where('w.userId = :userId', { userId })
      .andWhere('w.status IN (:...statuses)', { statuses: ACTIVE_WAITLIST_STATUSES })
      .orderBy('m.kickoffAt', 'ASC')
      .getMany();

    const result: WaitlistEntryDto[] = [];
    for (const entry of entries) {
      const peopleAhead = await this.computePeopleAhead(entry);
      result.push(await this.toDtoWithClaim(entry, peopleAhead));
    }
    return result;
  }

  /**
   * Returns the next entry in FIFO order that is still ACTIVE for the given
   * match, or `null` when the queue is empty / fully notified.
   */
  async findNextActive(matchId: string): Promise<Waitlist | null> {
    return this.waitlistRepository.findOne({
      where: { matchId, status: WaitlistStatus.ACTIVE },
      order: { createdAt: 'ASC' },
      relations: ['user', 'match'],
    });
  }

  /**
   * Returns waitlist entries that are currently in NOTIFIED state and whose
   * notifiedAt timestamp is older than the supplied cutoff. Used by the
   * notification cron to detect expired claim slots.
   */
  async findExpiredNotifications(notifiedBefore: Date): Promise<Waitlist[]> {
    return this.waitlistRepository.find({
      where: {
        status: WaitlistStatus.NOTIFIED,
        notifiedAt: LessThan(notifiedBefore),
      },
      relations: ['match'],
    });
  }

  /**
   * Sets an entry's status. Used by WaitlistNotificationService.
   */
  async updateStatus(
    entryId: string,
    status: WaitlistStatus,
    notifiedAt?: Date | null,
  ): Promise<void> {
    const updates: Partial<Waitlist> = { status };
    if (notifiedAt !== undefined) {
      updates.notifiedAt = notifiedAt ?? undefined;
    }
    await this.waitlistRepository.update({ id: entryId }, updates);
  }

  /**
   * Counts how many ACTIVE entries with strictly earlier createdAt exist
   * for the same match. NOTIFIED entries are NOT counted (they're already
   * past the user in the queue).
   */
  private async computePeopleAhead(entry: Waitlist): Promise<number> {
    return this.waitlistRepository.count({
      where: {
        matchId: entry.matchId,
        status: WaitlistStatus.ACTIVE,
        createdAt: LessThan(entry.createdAt),
        id: Not(entry.id),
      },
    });
  }

  private async toDtoWithClaim(entry: Waitlist, peopleAhead: number): Promise<WaitlistEntryDto> {
    const dto = this.toDto(entry, peopleAhead);
    if (entry.status === WaitlistStatus.NOTIFIED) {
      const ttl = await this.redis.ttl(RedisKeys.waitlistClaim(entry.matchId, entry.userId));
      if (ttl > 0) {
        dto.claimExpiresAt = new Date(Date.now() + ttl * 1000).toISOString();
      }
    }
    if (entry.match) {
      dto.match = {
        id: entry.match.id,
        homeTeam: entry.match.homeTeam,
        awayTeam: entry.match.awayTeam,
        venue: entry.match.venue,
        kickoffAt: entry.match.kickoffAt.toISOString(),
      };
    }
    return dto;
  }

  private toDto(entry: Waitlist, peopleAhead: number): WaitlistEntryDto {
    return {
      id: entry.id,
      matchId: entry.matchId,
      status: entry.status,
      requestedQuantity: entry.requestedQuantity,
      preferredSection: entry.preferredSection,
      position: peopleAhead + 1,
      peopleAhead,
      createdAt: entry.createdAt.toISOString(),
      notifiedAt: entry.notifiedAt?.toISOString(),
    };
  }

  /**
   * Returns how many seats are currently held (paid + pending) on the match.
   */
  async getActiveTicketCount(matchId: string): Promise<number> {
    return this.ticketRepository
      .createQueryBuilder('t')
      .where('t.matchId = :matchId', { matchId })
      .andWhere('t.status IN (:...statuses)', { statuses: ACTIVE_TICKET_STATUSES })
      .getCount();
  }

  /**
   * Returns true when at least one seat is available on the match (or the
   * match has no capacity limit configured). Used by the notification flow
   * to know whether it's worth offering the next slot.
   */
  async hasAvailability(matchId: string): Promise<boolean> {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return false;
    }
    if (match.capacity <= 0) {
      return true;
    }
    const active = await this.getActiveTicketCount(matchId);
    return active < match.capacity;
  }

  /**
   * Looks up an entry by its primary key — used by the claim/expire flows.
   */
  async findEntryById(id: string): Promise<Waitlist | null> {
    return this.waitlistRepository.findOne({
      where: { id },
      relations: ['user', 'match'],
    });
  }

  /**
   * Returns the user's still-active (ACTIVE or NOTIFIED) entry for a given
   * match, or null. Used by the claim-confirmation endpoint.
   */
  async findUserEntry(userId: string, matchId: string): Promise<Waitlist | null> {
    return this.waitlistRepository.findOne({
      where: { userId, matchId },
      relations: ['match'],
    });
  }
}
