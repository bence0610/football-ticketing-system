import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosInstance } from 'axios';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { WeatherConfig } from '../../config';
import { Match } from '../../database/entities';
import { REDIS_CLIENT } from '../../redis/redis.constants';
import { MatchWeatherForecastDto, WeatherUnavailableReason } from './dto';

const RAIN_WARNING_THRESHOLD_MM = 0.5;

/**
 * OpenWeatherMap's free forecast covers 5 days. A match kicking off later than
 * this has no forecast yet — the service says so instead of returning the last
 * available slot as if it were that match's weather.
 */
export const FORECAST_HORIZON_HOURS = 120;

/** The forecast is in 3-hour slots; a slot further from kickoff than this is not "its" weather. */
const MAX_SLOT_DISTANCE_MS = 3 * 60 * 60 * 1000;

/** Failures (missing key, API down) are cached only briefly so recovery is quick. */
const UNAVAILABLE_CACHE_TTL_SECONDS = 60;

const OPENWEATHER_FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';

interface OwmListEntry {
  dt: number;
  main: { temp: number };
  weather: { id: number; main: string; description: string; icon: string }[];
  rain?: { '3h'?: number };
  wind?: { speed: number };
  pop?: number;
}

interface OwmForecastResponse {
  list: OwmListEntry[];
}

type ForecastResult =
  | {
      available: true;
      summary: string;
      temperature: number;
      precipitation: number;
      probability: number;
      wind: number;
      icon?: string;
    }
  | { available: false; reason: WeatherUnavailableReason };

const UNAVAILABLE_SUMMARY: Record<WeatherUnavailableReason, string> = {
  too_far: 'Az előrejelzés még nem elérhető',
  past: 'A mérkőzés már elkezdődött',
  no_data: 'Időjárási adat nem elérhető',
};

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly config: WeatherConfig;
  private readonly http: AxiosInstance;

  constructor(
    @InjectRepository(Match) private readonly matchRepository: Repository<Match>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<WeatherConfig>('weather');
    this.http = axios.create({ timeout: 8_000 });
  }

  async getForMatch(matchId: string): Promise<MatchWeatherForecastDto> {
    const match = await this.matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      throw new NotFoundException('Meccs nem található.');
    }

    // Time-dependent, so decided before the cache and never cached.
    const hoursAhead = (match.kickoffAt.getTime() - Date.now()) / 3_600_000;
    if (hoursAhead > FORECAST_HORIZON_HOURS) {
      return this.unavailable(match, 'too_far');
    }
    if (hoursAhead < 0) {
      return this.unavailable(match, 'past');
    }

    const cacheKey = `weather:match:${matchId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as MatchWeatherForecastDto;
      } catch {
        // fall through to refetch
      }
    }

    const forecast = await this.fetchForecast(match.kickoffAt);
    const dto: MatchWeatherForecastDto = forecast.available
      ? {
          matchId: match.id,
          city: this.config.city,
          forecastFor: match.kickoffAt.toISOString(),
          summary: forecast.summary,
          temperatureCelsius: forecast.temperature,
          precipitationMmPerHour: forecast.precipitation,
          precipitationProbability: forecast.probability,
          windSpeedMs: forecast.wind,
          rainWarning: forecast.precipitation > RAIN_WARNING_THRESHOLD_MM,
          icon: forecast.icon,
          fallback: false,
        }
      : this.unavailable(match, forecast.reason);

    await this.redis
      .set(
        cacheKey,
        JSON.stringify(dto),
        'EX',
        dto.fallback ? UNAVAILABLE_CACHE_TTL_SECONDS : this.config.cacheTtlSeconds,
      )
      .catch((err: unknown) =>
        this.logger.warn(
          `Failed to cache weather forecast for match ${matchId}: ${err instanceof Error ? err.message : err}`,
        ),
      );

    return dto;
  }

  /** "No forecast": no numbers at all, so nothing can be mistaken for a measurement. */
  private unavailable(match: Match, reason: WeatherUnavailableReason): MatchWeatherForecastDto {
    return {
      matchId: match.id,
      city: this.config.city,
      forecastFor: match.kickoffAt.toISOString(),
      summary: UNAVAILABLE_SUMMARY[reason],
      temperatureCelsius: null,
      precipitationMmPerHour: null,
      precipitationProbability: null,
      windSpeedMs: null,
      rainWarning: false,
      fallback: true,
      unavailableReason: reason,
    };
  }

  private async fetchForecast(targetDate: Date): Promise<ForecastResult> {
    if (!this.config.apiKey) {
      this.logger.warn('OPENWEATHER_API_KEY not configured — no forecast available.');
      return { available: false, reason: 'no_data' };
    }

    try {
      const { data } = await this.http.get<OwmForecastResponse>(OPENWEATHER_FORECAST_URL, {
        params: {
          q: this.config.city,
          appid: this.config.apiKey,
          units: 'metric',
          lang: 'hu',
        },
      });

      const target = targetDate.getTime();
      const closest =
        data.list.reduce<OwmListEntry | null>((best, entry) => {
          if (!best) {
            return entry;
          }
          return Math.abs(entry.dt * 1000 - target) < Math.abs(best.dt * 1000 - target)
            ? entry
            : best;
        }, null) ?? null;

      if (!closest) {
        throw new Error('OpenWeatherMap returned an empty list.');
      }
      // Never present a slot that does not actually cover the kickoff.
      if (Math.abs(closest.dt * 1000 - target) > MAX_SLOT_DISTANCE_MS) {
        return { available: false, reason: 'too_far' };
      }

      const description = closest.weather[0]?.description ?? 'változó időjárás';
      // OWM provides 3-hourly accumulation; convert to mm/h.
      const rain3h = closest.rain?.['3h'] ?? 0;
      const precipitation = rain3h / 3;

      return {
        available: true,
        summary: capitalize(description),
        temperature: Number(closest.main.temp.toFixed(1)),
        precipitation: Number(precipitation.toFixed(2)),
        probability: closest.pop ?? 0,
        wind: closest.wind?.speed ?? 0,
        icon: closest.weather[0]?.icon,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`OpenWeatherMap call failed: ${message}`);
      return { available: false, reason: 'no_data' };
    }
  }
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
