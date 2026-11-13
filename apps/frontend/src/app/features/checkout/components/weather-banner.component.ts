import { sectorName } from '../../../shared/utils/sector-name';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatchWeatherForecast } from '../../../shared/models/payment.model';

/** Material icon for an OpenWeather icon code ("10d", "01n", ...). */
export function weatherIcon(code: string | undefined): string {
  switch (code?.slice(0, 2)) {
    case '01':
      return 'wb_sunny';
    case '09':
    case '10':
      return 'umbrella';
    case '11':
      return 'thunderstorm';
    case '13':
      return 'ac_unit';
    case '50':
      return 'foggy';
    default:
      return 'cloud';
  }
}

/**
 * Weather band above the payment form: the forecast for kickoff and whether
 * the chosen sector is covered. It renders only for a real forecast - with the
 * "no forecast yet", "no data" and "already started" states it renders
 * nothing at all rather than an empty band.
 */
@Component({
  selector: 'kte-weather-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (forecast && !forecast.fallback) {
      <section class="weather" data-testid="weather-band" aria-label="Időjárás a mérkőzés kezdésére">
        <mat-icon class="weather__icon" aria-hidden="true">{{ icon() }}</mat-icon>
        <div class="weather__body">
          <p class="weather__forecast">{{ forecastLine() }}</p>
          @if (coverLine(); as line) {
            <p class="weather__cover" data-testid="weather-cover">{{ line }}</p>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .weather {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 18px;
        background: var(--brand-tint);
        border: 1px solid var(--kte-brand-edge);
        border-radius: var(--radius-card);
        color: var(--brand-deep);
      }

      .weather__icon {
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        font-size: 32px;
      }

      .weather__body {
        min-width: 0;
      }

      .weather__body p {
        margin: 0;
      }

      .weather__forecast {
        font-weight: 600;
        font-size: 15px;
      }

      .weather__cover {
        font-size: 14px;
        color: var(--ink);
      }
    `,
  ],
})
export class WeatherBannerComponent {
  @Input() forecast: MatchWeatherForecast | null = null;
  @Input() sectionsInCart: readonly string[] = [];
  /**
   * Is each sector covered? section -> flag, from the server (the seat map's
   * sector summary). A section that is missing or null has no data, and the
   * band then says nothing about it.
   */
  @Input() coverage: Readonly<Record<string, boolean | null | undefined>> = {};

  protected icon(): string {
    return weatherIcon(this.forecast?.icon);
  }

  /** "Kezdéskor: gyenge eső · 9 °C · 65% csapadékvalószínűség" - only values the forecast really has. */
  protected forecastLine(): string {
    const f = this.forecast;
    if (!f) {
      return '';
    }
    const parts: string[] = [];
    if (f.summary) {
      parts.push(f.summary.charAt(0).toLowerCase() + f.summary.slice(1));
    }
    if (f.temperatureCelsius !== null) {
      parts.push(`${Math.round(f.temperatureCelsius)} °C`);
    }
    if (f.precipitationProbability !== null) {
      parts.push(`${Math.round(f.precipitationProbability * 100)}% csapadékvalószínűség`);
    }
    return `Kezdéskor: ${parts.join(' · ')}`;
  }

  /**
   * Whether the chosen sector(s) are covered - read from the flag, never assumed.
   * Sectors without data are left out; with no data at all there is no line.
   */
  protected coverLine(): string {
    const sections = Array.from(new Set(this.sectionsInCart));
    const covered = sections.filter((s) => this.coverage[s] === true);
    const open = sections.filter((s) => this.coverage[s] === false);
    if (covered.length === 0 && open.length === 0) {
      return '';
    }
    const rain = this.forecast?.rainWarning === true;
    const name = (s: string) => sectorName(s);

    if (open.length === 0) {
      return covered.length === 1
        ? `A választott szektor (${name(covered[0])}) fedett.`
        : 'A választott szektorok mind fedettek.';
    }
    const openText = open.map(name).join(', ');
    const tail = rain ? ' — esőre számíts.' : '.';
    if (covered.length === 0) {
      return open.length === 1
        ? `A választott szektor (${openText}) nem fedett${tail}`
        : `A választott szektorok (${openText}) nem fedettek${tail}`;
    }
    return `Fedett: ${covered.map(name).join(', ')} · nem fedett: ${openText}${tail}`;
  }
}
