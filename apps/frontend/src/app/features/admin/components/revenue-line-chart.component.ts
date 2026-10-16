import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  signal,
} from '@angular/core';
import { RevenueDailyPoint } from '../../../shared/models/admin.model';

interface SvgPoint {
  readonly x: number;
  readonly y: number;
  readonly date: string;
  readonly amount: number;
}

const VIEWBOX_WIDTH = 720;
const VIEWBOX_HEIGHT = 240;
const PADDING_X = 36;
const PADDING_Y = 24;

/**
 * Pure-SVG revenue timeline. Designed to be a drop-in replacement for an
 * ngx-charts line chart: same data shape, no third-party runtime cost.
 */
@Component({
  selector: 'kte-revenue-line-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <figure class="kte-chart">
      <svg
        [attr.viewBox]="viewBox"
        preserveAspectRatio="none"
        class="kte-chart__svg"
        role="img"
        aria-label="Napi bevétel idősor"
      >
        <!-- Y axis grid -->
        @for (gridY of gridLines(); track gridY.value) {
          <line
            [attr.x1]="paddingX"
            [attr.y1]="gridY.y"
            [attr.x2]="viewportWidth"
            [attr.y2]="gridY.y"
            stroke="#2E2E2E"
            stroke-dasharray="2 4"
            stroke-width="0.5"
          />
          <text
            [attr.x]="paddingX - 4"
            [attr.y]="gridY.y + 4"
            text-anchor="end"
            font-size="10"
            fill="#888888"
          >
            {{ gridY.label }}
          </text>
        }

        <!-- X axis -->
        <line
          [attr.x1]="paddingX"
          [attr.y1]="viewportHeight"
          [attr.x2]="viewportWidth"
          [attr.y2]="viewportHeight"
          stroke="#2E2E2E"
          stroke-width="0.6"
        />

        @if (svgPoints().length > 0) {
          <!-- Area fill -->
          <path [attr.d]="areaPath()" fill="rgba(201, 75, 30, 0.18)" />
          <!-- Line -->
          <path [attr.d]="linePath()" fill="none" stroke="#C94B1E" stroke-width="2" />
          <!-- Data points -->
          @for (point of svgPoints(); track point.date) {
            <circle
              [attr.cx]="point.x"
              [attr.cy]="point.y"
              r="3"
              fill="#C94B1E"
              [attr.aria-label]="point.date + ': ' + point.amount + ' Ft'"
            />
          }
        }

        <!-- X axis labels (every Nth day) -->
        @for (label of xLabels(); track label.x) {
          <text
            [attr.x]="label.x"
            [attr.y]="viewportHeight + 16"
            text-anchor="middle"
            font-size="10"
            fill="#888888"
          >
            {{ label.text }}
          </text>
        }
      </svg>
      <figcaption class="kte-chart__caption">{{ caption }}</figcaption>
    </figure>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .kte-chart {
        margin: 0;
        background: var(--kte-surface);
        border-radius: 12px; /* deliberate exception: no 12px token */
        padding: 16px;
      }
      .kte-chart__svg {
        width: 100%;
        height: 240px;
      }
      .kte-chart__caption {
        margin-top: 8px;
        text-align: center;
        font-size: 12px;
        color: var(--kte-muted);
      }
    `,
  ],
})
export class RevenueLineChartComponent {
  private readonly _data = signal<readonly RevenueDailyPoint[]>([]);

  @Input({ required: true })
  set data(value: readonly RevenueDailyPoint[]) {
    this._data.set(value ?? []);
  }
  get data(): readonly RevenueDailyPoint[] {
    return this._data();
  }

  @Input() caption = 'Napi bevétel az utolsó 30 napban';

  protected readonly paddingX = PADDING_X;
  protected readonly paddingY = PADDING_Y;
  protected readonly viewportWidth = VIEWBOX_WIDTH - PADDING_X;
  protected readonly viewportHeight = VIEWBOX_HEIGHT - PADDING_Y;
  protected readonly viewBox = `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`;

  protected readonly maxAmount = computed(() => {
    const data = this._data();
    if (data.length === 0) {
      return 0;
    }
    return Math.max(...data.map((p) => p.amount));
  });

  protected readonly svgPoints = computed<SvgPoint[]>(() => {
    const data = this._data();
    if (data.length === 0) {
      return [];
    }
    const max = this.maxAmount() || 1;
    const span = this.viewportWidth - this.paddingX;
    const usableHeight = this.viewportHeight - this.paddingY;
    const denominator = Math.max(1, data.length - 1);
    return data.map((point, index) => {
      const x = this.paddingX + (index / denominator) * span;
      const y = this.paddingY + (1 - point.amount / max) * usableHeight;
      return { x, y, date: point.date, amount: point.amount };
    });
  });

  protected readonly linePath = computed(() => {
    const points = this.svgPoints();
    if (points.length === 0) {
      return '';
    }
    return points
      .map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ');
  });

  protected readonly areaPath = computed(() => {
    const points = this.svgPoints();
    if (points.length === 0) {
      return '';
    }
    const top = points
      .map((p, index) => `${index === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
      .join(' ');
    const last = points[points.length - 1];
    const first = points[0];
    return `${top} L${last.x.toFixed(2)},${this.viewportHeight} L${first.x.toFixed(2)},${this.viewportHeight} Z`;
  });

  protected readonly gridLines = computed(() => {
    const max = this.maxAmount();
    if (max === 0) {
      return [];
    }
    const steps = 4;
    const lines: Array<{ value: number; y: number; label: string }> = [];
    for (let i = 0; i <= steps; i += 1) {
      const value = Math.round((max * i) / steps);
      const y =
        this.paddingY +
        (1 - i / steps) * (this.viewportHeight - this.paddingY);
      lines.push({ value, y, label: this.formatHuf(value) });
    }
    return lines;
  });

  protected readonly xLabels = computed(() => {
    const points = this.svgPoints();
    if (points.length === 0) {
      return [];
    }
    const labelEvery = Math.max(1, Math.floor(points.length / 6));
    return points
      .map((p, index) => ({
        x: p.x,
        text: this.formatDateShort(p.date),
        index,
      }))
      .filter((entry) => entry.index % labelEvery === 0);
  });

  private formatHuf(value: number): string {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)} M`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}k`;
    }
    return String(value);
  }

  private formatDateShort(iso: string): string {
    const parts = iso.split('-');
    if (parts.length !== 3) {
      return iso;
    }
    return `${parts[1]}.${parts[2]}`;
  }
}
