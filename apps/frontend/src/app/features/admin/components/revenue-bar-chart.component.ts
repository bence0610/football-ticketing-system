import { ChangeDetectionStrategy, Component, Input, computed, signal } from '@angular/core';
import { OverviewMatch } from '../../../shared/models/admin.model';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';
import { barHeights, fixtureLabel, niceMax } from '../logic/admin-logic';

const PLOT_HEIGHT = 220;
const TOP = 12;
const LEFT = 64;
const BAR_WIDTH = 32;
const BAR_GAP = 24;
const LABEL_BAND = 48;

/**
 * Revenue per match as bars of the money actually charged. A match still ahead
 * is grey and marked "nem végleges": its figure can still move.
 */
@Component({
  selector: 'kte-revenue-bar-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HufCurrencyPipe],
  template: `
    <ul class="legend" aria-label="Jelmagyarázat">
      <li><span class="swatch swatch--final" aria-hidden="true"></span>Jegybevétel</li>
      <li>
        <span class="swatch swatch--open" aria-hidden="true"></span>Nem végleges (még értékesítés alatt)
      </li>
    </ul>

    @if (matches().length === 0) {
      <p class="empty" data-testid="chart-empty">Nincs megjeleníthető meccs ebben az időszakban.</p>
    } @else {
      <div class="scroll">
        <svg
          class="chart"
          [attr.width]="width()"
          [attr.height]="height"
          [attr.viewBox]="'0 0 ' + width() + ' ' + height"
          role="img"
          aria-label="Bevétel meccsenként, forintban"
          data-testid="revenue-chart"
        >
          @for (tick of ticks(); track tick.value) {
            <line [attr.x1]="left" [attr.x2]="width()" [attr.y1]="tick.y" [attr.y2]="tick.y" class="grid" />
            <text [attr.x]="left - 8" [attr.y]="tick.y + 4" class="tick" text-anchor="end">
              {{ tick.label }}
            </text>
          }

          @for (bar of bars(); track bar.match.matchId; let i = $index) {
            <g [attr.data-final]="bar.match.final">
              <rect
                [attr.x]="barX(i)"
                [attr.y]="top + plotHeight - bar.height"
                [attr.width]="barWidth"
                [attr.height]="bar.height"
                rx="3"
                [class]="bar.match.final ? 'bar bar--final' : 'bar bar--open'"
                data-testid="revenue-bar"
              >
                <title>
                  {{ fixtureLabel(bar.match) }}: {{ bar.match.revenue | hufCurrency }}{{ bar.match.final ? '' : ' (nem végleges)' }}
                </title>
              </rect>
              <text [attr.x]="barX(i) + barWidth / 2" [attr.y]="top + plotHeight + 16" class="xlabel" text-anchor="middle">
                {{ short(bar.match.awayTeam) }}
              </text>
              @if (!bar.match.final) {
                <text [attr.x]="barX(i) + barWidth / 2" [attr.y]="top + plotHeight + 30" class="xlabel xlabel--open" text-anchor="middle">
                  nem végleges
                </text>
              }
            </g>
          }
        </svg>
      </div>
    }
  `,
  styles: [
    `
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 20px;
        margin: 0 0 12px;
        padding: 0;
        list-style: none;
        font-size: 13px;
        color: var(--muted);
      }

      .legend li {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .swatch {
        width: 12px;
        height: 12px;
        border-radius: 3px;
      }

      .swatch--final,
      .bar--final {
        background: var(--brand-mid);
        fill: var(--brand-mid);
      }

      .swatch--open,
      .bar--open {
        background: var(--faint);
        fill: var(--faint);
      }

      .scroll {
        overflow-x: auto;
      }

      .chart {
        display: block;
        font-family: var(--font-body);
      }

      .grid {
        stroke: var(--border-light);
        stroke-width: 1;
      }

      .tick,
      .xlabel {
        fill: var(--muted);
        font-size: 11px;
      }

      .xlabel--open {
        fill: var(--faint);
        font-size: 10px;
      }

      .empty {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }
    `,
  ],
})
export class RevenueBarChartComponent {
  protected readonly matches = signal<readonly OverviewMatch[]>([]);

  @Input({ required: true }) set data(value: readonly OverviewMatch[]) {
    this.matches.set(value);
  }

  protected readonly top = TOP;
  protected readonly left = LEFT;
  protected readonly plotHeight = PLOT_HEIGHT;
  protected readonly barWidth = BAR_WIDTH;
  protected readonly height = TOP + PLOT_HEIGHT + LABEL_BAND;
  protected readonly fixtureLabel = fixtureLabel;

  private readonly axisMax = computed(() => niceMax(Math.max(0, ...this.matches().map((m) => m.revenue))));
  protected readonly bars = computed(() => barHeights(this.matches(), PLOT_HEIGHT, this.axisMax()));
  protected readonly width = computed(
    () => LEFT + this.matches().length * (BAR_WIDTH + BAR_GAP) + BAR_GAP,
  );

  protected readonly ticks = computed(() => {
    const max = this.axisMax();
    return [0, 1, 2, 3, 4].map((i) => {
      const value = (max / 4) * i;
      return { value, y: TOP + PLOT_HEIGHT - (PLOT_HEIGHT * i) / 4, label: compactHuf(value) };
    });
  });

  protected barX(index: number): number {
    return LEFT + BAR_GAP + index * (BAR_WIDTH + BAR_GAP);
  }

  protected short(team: string): string {
    return team.length > 9 ? `${team.slice(0, 8)}…` : team;
  }
}

/** Axis labels: 25 000 -> "25 e", 1 200 000 -> "1,2 M". */
function compactHuf(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('hu-HU')} M`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString('hu-HU')} e`;
  return String(value);
}
