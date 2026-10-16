import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { SECTOR_COMPASS_LABEL, SectorSummary } from '../../../../shared/models/seat.model';

interface SectorPath {
  readonly section: string;
  readonly label: string;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
}

const SECTORS: readonly SectorPath[] = [
  // North = A (top)
  { section: 'A', label: 'Észak — A szektor', path: 'M120,40 L520,40 L460,160 L180,160 Z', labelX: 320, labelY: 110 },
  // South = B (bottom)
  { section: 'B', label: 'Dél — B szektor', path: 'M180,360 L460,360 L520,480 L120,480 Z', labelX: 320, labelY: 430 },
  // East = C (right)
  { section: 'C', label: 'Kelet — C szektor', path: 'M460,160 L580,200 L580,320 L460,360 Z', labelX: 525, labelY: 265 },
  // West = VIP (left)
  { section: 'VIP', label: 'Nyugat — VIP', path: 'M60,200 L180,160 L180,360 L60,320 Z', labelX: 115, labelY: 265 },
];

@Component({
  selector: 'kte-stadium-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgFor, NgIf],
  template: `
    <div class="kte-map" role="img" aria-label="Széktói Stadion lelátóinak térképe">
      <svg viewBox="0 0 640 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="false">
        <defs>
          <linearGradient id="kte-pitch-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#1d8348" />
            <stop offset="100%" stop-color="#196f3d" />
          </linearGradient>
        </defs>

        <!-- Pitch -->
        <rect
          x="180"
          y="160"
          width="280"
          height="200"
          rx="8"
          fill="url(#kte-pitch-gradient)"
          stroke="#ffffff"
          stroke-width="3"
        />
        <line x1="320" y1="160" x2="320" y2="360" stroke="#ffffff" stroke-width="2" />
        <circle cx="320" cy="260" r="28" fill="none" stroke="#ffffff" stroke-width="2" />
        <text
          x="320"
          y="265"
          fill="#ffffff"
          font-size="14"
          font-weight="700"
          text-anchor="middle"
          font-family="Archivo, system-ui, sans-serif"
          aria-label="pálya"
        >
          PÁLYA
        </text>

        <!-- Sectors -->
        <g class="kte-map__sectors">
          <g
            *ngFor="let sector of sectors; trackBy: trackBySection"
            class="kte-map__sector"
            [class.kte-map__sector--active]="sector.section === selectedSection"
            (click)="onSectorClick(sector.section)"
            (keyup.enter)="onSectorClick(sector.section)"
            tabindex="0"
            role="button"
            [attr.aria-pressed]="sector.section === selectedSection"
            [attr.aria-label]="sector.label + ': ' + getSummaryText(sector.section)"
          >
            <path
              [attr.d]="sector.path"
              [attr.fill]="fillFor(sector.section)"
              stroke="#ffffff"
              stroke-width="2"
            />
            <text
              [attr.x]="sector.labelX"
              [attr.y]="sector.labelY"
              text-anchor="middle"
              font-size="20"
              font-weight="700"
              fill="#ffffff"
              font-family="Archivo, system-ui, sans-serif"
              pointer-events="none"
            >
              {{ sector.section }}
            </text>
            <text
              [attr.x]="sector.labelX"
              [attr.y]="sector.labelY + 18"
              text-anchor="middle"
              font-size="10"
              fill="#ffffff"
              opacity="0.85"
              pointer-events="none"
            >
              {{ compassLabel(sector.section) }}
            </text>
          </g>
        </g>
      </svg>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-map {
        width: 100%;
        max-width: 720px;
        margin: 0 auto;
        padding: 16px;
        background: linear-gradient(135deg, var(--kte-brand-deep), var(--kte-ink));
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-md);
      }

      svg {
        display: block;
        width: 100%;
        height: auto;
      }

      .kte-map__sector {
        cursor: pointer;
        transition: filter 0.18s ease, transform 0.18s ease;
        outline: none;
      }

      .kte-map__sector:hover path {
        filter: brightness(1.12);
      }

      .kte-map__sector:focus-visible path {
        stroke: var(--kte-brand-mid);
        stroke-width: 4;
      }

      .kte-map__sector--active path {
        stroke: var(--kte-brand-mid);
        stroke-width: 4;
      }
    `,
  ],
})
export class StadiumMapComponent {
  @Input() sectorSummary: readonly SectorSummary[] = [];
  @Input() selectedSection: string | null = null;
  @Output() sectorSelected = new EventEmitter<string>();

  protected readonly sectors = SECTORS;

  protected onSectorClick(section: string): void {
    this.sectorSelected.emit(section);
  }

  protected trackBySection(_index: number, item: SectorPath): string {
    return item.section;
  }

  protected compassLabel(section: string): string {
    return SECTOR_COMPASS_LABEL[section] ?? section;
  }

  /**
   * SVG presentation attribute fallback — browsers accept CSS custom
   * properties in `fill` only inconsistently, so we return raw hex that
   * mirror the design-token values (--kte-brand-deep, --kte-seat-sold,
   * --kte-seat-locked, --kte-brand-mid). Keep in sync with styles.scss.
   */
  protected fillFor(section: string): string {
    const summary = this.sectorSummary.find((s) => s.section === section);
    if (!summary) {
      return '#4A1D6A'; // --kte-brand-deep
    }
    const occupancy = summary.occupancyRatio;
    if (occupancy >= 0.95) {
      return '#8A1C1C'; // --kte-seat-sold
    }
    if (occupancy >= 0.6) {
      return '#C77700'; // --kte-seat-locked
    }
    return '#6B2D96'; // --kte-brand-mid
  }

  protected getSummaryText(section: string): string {
    const summary = this.sectorSummary.find((s) => s.section === section);
    if (!summary) {
      return 'nincs adat';
    }
    return `${summary.available} szabad / ${summary.total}`;
  }
}
