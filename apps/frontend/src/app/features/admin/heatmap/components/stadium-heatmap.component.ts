import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  computed,
  signal,
} from '@angular/core';
import { SectorOccupancy } from '../../../../shared/models/admin.model';

interface SectorPlacement {
  readonly section: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx?: number;
}

interface SectorRender extends SectorPlacement {
  readonly fill: string;
  readonly textColor: string;
  readonly data: SectorOccupancy;
}

const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 400;

// Generic top-down stadium layout (4 main grandstands + corners). When a
// section is missing from the catalogue it is simply not painted, so this
// component degrades gracefully.
const SECTOR_LAYOUT: readonly SectorPlacement[] = [
  // North main stand (away supporters)
  { section: 'B', x: 80, y: 30, width: 440, height: 70, rx: 8 },
  // South main stand (home supporters)
  { section: 'A', x: 80, y: 300, width: 440, height: 70, rx: 8 },
  // East stand
  { section: 'C', x: 480, y: 110, width: 90, height: 180, rx: 8 },
  // West stand
  { section: 'D', x: 30, y: 110, width: 90, height: 180, rx: 8 },
  // Premium block
  { section: 'VIP', x: 230, y: 130, width: 140, height: 70, rx: 8 },
  // Standing curves
  { section: 'K1', x: 30, y: 30, width: 50, height: 70, rx: 8 },
  { section: 'K2', x: 520, y: 30, width: 50, height: 70, rx: 8 },
  { section: 'K3', x: 30, y: 300, width: 50, height: 70, rx: 8 },
  { section: 'K4', x: 520, y: 300, width: 50, height: 70, rx: 8 },
];

const PITCH_RECT = { x: 130, y: 110, width: 340, height: 180 };

@Component({
  selector: 'kte-stadium-heatmap',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="kte-heatmap-wrapper">
      <svg
        [attr.viewBox]="viewBox"
        preserveAspectRatio="xMidYMid meet"
        class="kte-heatmap-svg"
        role="img"
        aria-label="Stadion foglaltsági heatmap"
      >
        <rect
          [attr.x]="pitch.x"
          [attr.y]="pitch.y"
          [attr.width]="pitch.width"
          [attr.height]="pitch.height"
          rx="6"
          fill="#1E3A2F"
          stroke="#FFFFFF"
          stroke-width="2"
        />
        <line
          [attr.x1]="pitch.x + pitch.width / 2"
          [attr.y1]="pitch.y"
          [attr.x2]="pitch.x + pitch.width / 2"
          [attr.y2]="pitch.y + pitch.height"
          stroke="#FFFFFF"
          stroke-width="1.5"
          stroke-opacity="0.6"
        />
        <circle
          [attr.cx]="pitch.x + pitch.width / 2"
          [attr.cy]="pitch.y + pitch.height / 2"
          r="22"
          fill="none"
          stroke="#FFFFFF"
          stroke-width="1.5"
          stroke-opacity="0.6"
        />

        @for (sector of sectorsRender(); track sector.section) {
          <g
            class="kte-heatmap-svg__sector"
            (mouseenter)="hovered.set(sector.section)"
            (mouseleave)="hovered.set(null)"
          >
            <rect
              [attr.x]="sector.x"
              [attr.y]="sector.y"
              [attr.width]="sector.width"
              [attr.height]="sector.height"
              [attr.rx]="sector.rx ?? 4"
              [attr.fill]="sector.fill"
              stroke="#FFFFFF"
              stroke-width="1.2"
              stroke-opacity="0.6"
            />
            <text
              [attr.x]="sector.x + sector.width / 2"
              [attr.y]="sector.y + sector.height / 2 - 2"
              text-anchor="middle"
              dominant-baseline="middle"
              font-size="14"
              font-weight="700"
              [attr.fill]="sector.textColor"
            >
              {{ sector.section }}
            </text>
            <text
              [attr.x]="sector.x + sector.width / 2"
              [attr.y]="sector.y + sector.height / 2 + 14"
              text-anchor="middle"
              dominant-baseline="middle"
              font-size="11"
              [attr.fill]="sector.textColor"
            >
              {{ sector.data.occupancyPercent }}%
            </text>
          </g>
        }

        @if (hoveredSector(); as h) {
          <g pointer-events="none" class="kte-heatmap-svg__tooltip">
            <rect [attr.x]="tooltipX" [attr.y]="tooltipY" width="200" height="80" rx="6" fill="#1A1A1A" stroke="#FFFFFF" stroke-width="0.6" />
            <text [attr.x]="tooltipX + 10" [attr.y]="tooltipY + 22" font-size="13" font-weight="700" fill="#F5F5F5">{{ h.section }} szektor</text>
            <text [attr.x]="tooltipX + 10" [attr.y]="tooltipY + 40" font-size="11" fill="#DDDDDD">Foglaltság: {{ h.occupancyPercent }}%</text>
            <text [attr.x]="tooltipX + 10" [attr.y]="tooltipY + 56" font-size="11" fill="#DDDDDD">Eladott: {{ h.sold }} · Foglalt: {{ h.locked }}</text>
            <text [attr.x]="tooltipX + 10" [attr.y]="tooltipY + 72" font-size="11" fill="#DDDDDD">Szabad: {{ h.available }} / {{ h.total }}</text>
          </g>
        }
      </svg>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .kte-heatmap-wrapper {
        background: var(--kte-ink);
        border-radius: 12px; /* deliberate exception: no 12px token */
        padding: 16px;
      }
      .kte-heatmap-svg {
        width: 100%;
        height: auto;
        max-height: 480px;
      }
      .kte-heatmap-svg__sector {
        cursor: pointer;
        transition: opacity 0.15s ease;
      }
      .kte-heatmap-svg__sector:hover {
        opacity: 0.9;
      }
    `,
  ],
})
export class StadiumHeatmapComponent {
  private readonly _sectors = signal<readonly SectorOccupancy[]>([]);

  @Input({ required: true })
  set sectors(value: readonly SectorOccupancy[]) {
    this._sectors.set(value ?? []);
  }
  get sectors(): readonly SectorOccupancy[] {
    return this._sectors();
  }

  protected readonly hovered = signal<string | null>(null);
  protected readonly viewBox = `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`;
  protected readonly pitch = PITCH_RECT;
  protected readonly tooltipX = 12;
  protected readonly tooltipY = VIEWBOX_HEIGHT - 92;

  protected readonly sectorsRender = computed<readonly SectorRender[]>(() => {
    const data = this._sectors();
    const byName = new Map(data.map((s) => [s.section, s]));
    return SECTOR_LAYOUT.flatMap((placement) => {
      const sector = byName.get(placement.section);
      if (!sector) {
        return [];
      }
      const fill = colorFor(sector.occupancyPercent);
      return [
        {
          ...placement,
          fill,
          textColor: textColorFor(sector.occupancyPercent),
          data: sector,
        },
      ];
    });
  });

  protected readonly hoveredSector = computed<SectorOccupancy | null>(() => {
    const name = this.hovered();
    if (!name) {
      return null;
    }
    return this._sectors().find((s) => s.section === name) ?? null;
  });
}

function colorFor(percent: number): string {
  if (percent >= 80) return '#8B0000';
  if (percent >= 60) return '#C94B1E';
  if (percent >= 40) return '#C97A1E';
  if (percent >= 20) return '#2D5A40';
  return '#1E3A2F';
}

function textColorFor(percent: number): string {
  return percent >= 40 ? '#FFFFFF' : '#F5F5F5';
}
