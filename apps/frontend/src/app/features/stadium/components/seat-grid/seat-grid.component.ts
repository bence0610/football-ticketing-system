import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { ARC_LABEL, SeatStatus, StadiumArc } from '../../../../shared/models/seat.model';
import { HufCurrencyPipe } from '../../../../shared/pipes/huf-currency.pipe';
import { gateLabel } from '../../../../shared/utils/gate';
import { sectorName } from '../../../../shared/utils/sector-name';
import { coverLabel } from '../../../../shared/utils/sector-cover';
import {
  AISLE_PX,
  GAP_PX,
  LABEL_PX,
  SEAT_PX,
  Size,
  View,
  centreOn,
  constrain,
  fitScale,
  pinchOf,
  seatIsTappable,
  zoomAt,
} from './pan-zoom';

/**
 * What a seat looks like on the board. `selected` is the visitor's own seat (in their cart).
 * `ticketed` exists on the season board only: a ticket for an upcoming match is on the seat.
 */
export type SeatVisual = 'free' | 'selected' | 'locked' | 'sold' | 'pass' | 'ticketed' | 'unusable';

interface SeatVm {
  readonly seat: SeatStatus;
  /** An aisle follows this seat in its row. */
  readonly aisleAfter: boolean;
  /** "C/2 szektor, 3. sor, 14. szék, 2 800 Ft": the state is appended per render. */
  readonly base: string;
}

interface RowVm {
  readonly row: string;
  readonly seats: readonly SeatVm[];
}

/** The six states, the glyph that marks each one (so colour is never the only cue), and its name. */
export const SEAT_STATES: ReadonlyArray<{ readonly state: SeatVisual; readonly glyph: string; readonly name: string }> = [
  { state: 'free', glyph: '12', name: 'Szabad (a szék száma látszik)' },
  { state: 'selected', glyph: '✓', name: 'A te kiválasztott helyed' },
  { state: 'locked', glyph: '…', name: 'Más épp foglalja (rövid ideig)' },
  { state: 'sold', glyph: '×', name: 'Elkelt' },
  { state: 'pass', glyph: 'B', name: 'Bérletes hely' },
  { state: 'unusable', glyph: '–', name: 'Nem használható' },
];

/**
 * Season mode: the board of a season-pass purchase. There is no "sold" state (one match's
 * sale says nothing about the season): a seat is free for the season, already someone's
 * pass, ticketed for an upcoming match (so no pass can start on it), being paid for by
 * another buyer right now, or not usable.
 */
export const SEASON_SEAT_STATES: ReadonlyArray<{ readonly state: SeatVisual; readonly glyph: string; readonly name: string }> = [
  { state: 'free', glyph: '12', name: 'Szabad' },
  { state: 'selected', glyph: '✓', name: 'Kiválasztott' },
  { state: 'pass', glyph: 'B', name: 'Már bérlet tartozik rá' },
  { state: 'ticketed', glyph: 'J', name: 'Közelgő meccsre már van jegy: nem váltható bérletre' },
  { state: 'locked', glyph: '…', name: 'Másik vásárló épp fizet' },
  { state: 'unusable', glyph: '–', name: 'Nem használható' },
];

/** The glyph of every state (the free seat shows its number instead). */
const GLYPH: Readonly<Record<Exclude<SeatVisual, 'free'>, string>> = {
  selected: '✓',
  locked: '…',
  sold: '×',
  pass: 'B',
  ticketed: 'J',
  unusable: '–',
};

/** Which board: a single match (tickets) or the season (passes). */
export type SeatGridMode = 'match' | 'season';

const SEASON_STATE_TEXT: Record<SeatVisual, string> = {
  free: 'szabad bérletes hely',
  selected: 'kiválasztva',
  locked: 'másik vásárló épp fizet érte',
  sold: 'nem használható',
  pass: 'már bérlet tartozik rá',
  ticketed: 'közelgő meccsre már van jegy, bérletre nem választható',
  unusable: 'nem használható',
};

const STATE_TEXT: Record<SeatVisual, string> = {
  free: 'szabad',
  selected: 'kiválasztva',
  locked: 'más épp foglalja',
  sold: 'elkelt',
  pass: 'bérletes hely',
  // never produced on a match board; kept so the table is complete
  ticketed: 'nem használható',
  unusable: 'nem használható',
};

const PITCH_PX = 34;
const PITCH_GAP_PX = 12;
const DRAG_THRESHOLD_PX = 8;
const MAX_PORT_HEIGHT_PX = 620;

/**
 * The seat board of one sector (the design's "Stadion board").
 *
 *  - A dark PÁLYA strip on top: row 1 is the front, nearest the pitch.
 *  - Rows labelled on the left, in numeric order; seats are rounded squares with a
 *    wider gap where the aisles are (`aisles`, from the server: the same list the
 *    best-seats finder respects).
 *  - Six states, each told apart by a glyph and texture as well as by colour; the
 *    legend below the board names all of them.
 *  - Pinch to zoom, drag to pan, ctrl+wheel and the +/- buttons on a desktop. Seats are
 *    44 px at natural size (the project's minimum tap target) and the board never zooms past 1.25x (55 px). When the
 *    board is shrunk so far that a seat is too small to hit (under 32 px for a finger,
 *    18 for a mouse), a tap zooms in on that spot instead of selecting.
 *
 * Performance: one click listener for the whole board (not one per seat), plain class
 * strings instead of ngClass objects, no per-seat directives (the old grid's 448
 * matTooltips were the biggest cost), and pan/zoom only writes a CSS transform outside
 * Angular, so a gesture does not run change detection.
 */
@Component({
  selector: 'kte-seat-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (section) {
      <section class="kte-seat-grid">
        <header class="kte-seat-grid__header">
          <h3>
            {{ displayName() }}
            @if (arcText(); as arc) {
              <span class="kte-seat-grid__chip" data-testid="grid-arc">{{ arc }}</span>
            }
            @if (gateText(); as g) {
              <span class="kte-seat-grid__chip kte-seat-grid__chip--gate" data-testid="grid-gate">{{ g }}</span>
            }
            @if (coverText(); as label) {
              <span
                class="kte-seat-grid__cover"
                [class.kte-seat-grid__cover--covered]="covered === true"
                data-testid="grid-cover"
                >{{ label }}</span
              >
            }
          </h3>
          <p data-testid="grid-help">
            {{ helpText() }}
            @if (longestRun !== null) {
              <span class="kte-seat-grid__run" data-testid="grid-longest-run">{{ longestRunText() }}</span>
            }
          </p>
        </header>

        <div class="kte-seat-grid__zoom" role="group" aria-label="Nagyítás">
          <button type="button" class="kte-seat-grid__zoom-btn" (click)="zoomBy(1 / 1.25)" aria-label="Kicsinyítés">−</button>
          <button type="button" class="kte-seat-grid__zoom-btn" (click)="zoomBy(1.25)" aria-label="Nagyítás">+</button>
          <button type="button" class="kte-seat-grid__zoom-btn kte-seat-grid__zoom-btn--wide" (click)="fit()">
            Teljes szektor
          </button>
        </div>

        <div #port class="kte-seat-grid__port" data-testid="grid-port" (focusin)="onFocusIn($event)">
          <div
            #board
            class="kte-seat-grid__board"
            [style.width.px]="boardSize().w"
            [style.height.px]="boardSize().h"
            (click)="onBoardClick($event)"
          >
            <div class="kte-seat-grid__pitch" aria-hidden="true">PÁLYA</div>
            @for (row of rows(); track row.row) {
              <div class="kte-seat-grid__row" role="group" [attr.aria-label]="row.row + '. sor'">
                <span class="kte-seat-grid__row-label">{{ row.row }}. sor</span>
                @for (vm of row.seats; track vm.seat.id) {
                  <button
                    type="button"
                    [class]="seatClass(vm)"
                    [attr.data-id]="vm.seat.id"
                    [attr.aria-label]="ariaLabel(vm)"
                    [attr.aria-pressed]="isChosen(vm) ? 'true' : null"
                    [attr.aria-disabled]="isActionable(vm) ? null : 'true'"
                    [attr.tabindex]="isActionable(vm) ? 0 : -1"
                    [attr.title]="ariaLabel(vm)"
                  >{{ glyph(vm) }}</button>
                }
              </div>
            }
          </div>
        </div>

        @if (rows().length === 0) {
          <p class="kte-seat-grid__empty">{{ emptyText() }}</p>
        }

        <ul class="kte-seat-grid__legend" aria-label="Jelmagyarázat" data-testid="grid-legend">
          @for (item of legend(); track item.state) {
            <li>
              <span class="kte-seat kte-seat--{{ item.state }} kte-seat--legend" aria-hidden="true">{{ item.glyph }}</span>
              {{ item.name }}
            </li>
          }
          <li>
            <span class="kte-seat kte-seat--free kte-seat--acc kte-seat--legend" aria-hidden="true">7</span>
            Akadálymentes hely
          </li>
        </ul>
      </section>
    } @else {
      <div class="kte-seat-grid__placeholder">
        <p>Válassz szektort a térképen az ülésrend megnyitásához.</p>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-seat-grid {
        background: var(--kte-surface);
        border-radius: var(--kte-radius-lg);
        padding: 24px;
        box-shadow: var(--kte-shadow-sm);
      }
      @media (max-width: 480px) {
        .kte-seat-grid {
          padding: 16px;
        }
      }

      .kte-seat-grid__header h3 {
        margin: 0;
        font-family: var(--kte-font-display);
        font-size: 24px;
        font-weight: 700;
        color: var(--kte-brand-deep);
      }
      .kte-seat-grid__header p {
        margin: 4px 0 12px;
        color: var(--kte-muted);
        font-size: 13px;
      }
      .kte-seat-grid__run {
        display: inline-block;
        margin-left: 6px;
        font-weight: 700;
        color: var(--kte-ink);
      }

      .kte-seat-grid__chip,
      .kte-seat-grid__cover {
        margin-left: 8px;
        padding: 2px 10px;
        border-radius: 999px;
        background: var(--border-light);
        color: var(--muted);
        font-family: var(--font-body, inherit);
        font-size: 12px;
        font-weight: 600;
        vertical-align: middle;
        white-space: nowrap;
        display: inline-block;
        margin-top: 4px;
      }
      .kte-seat-grid__chip--gate {
        background: var(--ink);
        color: #ffffff;
      }
      .kte-seat-grid__cover--covered {
        background: var(--brand-tint);
        color: var(--brand-deep);
      }

      .kte-seat-grid__zoom {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }
      .kte-seat-grid__zoom-btn {
        min-width: 44px;
        min-height: 44px;
        padding: 0 12px;
        font: inherit;
        font-size: 20px;
        line-height: 1;
        color: var(--ink);
        background: var(--kte-surface);
        border: 1px solid var(--border);
        border-radius: var(--kte-radius);
        cursor: pointer;
      }
      .kte-seat-grid__zoom-btn--wide {
        font-size: 14px;
        font-weight: 600;
      }
      .kte-seat-grid__zoom-btn:focus-visible {
        outline: 2px solid var(--brand-mid);
        outline-offset: 2px;
      }

      /* The viewport: a fixed-size window onto the board, which is moved with a transform. */
      .kte-seat-grid__port {
        position: relative;
        overflow: hidden;
        overflow: clip;
        border: 1px solid var(--border);
        border-radius: var(--kte-radius);
        background: var(--page);
        /* the page may scroll vertically over a board that fits; JS switches to 'none' once zoomed in */
        touch-action: pan-y;
        overscroll-behavior: contain;
        user-select: none;
        -webkit-user-select: none;
      }
      .kte-seat-grid__port[data-zoomed='true'] {
        touch-action: none;
      }

      .kte-seat-grid__board {
        position: absolute;
        top: 0;
        left: 0;
        transform-origin: 0 0;
        will-change: transform;
        padding: 0;
      }
      .kte-seat-grid__board--animate {
        transition: transform 0.18s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .kte-seat-grid__board--animate {
          transition: none;
        }
      }

      .kte-seat-grid__pitch {
        height: ${PITCH_PX}px;
        margin-bottom: ${PITCH_GAP_PX}px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--ink);
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.32em;
        border-radius: 0 0 var(--kte-radius) var(--kte-radius);
      }

      .kte-seat-grid__row {
        display: flex;
        align-items: center;
        gap: ${GAP_PX}px;
        height: ${SEAT_PX}px;
        margin-bottom: ${GAP_PX}px;
      }
      .kte-seat-grid__row-label {
        flex: 0 0 ${LABEL_PX - GAP_PX}px;
        font-size: 12px;
        font-weight: 600;
        color: var(--muted);
        text-align: right;
        white-space: nowrap;
      }

      /* ---- one seat: shape and texture carry the state, colour is a bonus ---- */
      .kte-seat {
        position: relative;
        flex: 0 0 ${SEAT_PX}px;
        box-sizing: border-box;
        width: ${SEAT_PX}px;
        height: ${SEAT_PX}px;
        padding: 0;
        border: 2px solid transparent;
        border-radius: 10px;
        font: inherit;
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--seat-bg, var(--kte-seat-disabled));
        color: var(--seat-fg, var(--kte-ink));
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .kte-seat--aisle {
        margin-right: ${AISLE_PX}px;
      }
      .kte-seat:focus-visible {
        outline: 3px solid var(--ink);
        outline-offset: 2px;
        z-index: 1;
      }

      /* free: solid, the number */
      .kte-seat--free {
        --seat-bg: var(--kte-seat-free);
        --seat-fg: #ffffff;
      }
      @media (hover: hover) {
        .kte-seat--free:hover {
          filter: brightness(1.12);
        }
      }
      /* selected: dark, a check mark and a ring outside the seat */
      .kte-seat--selected {
        --seat-bg: var(--brand-deep);
        --seat-fg: #ffffff;
        box-shadow: 0 0 0 3px var(--surface), 0 0 0 6px var(--brand-deep);
        z-index: 1;
      }
      /* held by someone else: amber, dashed border, an ellipsis */
      .kte-seat--locked {
        --seat-bg: var(--kte-seat-locked);
        --seat-fg: var(--kte-ink);
        border: 2px dashed var(--kte-ink);
        cursor: not-allowed;
      }
      /* sold: dark red, a cross */
      .kte-seat--sold {
        --seat-bg: var(--kte-seat-sold);
        --seat-fg: #ffffff;
        cursor: not-allowed;
      }
      /* season pass: blue with diagonal stripes, a B (bérlet) */
      .kte-seat--pass {
        --seat-bg: var(--kte-seat-pass);
        --seat-fg: #ffffff;
        background-image: repeating-linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.28) 0,
          rgba(255, 255, 255, 0.28) 4px,
          transparent 4px,
          transparent 8px
        );
        cursor: not-allowed;
      }
      /* ticketed for an upcoming match (season board only): dark red, a double border, level stripes, a J (jegy) */
      .kte-seat--ticketed {
        --seat-bg: var(--kte-seat-sold);
        --seat-fg: #ffffff;
        border: 4px double #ffffff;
        background-image: repeating-linear-gradient(
          0deg,
          rgba(255, 255, 255, 0.22) 0,
          rgba(255, 255, 255, 0.22) 3px,
          transparent 3px,
          transparent 7px
        );
        cursor: not-allowed;
      }
      /* unusable: an empty outline, a dash */
      .kte-seat--unusable {
        --seat-bg: transparent;
        --seat-fg: var(--faint);
        border: 2px dotted var(--faint);
        cursor: not-allowed;
      }
      /* wheelchair mark in the corner, over any state */
      .kte-seat--acc::after {
        content: '♿';
        position: absolute;
        top: -7px;
        right: -7px;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: var(--brand-deep);
        color: #ffffff;
        font-size: 11px;
        line-height: 18px;
        text-align: center;
      }
      .kte-seat--legend {
        width: 28px;
        height: 28px;
        flex-basis: 28px;
        font-size: 12px;
        border-radius: 8px;
        cursor: default;
        vertical-align: middle;
      }
      .kte-seat--legend.kte-seat--selected {
        box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--brand-deep);
      }
      .kte-seat--legend.kte-seat--acc::after {
        top: -6px;
        right: -6px;
        width: 14px;
        height: 14px;
        line-height: 14px;
        font-size: 9px;
      }
      @media (forced-colors: active) {
        .kte-seat {
          border-color: ButtonText;
        }
        .kte-seat--selected {
          border-width: 4px;
        }
      }

      .kte-seat-grid__legend {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 20px;
        margin: 16px 0 0;
        padding: 0;
        list-style: none;
        font-size: 13px;
        color: var(--ink);
      }
      .kte-seat-grid__legend li {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .kte-seat-grid__empty {
        margin: 16px 0 0;
        text-align: center;
        color: var(--kte-muted);
      }

      .kte-seat-grid__placeholder {
        padding: 48px 24px;
        background: var(--kte-surface);
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-sm);
        color: var(--kte-muted);
        text-align: center;
      }
    `,
  ],
})
export class SeatGridComponent implements OnChanges, AfterViewChecked, OnDestroy {
  @Input() seats: readonly SeatStatus[] = [];
  @Input() section: string | null = null;
  /** Display name of the selected sector from the sectors table; falls back to the code. */
  @Input() sectorName: string | null = null;
  @Input() arc: StadiumArc | null = null;
  /** Entrance gate 1..4; null = unknown. */
  @Input() gate: number | null = null;
  /** Is the selected sector under a roof? null = unknown (nothing is shown). */
  @Input() covered: boolean | null = null;
  /** Seat numbers after which an aisle sits, from the server. */
  @Input() aisles: readonly number[] = [];
  /** Longest free run in the sector, from the server; null = not known (nothing is shown). */
  @Input() longestRun: number | null = null;
  /** The visitor's own seats: shown as selected. */
  @Input() chosenIds: ReadonlySet<string> = new Set();
  /** Seats whose lock or release is in flight: not clickable until it lands. */
  @Input() busyIds: ReadonlySet<string> = new Set();
  /**
   * 'match' (default): one match's board, with sold seats and prices. 'season': a season-pass
   * board with no per-match state: any status other than free / pass / ticketed / locked is unusable.
   */
  @Input() mode: SeatGridMode = 'match';
  @Output() seatToggled = new EventEmitter<SeatStatus>();
  /**
   * Season mode only: a seat that cannot be chosen (already a pass, ticketed, being paid for,
   * not usable) was tapped, so the page can say why. Not emitted on a match board, for a seat
   * whose hold is in flight, or when the tap zoomed in instead (seats too small to hit).
   */
  @Output() unavailableSeatTapped = new EventEmitter<SeatStatus>();

  @ViewChild('port') private portRef?: ElementRef<HTMLElement>;
  @ViewChild('board') private boardRef?: ElementRef<HTMLElement>;
  /** The window element the gesture listeners are on now. */
  private attachedTo?: HTMLElement;

  protected readonly rows = signal<readonly RowVm[]>([]);
  protected readonly boardSize = signal<Size>({ w: 0, h: 0 });

  private readonly zone = inject(NgZone);
  private readonly huf = new HufCurrencyPipe();
  private seatById = new Map<string, SeatVm>();

  // ---- pan / zoom state (not signals: it changes on every pointer move, outside Angular) ----
  private view: View = { k: 1, x: 0, y: 0 };
  private port: Size = { w: 0, h: 0 };
  private atFit = true;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: { startView: View; startDistance: number; startMid: { x: number; y: number } } | null = null;
  private dragStart: { x: number; y: number; view: View } | null = null;
  private dragged = false;
  private lastPointerType = 'mouse';
  private resizeObserver?: ResizeObserver;
  private cleanups: Array<() => void> = [];
  private raf = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['seats'] || changes['section'] || changes['aisles'] || changes['mode']) {
      const next = this.buildRows(this.seats);
      this.rows.set(next);
      this.seatById = new Map(next.flatMap((r) => r.seats.map((vm) => [vm.seat.id, vm] as const)));
      this.boardSize.set(this.measureBoard(next));
      if (changes['section']) {
        this.atFit = true;
      }
      // the board's size is bound in the template: apply the view once it is in the DOM
      queueMicrotask(() => this.relayout());
    }
  }

  /**
   * The window and the board exist only while a sector is open, and a sector is often chosen
   * after the grid itself was created. So the gesture listeners are attached whenever the
   * window element appears (a one-off in ngAfterViewInit would miss it) and dropped when it goes.
   */
  ngAfterViewChecked(): void {
    this.syncListeners();
  }

  ngOnDestroy(): void {
    this.detach();
    cancelAnimationFrame(this.raf);
  }

  // ---------------------------------------------------------------------------------------
  // Template helpers
  // ---------------------------------------------------------------------------------------

  protected visualOf(seat: SeatStatus): SeatVisual {
    if (this.chosenIds.has(seat.id)) return 'selected';
    if (this.mode === 'season') {
      switch (seat.status) {
        case 'available':
          return 'free';
        case 'season_pass':
          return 'pass';
        case 'ticketed':
          return 'ticketed';
        case 'locked':
          return 'locked';
        default:
          // 'sold', 'away', 'disabled' or anything new: a season board never shows a match sale
          return 'unusable';
      }
    }
    switch (seat.status) {
      case 'available':
        return 'free';
      case 'locked':
        return 'locked';
      case 'sold':
        return 'sold';
      case 'season_pass':
        return 'pass';
      default:
        return 'unusable';
    }
  }

  protected seatClass(vm: SeatVm): string {
    const state = this.visualOf(vm.seat);
    return (
      `kte-seat kte-seat--${state}` +
      (vm.aisleAfter ? ' kte-seat--aisle' : '') +
      (vm.seat.isAccessible ? ' kte-seat--acc' : '')
    );
  }

  protected glyph(vm: SeatVm): string {
    const state = this.visualOf(vm.seat);
    return state === 'free' ? String(vm.seat.number) : GLYPH[state];
  }

  protected legend(): ReadonlyArray<{ readonly state: SeatVisual; readonly glyph: string; readonly name: string }> {
    return this.mode === 'season' ? SEASON_SEAT_STATES : SEAT_STATES;
  }

  protected helpText(): string {
    return this.mode === 'season'
      ? 'Koppints egy szabad bérletes helyre: az egész szezonban ez lesz a helyed. Még egy koppintással elengeded.'
      : 'Koppints egy szabad székre a kiválasztáshoz, még egyszer a visszavonáshoz.';
  }

  protected emptyText(): string {
    return this.mode === 'season'
      ? 'Ebben a szektorban nincs bérletes hely.'
      : 'Ebben a szektorban a szűrési feltételeknek megfelelően nincs szék.';
  }

  protected isChosen(vm: SeatVm): boolean {
    return this.chosenIds.has(vm.seat.id);
  }

  /** A seat the visitor can do something with: a free one to pick, or their own to put back. */
  protected isActionable(vm: SeatVm): boolean {
    if (this.busyIds.has(vm.seat.id)) return false;
    const state = this.visualOf(vm.seat);
    return state === 'free' || state === 'selected';
  }

  protected ariaLabel(vm: SeatVm): string {
    const state = this.visualOf(vm.seat);
    const words = this.mode === 'season' ? SEASON_STATE_TEXT : STATE_TEXT;
    return `${vm.base}, ${words[state]}${vm.seat.isAccessible ? ', akadálymentes' : ''}`;
  }

  protected longestRunText(): string {
    const n = this.longestRun ?? 0;
    return n > 0 ? `Leghosszabb szabad sor: ${n} hely egymás mellett.` : 'Nincs szabad hely ebben a szektorban.';
  }

  protected coverText(): string | null {
    return coverLabel(this.covered);
  }

  protected displayName(): string {
    return sectorName(this.section ?? '', this.sectorName);
  }

  protected arcText(): string | null {
    return this.arc ? ARC_LABEL[this.arc] : null;
  }

  protected gateText(): string | null {
    return gateLabel(this.gate);
  }

  // ---------------------------------------------------------------------------------------
  // Selecting
  // ---------------------------------------------------------------------------------------

  protected onBoardClick(event: MouseEvent): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-id]');
    const vm = button ? this.seatById.get(button.dataset['id']!) : undefined;
    if (!vm) return;

    // Too small to hit on purpose? Zoom in on the spot instead of guessing which seat was meant.
    if (!seatIsTappable(this.view.k, this.lastPointerType)) {
      this.zoomToPoint(button!);
      return;
    }
    if (this.isActionable(vm)) {
      this.seatToggled.emit(vm.seat);
    } else if (this.mode === 'season' && !this.busyIds.has(vm.seat.id)) {
      // free / selected seats are always actionable unless busy, so this is a seat that cannot be chosen
      this.unavailableSeatTapped.emit(vm.seat);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Pan / zoom
  // ---------------------------------------------------------------------------------------

  protected zoomBy(factor: number): void {
    const cx = this.port.w / 2;
    const cy = this.port.h / 2;
    this.atFit = false;
    this.applyView(zoomAt(this.view, this.view.k * factor, cx, cy, this.minK()), true);
  }

  protected fit(): void {
    this.atFit = true;
    this.relayout(true);
  }

  /**
   * Brings the given seats into view: the board pans (and zooms out if it must) so all
   * of them sit in the middle of the window. The finder calls this after it has placed a run.
   */
  reveal(seatIds: readonly string[]): void {
    const board = this.boardRef?.nativeElement;
    if (!board || seatIds.length === 0) return;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const id of seatIds) {
      const el = board.querySelector<HTMLElement>(`button[data-id="${CSS.escape(id)}"]`);
      if (!el) continue;
      left = Math.min(left, el.offsetLeft);
      top = Math.min(top, el.offsetTop);
      right = Math.max(right, el.offsetLeft + el.offsetWidth);
      bottom = Math.max(bottom, el.offsetTop + el.offsetHeight);
    }
    if (!Number.isFinite(left)) return;
    const margin = 48;
    const fitK = Math.min(this.port.w / (right - left + 2 * margin), this.port.h / (bottom - top + 2 * margin));
    const k = Math.min(1, Math.max(this.minK(), fitK));
    this.atFit = false;
    this.applyView(constrain(centreOn((left + right) / 2, (top + bottom) / 2, k, this.port), this.boardSize(), this.port), true);
  }

  protected onFocusIn(event: FocusEvent): void {
    // A browser scrolls overflow containers to reveal a focused child; ours moves with a transform instead.
    const port = this.portRef?.nativeElement;
    if (port) {
      port.scrollLeft = 0;
      port.scrollTop = 0;
    }
    const el = event.target as HTMLElement;
    if (!el.matches('button[data-id]') || !this.boardRef) return;
    // the board is the seats' offset parent, so these are board coordinates
    const { offsetLeft: bx, offsetTop: by, offsetWidth: w, offsetHeight: h } = el;
    const { k, x, y } = this.view;
    const pad = 12;
    let nx = x;
    let ny = y;
    if (bx * k + x < pad) nx = pad - bx * k;
    else if ((bx + w) * k + x > this.port.w - pad) nx = this.port.w - pad - (bx + w) * k;
    if (by * k + y < pad) ny = pad - by * k;
    else if ((by + h) * k + y > this.port.h - pad) ny = this.port.h - pad - (by + h) * k;
    if (nx !== x || ny !== y) this.applyView(constrain({ k, x: nx, y: ny }, this.boardSize(), this.port), false);
  }

  private zoomToPoint(button: HTMLElement): void {
    const bx = button.offsetLeft + button.offsetWidth / 2;
    const by = button.offsetTop + button.offsetHeight / 2;
    this.atFit = false;
    this.applyView(constrain(centreOn(bx, by, 1, this.port), this.boardSize(), this.port), true);
  }

  private minK(): number {
    return fitScale(this.boardSize(), this.port);
  }

  /** Re-fits (or re-constrains) the view after the board, the viewport or the section changed. */
  private relayout(animate = false): void {
    const port = this.portRef?.nativeElement;
    if (!port) return;
    this.port = { w: port.clientWidth, h: this.port.h };
    const board = this.boardSize();
    // applied at once, not on the next frame: the window gets its height from this
    if (this.atFit || this.view.k < this.minK()) {
      this.applyView(constrain({ k: this.minK(), x: 0, y: 0 }, board, this.port), animate, true);
    } else {
      this.applyView(constrain(this.view, board, this.port), animate, true);
    }
  }

  private applyView(next: View, animate: boolean, immediate = false): void {
    this.view = constrain(next, this.boardSize(), this.port);
    if (animate || immediate) {
      this.write(animate);
      return;
    }
    if (this.raf === 0) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.write(false);
      });
    }
  }

  private write(animate: boolean): void {
    const board = this.boardRef?.nativeElement;
    const port = this.portRef?.nativeElement;
    if (!board || !port) return;
    const k = this.view.k;
    const size = this.boardSize();
    // The window is as tall as the board at this zoom, up to a ceiling; beyond it the board is panned.
    const maxH = Math.min(MAX_PORT_HEIGHT_PX, Math.round(window.innerHeight * 0.7));
    const height = Math.max(160, Math.min(size.h * k, maxH));
    if (height !== this.port.h) {
      this.port = { w: this.port.w, h: height };
      port.style.height = `${height}px`;
      this.view = constrain(this.view, size, this.port);
    }
    board.classList.toggle('kte-seat-grid__board--animate', animate);
    board.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.k})`;
    port.dataset['zoomed'] = String(k > this.minK() + 0.001 || size.w * k > this.port.w + 1);
  }

  /** Attaches the gesture listeners to the window element that is in the DOM now (if it is not already), and drops the old ones. */
  private syncListeners(): void {
    const port = this.portRef?.nativeElement;
    if (port === this.attachedTo) return;
    this.detach();
    if (!port) return;
    this.attachedTo = port;
    this.zone.runOutsideAngular(() => {
      const on = <K extends keyof HTMLElementEventMap>(
        type: K,
        fn: (e: HTMLElementEventMap[K]) => void,
        options?: AddEventListenerOptions,
      ): void => {
        port.addEventListener(type, fn, options);
        this.cleanups.push(() => port.removeEventListener(type, fn));
      };
      on('pointerdown', (e) => this.onPointerDown(e));
      on('pointermove', (e) => this.onPointerMove(e));
      on('pointerup', (e) => this.onPointerEnd(e));
      on('pointercancel', (e) => this.onPointerEnd(e));
      on('wheel', (e) => this.onWheel(e), { passive: false });

      this.resizeObserver = new ResizeObserver(() => this.relayout());
      this.resizeObserver.observe(port);
    });
    this.pointers.clear();
    this.gesture = null;
    this.dragStart = null;
    this.relayout();
  }

  private detach(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.attachedTo = undefined;
  }

  private local(e: PointerEvent): { x: number; y: number } {
    const rect = this.portRef!.nativeElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerDown(e: PointerEvent): void {
    this.lastPointerType = e.pointerType;
    this.pointers.set(e.pointerId, this.local(e));
    this.dragged = false;
    this.atFit = false;
    if (this.pointers.size === 1) {
      const p = this.local(e);
      this.dragStart = { x: p.x, y: p.y, view: this.view };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const pinch = pinchOf(a, b);
      this.gesture = { startView: this.view, startDistance: pinch.distance, startMid: { x: pinch.cx, y: pinch.cy } };
      this.dragStart = null;
      this.dragged = true; // a pinch is never a tap
      this.capture(e.pointerId);
    }
  }

  /** Keeps receiving a drag's events when the finger leaves the window. A pointer that is already gone is not an error. */
  private capture(pointerId: number): void {
    try {
      this.portRef?.nativeElement.setPointerCapture(pointerId);
    } catch {
      // released between the event and now: the gesture simply continues without capture
    }
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, this.local(e));

    if (this.gesture && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const pinch = pinchOf(a, b);
      const g = this.gesture;
      const k = g.startView.k * (pinch.distance / g.startDistance);
      // zoom about the starting midpoint, then follow the midpoint as the fingers travel
      const zoomed = zoomAt(g.startView, k, g.startMid.x, g.startMid.y, this.minK());
      this.applyView({ ...zoomed, x: zoomed.x + (pinch.cx - g.startMid.x), y: zoomed.y + (pinch.cy - g.startMid.y) }, false);
      return;
    }

    if (this.dragStart && this.pointers.size === 1) {
      const p = this.pointers.get(e.pointerId)!;
      const dx = p.x - this.dragStart.x;
      const dy = p.y - this.dragStart.y;
      if (!this.dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        this.dragged = true;
        this.capture(e.pointerId);
      }
      if (this.dragged) {
        const s = this.dragStart.view;
        this.applyView({ k: s.k, x: s.x + dx, y: s.y + dy }, false);
      }
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    if (this.pointers.size === 0) {
      this.dragStart = null;
      // the click that follows a drag is swallowed in onBoardClick; if no click follows, forget the drag
      setTimeout(() => (this.dragged = false), 0);
    } else if (this.pointers.size === 1) {
      const [p] = [...this.pointers.values()];
      this.dragStart = { x: p.x, y: p.y, view: this.view };
    }
  }

  private onWheel(e: WheelEvent): void {
    // A plain wheel scrolls the page; ctrl+wheel (and a trackpad pinch, which arrives as such) zooms.
    if (!e.ctrlKey) return;
    e.preventDefault();
    const rect = this.portRef!.nativeElement.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.01);
    this.atFit = false;
    this.applyView(zoomAt(this.view, this.view.k * factor, e.clientX - rect.left, e.clientY - rect.top, this.minK()), false);
  }

  // ---------------------------------------------------------------------------------------
  // Building the rows
  // ---------------------------------------------------------------------------------------

  private buildRows(seats: readonly SeatStatus[]): readonly RowVm[] {
    const aisles = new Set(this.aisles);
    const name = sectorName(this.section ?? '', this.sectorName);
    const byRow = new Map<string, SeatStatus[]>();
    for (const seat of seats) {
      const list = byRow.get(seat.row);
      if (list) list.push(seat);
      else byRow.set(seat.row, [seat]);
    }
    return Array.from(byRow.entries())
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([row, list]) => ({
        row,
        seats: list
          .sort((a, b) => a.number - b.number)
          .map((seat) => ({
            seat,
            aisleAfter: aisles.has(seat.number),
            // a season board names the place only: the pass price is shown once, beside the board
            base:
              this.mode === 'season'
                ? `${name}, ${seat.row}. sor, ${seat.number}. hely`
                : `${name}, ${seat.row}. sor, ${seat.number}. szék, ${this.huf.transform(seat.price)}`,
          })),
      }));
  }

  /** The board's natural size from its widest row and its row count. */
  private measureBoard(rows: readonly RowVm[]): Size {
    let widest = 0;
    for (const row of rows) {
      const aisleCount = row.seats.filter((vm, i) => vm.aisleAfter && i < row.seats.length - 1).length;
      widest = Math.max(widest, row.seats.length * (SEAT_PX + GAP_PX) - GAP_PX + aisleCount * AISLE_PX);
    }
    return {
      w: rows.length === 0 ? 0 : LABEL_PX + widest,
      h: PITCH_PX + PITCH_GAP_PX + rows.length * (SEAT_PX + GAP_PX),
    };
  }
}
