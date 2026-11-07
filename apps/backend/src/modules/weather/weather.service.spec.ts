import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FORECAST_HORIZON_HOURS, WeatherService } from './weather.service';

const httpGet = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: () => ({ get: (...a: unknown[]) => httpGet(...a) }) },
}));

const HOUR = 3_600_000;

/** A 5-day forecast: 3-hour slots from "now" up to just under the horizon. */
function forecastList(startMs: number) {
  const list = [];
  for (let h = 0; h <= FORECAST_HORIZON_HOURS; h += 3) {
    list.push({
      dt: Math.round((startMs + h * HOUR) / 1000),
      main: { temp: 10 + h / 100 },
      weather: [{ id: 500, main: 'Rain', description: `slot-${h}`, icon: '10d' }],
      rain: { '3h': h === 48 ? 3 : 0 },
      wind: { speed: 2 },
      pop: 0.4,
    });
  }
  return { data: { list } };
}

describe('WeatherService', () => {
  let redis: { get: jest.Mock; set: jest.Mock };
  let match: { id: string; kickoffAt: Date } | null;
  let apiKey: string;

  const build = () =>
    new WeatherService(
      { findOne: jest.fn(async () => match) } as never,
      redis as never,
      {
        getOrThrow: () => ({ apiKey, city: 'Kecskemet,HU', cacheTtlSeconds: 3600 }),
      } as unknown as ConfigService,
    );
  const kickoffIn = (hours: number) => new Date(Date.now() + hours * HOUR);

  beforeEach(() => {
    httpGet.mockReset();
    redis = { get: jest.fn(async () => null), set: jest.fn(async () => 'OK') };
    apiKey = 'test-key';
    match = { id: 'm1', kickoffAt: kickoffIn(48) };
    httpGet.mockImplementation(async () => forecastList(Date.now()));
  });

  it('returns the slot that covers the kickoff for a match inside the range', async () => {
    const dto = await build().getForMatch('m1');
    expect(dto.fallback).toBe(false);
    expect(dto.unavailableReason).toBeUndefined();
    expect(dto.summary).toBe('Slot-48');
    expect(dto.rainWarning).toBe(true);
    expect(typeof dto.temperatureCelsius).toBe('number');
  });

  it('beyond the forecast range: "no forecast yet", no numbers, no API call, not cached', async () => {
    match = { id: 'm1', kickoffAt: kickoffIn(FORECAST_HORIZON_HOURS + 24) };
    const dto = await build().getForMatch('m1');

    expect(dto.fallback).toBe(true);
    expect(dto.unavailableReason).toBe('too_far');
    expect(dto.rainWarning).toBe(false);
    expect(dto.temperatureCelsius).toBeNull();
    expect(dto.precipitationMmPerHour).toBeNull();
    expect(dto.precipitationProbability).toBeNull();
    expect(dto.windSpeedMs).toBeNull();
    // The old bug: it would have returned the LAST slot (slot-120) as this match's weather.
    expect(dto.summary).not.toMatch(/slot/i);
    expect(httpGet).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('a kickoff just inside the horizon is still forecast, just outside is not', async () => {
    match = { id: 'm1', kickoffAt: kickoffIn(FORECAST_HORIZON_HOURS - 1) };
    expect((await build().getForMatch('m1')).fallback).toBe(false);
    match = { id: 'm1', kickoffAt: kickoffIn(FORECAST_HORIZON_HOURS + 1) };
    expect((await build().getForMatch('m1')).unavailableReason).toBe('too_far');
  });

  it('refuses a slot that does not actually cover the kickoff (provider list is shorter)', async () => {
    match = { id: 'm1', kickoffAt: kickoffIn(100) };
    httpGet.mockImplementation(async () => {
      const full = forecastList(Date.now());
      full.data.list = full.data.list.filter((s) => s.dt * 1000 < Date.now() + 40 * HOUR);
      return full;
    });
    const dto = await build().getForMatch('m1');
    expect(dto.fallback).toBe(true);
    expect(dto.unavailableReason).toBe('too_far');
    expect(dto.temperatureCelsius).toBeNull();
  });

  it('a match that has already started has no forecast', async () => {
    match = { id: 'm1', kickoffAt: kickoffIn(-2) };
    const dto = await build().getForMatch('m1');
    expect(dto.unavailableReason).toBe('past');
    expect(httpGet).not.toHaveBeenCalled();
  });

  it('without an API key: no_data, no API call, cached only briefly', async () => {
    apiKey = '';
    const dto = await build().getForMatch('m1');
    expect(dto.fallback).toBe(true);
    expect(dto.unavailableReason).toBe('no_data');
    expect(dto.temperatureCelsius).toBeNull();
    expect(httpGet).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'EX', 60);
  });

  it('an API failure is no_data and is also cached only briefly, a success for the full TTL', async () => {
    httpGet.mockRejectedValueOnce(new Error('timeout'));
    const failed = await build().getForMatch('m1');
    expect(failed.unavailableReason).toBe('no_data');
    expect(redis.set).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 'EX', 60);

    await build().getForMatch('m1');
    expect(redis.set).toHaveBeenLastCalledWith(expect.any(String), expect.any(String), 'EX', 3600);
  });

  it('404s for an unknown match', async () => {
    match = null;
    await expect(build().getForMatch('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
