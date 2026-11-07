import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Why there is no forecast:
 *  - `too_far`: the kickoff is beyond the 5-day forecast range (or no slot covers it),
 *  - `past`: the match has already started,
 *  - `no_data`: the weather provider is not configured or did not answer.
 */
export type WeatherUnavailableReason = 'too_far' | 'past' | 'no_data';

export class MatchWeatherForecastDto {
  @ApiProperty({ format: 'uuid' })
  matchId!: string;

  @ApiProperty({ example: 'Kecskemet,HU' })
  city!: string;

  @ApiProperty({ format: 'date-time' })
  forecastFor!: string;

  @ApiProperty({ example: 'Esőzés várható' })
  summary!: string;

  @ApiProperty({
    example: 12.4,
    nullable: true,
    type: Number,
    description: 'Hőmérséklet °C-ban; null, ha nincs előrejelzés.',
  })
  temperatureCelsius!: number | null;

  @ApiProperty({
    example: 1.2,
    nullable: true,
    type: Number,
    description: 'Várható csapadék mm/h; null, ha nincs előrejelzés.',
  })
  precipitationMmPerHour!: number | null;

  @ApiProperty({
    example: 0.65,
    nullable: true,
    type: Number,
    description: 'Csapadék-valószínűség (0–1); null, ha nincs előrejelzés.',
  })
  precipitationProbability!: number | null;

  @ApiProperty({
    example: 4.2,
    nullable: true,
    type: Number,
    description: 'Szélsebesség m/s; null, ha nincs előrejelzés.',
  })
  windSpeedMs!: number | null;

  @ApiProperty({
    example: true,
    description:
      'Igaz, ha a heves csapadék miatt a fedetlen szektorban ülő szurkolóknak figyelmeztetést kell mutatni. Előrejelzés nélkül mindig hamis.',
  })
  rainWarning!: boolean;

  @ApiPropertyOptional({ example: '10d', description: 'OpenWeatherMap ikonkód' })
  icon?: string;

  @ApiProperty({
    example: false,
    description:
      'Igaz, ha nincs érvényes előrejelzés (lásd `unavailableReason`); ilyenkor a számadatok null értékűek.',
  })
  fallback!: boolean;

  @ApiPropertyOptional({
    enum: ['too_far', 'past', 'no_data'],
    description: 'Az előrejelzés hiányának oka; csak `fallback: true` esetén van megadva.',
  })
  unavailableReason?: WeatherUnavailableReason;
}
