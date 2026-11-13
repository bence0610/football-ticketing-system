import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { In, MoreThan, Repository } from 'typeorm';
import {
  AppConfig,
  ChatbotConfig,
  CronConfig,
  LoyaltyConfig,
  RedisConfig,
  WaitlistConfig,
} from '../../config';
import { Match, MatchStatus, Ticket } from '../../database/entities';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';
import { TIER_DEFINITIONS } from '../loyalty/loyalty.constants';
import { isHomeMatch } from '../matches/match-home';
import { MAX_SEATS_PER_ORDER } from '../payments/dto/create-payment-intent.dto';
import { SeasonPassesService } from '../season-passes/season-passes.service';
import { SeatsService } from '../seats/seats.service';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';
import { FORECAST_HORIZON_HOURS, WeatherService } from '../weather/weather.service';

const UPCOMING_STATUSES: MatchStatus[] = [MatchStatus.ON_SALE, MatchStatus.SCHEDULED];

/** Per-sector counts, taken from the seat map's own sector summary. */
export interface ChatbotSectorSnapshot {
  section: string;
  /** Display name from the sectors table ("D/1 szektor", "VIP"); absent in older snapshots. */
  name?: string;
  /** The away section: not sold through the portal. Absent in older snapshots (= not away). */
  away?: boolean;
  /** Entrance gate 1..4, when known. */
  gate?: number | null;
  total: number;
  free: number;
  sold: number;
  locked: number;
  /** Ticket price in HUF, from the seat map's sector summary (see seatUnitPrice). */
  minPrice: number;
  maxPrice: number;
  /**
   * Is the sector under a roof, from the `sectors` table via the seat map's sector
   * summary. null = no data. Absent in snapshots cached before it existed - both
   * mean "unknown", never "open".
   */
  covered?: boolean | null;
}

/** Forecast for the kickoff; only present when the match is inside the forecast horizon. */
export interface ChatbotWeatherSnapshot {
  summary: string;
  temperatureCelsius: number;
  precipitationProbabilityPercent: number;
  rainWarning: boolean;
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
  /** Short match blurb from the club, truncated to keep the prompt small. */
  description: string | null;
  /** null = no forecast available (too far ahead, or the weather service had none). */
  weather: ChatbotWeatherSnapshot | null;
}

/** Season-pass catalogue, straight from SeasonPassesService.listPrices(). */
export interface ChatbotSeasonPassSnapshot {
  seasonLabel: string;
  validFrom: string;
  validUntil: string;
  prices: Array<{ section: string; sectionName: string; price: number }>;
}

/**
 * Operational rules that are numbers in configuration (not prose). Read from
 * the same config the features use and never cached, like the loyalty rules.
 */
export interface ChatbotRulesSnapshot {
  seatHoldMinutes: number;
  maxSeatsPerOrder: number;
  loanInvitationTtlHours: number;
  waitlistClaimMinutes: number;
}

/**
 * Loyalty programme rules. Built from loyalty.constants.ts (tiers) and the
 * loyalty config (point amounts) on every call — never typed in by hand and
 * never cached, so the chatbot cannot drift from the real rules.
 */
export interface ChatbotLoyaltySnapshot {
  tiers: Array<{ tier: string; label: string; minPoints: number; discountPercent: number }>;
  earning: {
    registration: number;
    profileCompletion: number;
    perTicket: number;
    seasonPass: number;
    passLoan: number;
  };
  /** Share of the balance kept at the yearly season-end reset. */
  carryoverPercent: number;
}

export interface ChatbotContextSnapshot {
  generatedAt: string;
  upcomingMatches: ChatbotMatchSnapshot[];
  loyalty: ChatbotLoyaltySnapshot;
  rules: ChatbotRulesSnapshot;
  /** null = the price list could not be loaded (the model must say it does not know). */
  seasonPass: ChatbotSeasonPassSnapshot | null;
}

/** The part that is cached in Redis; loyalty and rules are rebuilt on every call. */
type CachedPart = Omit<ChatbotContextSnapshot, 'loyalty' | 'rules'>;

const TOP_MATCHES = 5;
const DESCRIPTION_MAX_CHARS = 240;

@Injectable()
export class ChatbotContextService {
  private readonly logger = new Logger(ChatbotContextService.name);
  private readonly cacheTtlSeconds: number;
  private readonly homeTeamName: string;
  private readonly loyaltyConfig: LoyaltyConfig;
  private readonly rules: ChatbotRulesSnapshot;

  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @InjectRepository(Ticket) private readonly ticketRepository: Repository<Ticket>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly seatsService: SeatsService,
    private readonly seasonPassesService: SeasonPassesService,
    private readonly weatherService: WeatherService,
    configService: ConfigService,
  ) {
    this.homeTeamName = configService.getOrThrow<AppConfig>('app').homeTeamName;
    this.loyaltyConfig = configService.getOrThrow<LoyaltyConfig>('loyalty');
    this.rules = {
      seatHoldMinutes: Math.round(
        configService.getOrThrow<RedisConfig>('redis').seatLockTtlSeconds / 60,
      ),
      maxSeatsPerOrder: MAX_SEATS_PER_ORDER,
      loanInvitationTtlHours: configService.getOrThrow<CronConfig>('cron').loanInvitationTtlHours,
      waitlistClaimMinutes: Math.round(
        configService.getOrThrow<WaitlistConfig>('waitlist').claimTtlSeconds / 60,
      ),
    };
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
        // Matches come from the cache; loyalty and rules are always current.
        // Entries cached before a field existed simply lack it (undefined).
        const part = JSON.parse(cached) as CachedPart;
        return { ...part, seasonPass: part.seasonPass ?? null, ...this.buildLive() };
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
    const [upcomingMatches, seasonPass] = await Promise.all([
      Promise.all(
        matches.map(async (match) =>
          this.toSnapshot(
            match,
            aggregates.get(match.id) ?? 0,
            await this.loadSectors(match.id),
            await this.loadWeather(match),
          ),
        ),
      ),
      this.loadSeasonPass(),
    ]);
    const snapshot: CachedPart = {
      generatedAt: new Date().toISOString(),
      upcomingMatches,
      seasonPass,
    };

    try {
      await this.redis.set(cacheKey, JSON.stringify(snapshot), 'EX', this.cacheTtlSeconds);
    } catch (error) {
      this.logger.warn(`Chatbot context cache write failed: ${(error as Error).message}`);
    }
    return { ...snapshot, ...this.buildLive() };
  }

  private buildLive(): Pick<ChatbotContextSnapshot, 'loyalty' | 'rules'> {
    return { loyalty: this.buildLoyalty(), rules: { ...this.rules } };
  }

  /** Reuses the public price list the season-pass page itself shows. */
  private async loadSeasonPass(): Promise<ChatbotSeasonPassSnapshot | null> {
    try {
      const prices = await this.seasonPassesService.listPrices();
      if (prices.length === 0) {
        return null;
      }
      return {
        seasonLabel: prices[0].seasonLabel,
        validFrom: prices[0].validFrom,
        validUntil: prices[0].validUntil,
        prices: prices.map((p) => ({
          section: p.sectionId,
          sectionName: p.sectionName,
          price: p.price,
        })),
      };
    } catch (error) {
      this.logger.warn(`Chatbot season-pass prices failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * Weather per match through WeatherService (its own 1 h cache). Beyond the
   * forecast horizon that service returns the last available slot, which is
   * not a forecast for the match, so such matches get no weather at all.
   */
  private async loadWeather(match: Match): Promise<ChatbotWeatherSnapshot | null> {
    const hoursAhead = (match.kickoffAt.getTime() - Date.now()) / 3_600_000;
    if (hoursAhead > FORECAST_HORIZON_HOURS) {
      return null;
    }
    try {
      const w = await this.weatherService.getForMatch(match.id);
      if (w.fallback || w.temperatureCelsius === null || w.precipitationProbability === null) {
        return null;
      }
      return {
        summary: w.summary,
        temperatureCelsius: Math.round(w.temperatureCelsius),
        precipitationProbabilityPercent: Math.round(w.precipitationProbability * 100),
        rainWarning: w.rainWarning,
      };
    } catch (error) {
      this.logger.warn(`Chatbot weather failed for ${match.id}: ${(error as Error).message}`);
      return null;
    }
  }

  private buildLoyalty(): ChatbotLoyaltySnapshot {
    const c = this.loyaltyConfig;
    return {
      tiers: TIER_DEFINITIONS.map((t) => ({
        tier: t.tier,
        label: t.label,
        minPoints: t.minPoints,
        discountPercent: t.discountPercent,
      })),
      earning: {
        registration: c.registrationPoints,
        profileCompletion: c.profileCompletionPoints,
        perTicket: c.ticketPointsPerTicket,
        seasonPass: c.seasonPassPoints,
        passLoan: c.passLoanPoints,
      },
      carryoverPercent: c.carryoverPercent,
    };
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
        name: s.name,
        away: s.isAway,
        gate: s.gate ?? null,
        total: s.total,
        free: s.available,
        sold: s.sold,
        locked: s.locked,
        minPrice: s.minPrice,
        maxPrice: s.maxPrice,
        covered: s.covered ?? null,
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
    weather: ChatbotWeatherSnapshot | null,
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
      description: this.truncate(match.description),
      weather,
    };
  }

  private truncate(text: string | undefined): string | null {
    const t = text?.trim();
    if (!t) {
      return null;
    }
    return t.length > DESCRIPTION_MAX_CHARS ? `${t.slice(0, DESCRIPTION_MAX_CHARS - 1)}…` : t;
  }
}
