import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import {
  PRICE_CATEGORY_LABEL,
  PriceCategory,
  SectorSummary,
} from '../../../../shared/models/seat.model';
import { HufCurrencyPipe } from '../../../../shared/pipes/huf-currency.pipe';
import { gateLabel } from '../../../../shared/utils/gate';
import { hungarianArticle } from '../../../../shared/utils/hungarian-article';
import { coverDescription, coverLabel } from '../../../../shared/utils/sector-cover';
import {
  PITCH,
  TIER_ORDER,
  TIER_STYLE,
  VIEW_HEIGHT,
  VIEW_WIDTH,
  gateMarkers,
  occupancyOutline,
  sectorShapes,
  tierFromPrices,
} from './stadium-map.geometry';

interface SectorView {
  readonly summary: SectorSummary;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
  /** A label this narrow does not fit a sector's width: the code is smaller. */
  readonly small: boolean;
  readonly fill: string;
  readonly text: string;
  readonly outline: 'full' | 'busy' | 'none';
  readonly covered: boolean | null;
  readonly selectable: boolean;
  readonly aria: string;
}

/**
 * The Széktói Stadion: the upper arc above the pitch, the main-building arc
 * below it, four gates on the outline. Colour is the price tier, in four steps
 * of the brand purple; how full a sector is shows in its outline. The away
 * section is drawn hatched and cannot be selected.
 */
@Component({
  selector: 'kte-stadium-map',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HufCurrencyPipe],
  template: `
    <div class="kte-map" role="group" aria-label="Széktói Stadion lelátóinak térképe">
      <svg
        [attr.viewBox]="'0 0 ' + viewWidth + ' ' + viewHeight"
        xmlns="http://www.w3.org/2000/svg"
        class="kte-map__svg"
      >
        <defs>
          <pattern id="kte-away-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="8" height="8" fill="var(--border-light)" />
            <line x1="0" y1="0" x2="0" y2="8" stroke="var(--seat-disabled)" stroke-width="4" />
          </pattern>
        </defs>

        <!-- Pitch: neutral, never a seat-state colour -->
        <rect
          [attr.x]="pitch.x"
          [attr.y]="pitch.y"
          [attr.width]="pitch.width"
          [attr.height]="pitch.height"
          rx="8"
          class="kte-map__pitch"
        />
        <line class="kte-map__pitch-line" [attr.x1]="500" [attr.y1]="pitch.y" [attr.x2]="500" [attr.y2]="pitch.y + pitch.height" />
        <circle class="kte-map__pitch-line" cx="500" [attr.cy]="pitch.y + pitch.height / 2" r="26" fill="none" />
        <text class="kte-map__pitch-label" x="500" [attr.y]="pitch.y + pitch.height / 2 + 5" text-anchor="middle">PÁLYA</text>

        <g class="kte-map__sectors">
          @for (view of views(); track view.summary.section) {
            <g
              class="kte-map__sector"
              [class.kte-map__sector--active]="view.summary.section === selectedSection"
              [class.kte-map__sector--away]="view.summary.isAway"
              [attr.data-section]="view.summary.section"
              [attr.data-away]="view.summary.isAway"
              [attr.tabindex]="view.selectable ? 0 : null"
              [attr.role]="view.selectable ? 'button' : 'img'"
              [attr.aria-pressed]="view.selectable ? view.summary.section === selectedSection : null"
              [attr.aria-label]="view.aria"
              (click)="onSectorClick(view)"
              (keyup.enter)="onSectorClick(view)"
            >
              <path
                [attr.d]="view.path"
                class="kte-map__shape"
                [attr.data-outline]="view.outline"
                [style.fill]="view.fill"
              >
                <title>{{ view.aria }}</title>
              </path>
              <text
                [attr.x]="view.labelX"
                [attr.y]="view.labelY + 5"
                text-anchor="middle"
                class="kte-map__code"
                [class.kte-map__code--small]="view.small"
                [style.fill]="view.text"
                pointer-events="none"
              >
                {{ view.summary.section }}
              </text>
              @if (view.covered === true) {
                <path
                  [attr.d]="roof(view.labelX, view.labelY + 17)"
                  class="kte-map__roof"
                  fill="none"
                  [style.stroke]="view.text"
                  pointer-events="none"
                  data-testid="map-cover"
                />
              }
            </g>
          }
        </g>

        <g class="kte-map__gates" aria-hidden="true">
          @for (g of gates; track g.gate) {
            <g [attr.transform]="'translate(' + g.x + ',' + g.y + ')'" [attr.data-gate]="g.gate">
              <circle r="15" class="kte-map__gate" />
              <text y="5" text-anchor="middle" class="kte-map__gate-text">{{ g.gate }}</text>
            </g>
          }
        </g>
      </svg>

      <ul class="legend" aria-label="Jelmagyarázat">
        @for (t of tiers(); track t.tier) {
          <li data-testid="legend-tier">
            <span class="legend__swatch" [style.background]="t.fill" aria-hidden="true"></span>
            {{ t.label }}
            @if (t.from !== null) {
              <span class="legend__price">{{ t.from | hufCurrency }}-tól</span>
            }
          </li>
        }
        @if (away(); as a) {
          <li data-testid="legend-away">
            <span class="legend__swatch legend__swatch--away" aria-hidden="true"></span>{{ a.name }}
          </li>
        }
        <li>
          <svg class="legend__roof" viewBox="-8 -6 16 12" aria-hidden="true"><path [attr.d]="roof(0, 2)" fill="none" stroke="currentColor" stroke-width="2" /></svg>
          fedett
        </li>
        <li><span class="legend__gate" aria-hidden="true">1-4</span> bejárat</li>
      </ul>

      @if (away(); as a) {
        <p class="away-note" data-testid="away-note">
          <strong>{{ awayArticle(a.name) }} {{ a.name }}</strong> a vendégszurkolóké, a portálon nem vásárolható.
        </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-map {
        width: 100%;
        max-width: 960px;
        margin: 0 auto;
        padding: 16px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }

      .kte-map__svg {
        display: block;
        width: 100%;
        height: auto;
        font-family: var(--font-display);
      }

      .kte-map__pitch {
        fill: var(--border-light);
        stroke: var(--muted);
        stroke-width: 3;
      }

      .kte-map__pitch-line {
        stroke: var(--muted);
        stroke-width: 2;
      }

      .kte-map__pitch-label {
        fill: var(--muted);
        font-size: 16px;
        font-weight: 700;
      }

      .kte-map__sector {
        cursor: pointer;
        outline: none;
      }

      .kte-map__sector--away {
        cursor: not-allowed;
      }

      .kte-map__shape {
        stroke: #ffffff;
        stroke-width: 2;
        transition: filter 0.15s ease;
      }

      .kte-map__sector--away .kte-map__shape {
        fill: url(#kte-away-hatch) !important;
        stroke: var(--seat-disabled);
      }

      /* How full a sector is: an outline, never the fill (the fill is the price tier). */
      .kte-map__shape[data-outline='full'] {
        stroke: var(--seat-sold);
        stroke-width: 5;
      }

      .kte-map__shape[data-outline='busy'] {
        stroke: var(--seat-locked);
        stroke-width: 4;
      }

      .kte-map__sector:not(.kte-map__sector--away):hover .kte-map__shape {
        filter: brightness(1.12);
      }

      .kte-map__sector:focus-visible .kte-map__shape,
      .kte-map__sector--active .kte-map__shape {
        stroke: var(--ink);
        stroke-width: 5;
      }

      .kte-map__code {
        font-size: 18px;
        font-weight: 800;
      }

      .kte-map__code--small {
        font-size: 13px;
      }

      .kte-map__sector--away .kte-map__code {
        fill: var(--muted) !important;
      }

      .kte-map__roof {
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .kte-map__gate {
        fill: var(--ink);
        stroke: #ffffff;
        stroke-width: 2;
      }

      .kte-map__gate-text {
        fill: #ffffff;
        font-size: 15px;
        font-weight: 800;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 20px;
        margin: 12px 0 0;
        padding: 0;
        list-style: none;
        font-size: 13px;
        color: var(--ink);
      }

      .legend li {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .legend__swatch {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1px solid var(--border);
      }

      .legend__swatch--away {
        background: repeating-linear-gradient(45deg, var(--border-light) 0 3px, var(--seat-disabled) 3px 6px);
      }

      .legend__price {
        color: var(--muted);
      }

      .legend__roof {
        width: 16px;
        height: 12px;
        color: var(--brand-deep);
      }

      .legend__gate {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 18px;
        padding: 0 4px;
        border-radius: 999px;
        background: var(--ink);
        color: #ffffff;
        font-size: 11px;
        font-weight: 700;
      }

      .away-note {
        margin: 10px 0 0;
        font-size: 13px;
        color: var(--muted);
      }
    `,
  ],
})
export class StadiumMapComponent {
  private readonly summaries = signal<readonly SectorSummary[]>([]);

  @Input() set sectorSummary(value: readonly SectorSummary[]) {
    this.summaries.set(value ?? []);
  }
  @Input() selectedSection: string | null = null;
  @Output() sectorSelected = new EventEmitter<string>();

  protected readonly viewWidth = VIEW_WIDTH;
  protected readonly viewHeight = VIEW_HEIGHT;
  protected readonly pitch = PITCH;
  protected readonly gates = gateMarkers();

  protected readonly views = computed<readonly SectorView[]>(() => {
    const byCode = new Map(this.summaries().map((s) => [s.section, s]));
    return sectorShapes(this.summaries()).map((shape) => {
      const summary = byCode.get(shape.section) as SectorSummary;
      const style = summary.priceCategory ? TIER_STYLE[summary.priceCategory] : TIER_STYLE.upper; // away: hatched over this
      return {
        summary,
        path: shape.path,
        labelX: shape.labelX,
        labelY: shape.labelY,
        small: shape.angle < 11,
        fill: style.fill,
        text: style.text,
        outline: occupancyOutline(summary),
        covered: summary.covered,
        selectable: !summary.isAway,
        aria: this.ariaFor(summary),
      };
    });
  });

  /** Legend entries: only tiers that have a sector on sale, dearest first, with the lowest price. */
  protected readonly tiers = computed(() => {
    const from = tierFromPrices(this.summaries());
    return TIER_ORDER.filter((t) => from[t] !== null).map((t: PriceCategory) => ({
      tier: t,
      label: PRICE_CATEGORY_LABEL[t],
      fill: TIER_STYLE[t].fill,
      from: from[t],
    }));
  });

  protected readonly away = computed(() => this.summaries().find((s) => s.isAway) ?? null);

  protected onSectorClick(view: SectorView): void {
    // The away section is not for sale through the portal: nothing to open.
    if (!view.selectable) {
      return;
    }
    this.sectorSelected.emit(view.summary.section);
  }

  protected awayArticle(name: string): string {
    return hungarianArticle(name) === 'az' ? 'Az' : 'A';
  }

  /** A small roof: three points, drawn under the sector code of a covered sector. */
  protected roof(x: number, y: number): string {
    return `M${x - 7},${y + 3} L${x},${y - 3} L${x + 7},${y + 3}`;
  }

  private ariaFor(s: SectorSummary): string {
    if (s.isAway) {
      return `${s.name}: vendégszektor, a portálon nem vásárolható`;
    }
    const parts = [
      s.name,
      `${s.available} szabad / ${s.total}`,
      s.priceCategory ? PRICE_CATEGORY_LABEL[s.priceCategory] : null,
      coverLabel(s.covered) ? coverDescription(s.covered) : null,
      gateLabel(s.gate),
    ];
    return parts.filter((p): p is string => !!p).join(', ');
  }
}
