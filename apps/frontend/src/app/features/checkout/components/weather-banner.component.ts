import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { MatchWeatherForecast } from '../../../shared/models/payment.model';

const COVERED_SECTORS = new Set<string>(['VIP']);

@Component({
  selector: 'kte-weather-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, RouterLink],
  template: `
    @if (shouldShow()) {
      <div class="kte-weather" role="alert" aria-live="polite">
        <mat-icon class="kte-weather__icon">cloud</mat-icon>
        <div class="kte-weather__body">
          <strong>Esőzés várható a meccs idején</strong>
          <p>
            Időjárás-előrejelzés: <em>{{ forecast?.summary }}</em>,
            csapadék {{ forecast?.precipitationMmPerHour | number: '1.1-1' }} mm/h,
            valószínűség {{ percentProbability() }}%.
          </p>
          <p>
            A kiválasztott szektor (<strong>{{ uncoveredSectorsLabel }}</strong>) nem fedett —
            érdemes lehet egy fedett szektorba átülnöd.
          </p>
        </div>
        <a mat-stroked-button color="primary" routerLink="/stadium">
          <mat-icon>event_seat</mat-icon>
          Másik szektor választása
        </a>
      </div>
    } @else if (noForecastMessage()) {
      <p class="kte-weather-note" role="status" data-testid="weather-no-forecast">
        <mat-icon>cloud_off</mat-icon>
        <span>{{ noForecastMessage() }}</span>
      </p>
    }
  `,
  styles: [
    `
      .kte-weather-note {
        display: flex;
        align-items: center;
        gap: var(--kte-spacing-2);
        margin: 0 0 var(--kte-spacing-4);
        color: var(--kte-muted);
        font-size: 13px;
      }
      .kte-weather-note mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .kte-weather {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--kte-spacing-3);
        align-items: center;
        padding: var(--kte-spacing-4);
        background: var(--kte-brand-tint);
        border-left: 4px solid var(--kte-seat-pass);
        border-radius: var(--kte-radius);
        margin-bottom: var(--kte-spacing-4);
      }
      .kte-weather__icon {
        color: var(--kte-seat-pass);
        font-size: 36px;
        width: 36px;
        height: 36px;
      }
      .kte-weather__body strong {
        display: block;
        margin-bottom: 4px;
      }
      .kte-weather__body p {
        margin: 0;
        font-size: 13px;
      }
      @media (max-width: 600px) {
        .kte-weather {
          grid-template-columns: auto 1fr;
        }
        .kte-weather a {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class WeatherBannerComponent {
  @Input() forecast: MatchWeatherForecast | null = null;
  @Input() sectionsInCart: readonly string[] = [];

  protected shouldShow(): boolean {
    if (!this.forecast || !this.forecast.rainWarning || this.forecast.fallback) {
      return false;
    }
    return this.uncoveredSections().length > 0;
  }

  /** Text for the "no forecast" state; null when there is nothing to say. */
  protected noForecastMessage(): string | null {
    if (!this.forecast?.fallback) {
      return null;
    }
    switch (this.forecast.unavailableReason) {
      case 'too_far':
        return 'Az időjárás-előrejelzés még nem elérhető: a mérkőzés kezdése még túl messze van.';
      case 'no_data':
        return 'Az időjárás-előrejelzés jelenleg nem elérhető.';
      default:
        // `past` or an older backend without a reason: nothing useful to show.
        return null;
    }
  }

  protected get uncoveredSectorsLabel(): string {
    return this.uncoveredSections().join(', ');
  }

  protected percentProbability(): number {
    if (!this.forecast || this.forecast.precipitationProbability === null) {
      return 0;
    }
    return Math.round(this.forecast.precipitationProbability * 100);
  }

  private uncoveredSections(): string[] {
    return Array.from(new Set(this.sectionsInCart)).filter(
      (section) => !COVERED_SECTORS.has(section),
    );
  }
}
