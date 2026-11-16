import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CartItem, MAX_CART_ITEMS } from '../../../../shared/models/cart.model';
import { HufCurrencyPipe } from '../../../../shared/pipes/huf-currency.pipe';
import { sectorName } from '../../../../shared/utils/sector-name';

/**
 * The sticky summary beside the seat grid: the chosen seats with their prices, the
 * total, and the button onwards.
 *
 * "Chosen" means in the cart: a seat is locked for the visitor the moment they pick
 * it, so this list is the cart's contents for the match on screen, and what it
 * shows is exactly what the next page will hold.
 *
 * Wide screens: a card that sticks beside the grid. Phones: a bar that sticks to the
 * bottom edge, showing the count, the total and the button; the list opens on demand
 * so it never covers the grid.
 */
@Component({
  selector: 'kte-seat-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HufCurrencyPipe],
  template: `
    <aside class="kte-summary" [class.kte-summary--open]="open()" aria-label="Kiválasztott helyek" data-testid="seat-summary">
      <button
        type="button"
        class="kte-summary__toggle"
        [attr.aria-expanded]="open()"
        aria-controls="kte-summary-list"
        (click)="open.set(!open())"
      >
        <span class="kte-summary__title">Kiválasztott helyek</span>
        <span class="kte-summary__count" data-testid="summary-count">{{ items.length }} / {{ max }}</span>
      </button>

      <div id="kte-summary-list" class="kte-summary__body">
        @if (items.length === 0) {
          <p class="kte-summary__empty" data-testid="summary-empty">
            Még nincs kiválasztott hely. Koppints egy szabad székre, vagy kérd a legjobb helyeket automatikusan.
          </p>
        } @else {
          <ul class="kte-summary__list">
            @for (item of items; track item.seatId) {
              <li class="kte-summary__item" data-testid="summary-item">
                <span class="kte-summary__seat">
                  <strong>{{ name(item) }}</strong>
                  <span>{{ item.row }}. sor, {{ item.seatNumber }}. szék</span>
                </span>
                <span class="kte-summary__price">{{ item.price | hufCurrency }}</span>
                <button
                  type="button"
                  class="kte-summary__remove"
                  [attr.aria-label]="name(item) + ', ' + item.row + '. sor, ' + item.seatNumber + '. szék elvétele'"
                  (click)="remove.emit(item.seatId)"
                >
                  ×
                </button>
              </li>
            }
          </ul>
        }
      </div>

      <footer class="kte-summary__footer">
        <div class="kte-summary__total">
          <span>Összesen</span>
          <strong data-testid="summary-total">{{ total() | hufCurrency }}</strong>
        </div>
        <button
          type="button"
          class="kte-summary__go"
          data-testid="summary-proceed"
          [disabled]="items.length === 0 || busy"
          (click)="proceed.emit()"
        >
          Tovább a kosárhoz
        </button>
      </footer>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-summary {
        display: flex;
        flex-direction: column;
        background: var(--kte-surface);
        border: 1px solid var(--border);
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-sm);
        overflow: hidden;
      }

      .kte-summary__toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 48px;
        padding: 0 16px;
        font: inherit;
        color: var(--kte-brand-deep);
        background: transparent;
        border: 0;
        border-bottom: 1px solid var(--border-light);
        cursor: default;
        text-align: left;
      }
      .kte-summary__title {
        font-family: var(--kte-font-display);
        font-size: 18px;
        font-weight: 700;
      }
      .kte-summary__count {
        font-weight: 700;
        color: var(--ink);
      }

      .kte-summary__body {
        max-height: 50vh;
        overflow-y: auto;
        padding: 4px 16px;
      }
      .kte-summary__empty {
        margin: 12px 0;
        color: var(--kte-muted);
        font-size: 14px;
      }
      .kte-summary__list {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .kte-summary__item {
        display: grid;
        grid-template-columns: 1fr auto 44px;
        align-items: center;
        gap: 8px;
        min-height: 52px;
        border-bottom: 1px solid var(--border-light);
      }
      .kte-summary__item:last-child {
        border-bottom: 0;
      }
      .kte-summary__seat {
        display: flex;
        flex-direction: column;
        font-size: 13px;
        color: var(--kte-muted);
      }
      .kte-summary__seat strong {
        color: var(--ink);
        font-size: 14px;
      }
      .kte-summary__price {
        font-weight: 600;
        white-space: nowrap;
      }
      .kte-summary__remove {
        width: 44px;
        height: 44px;
        font-size: 22px;
        line-height: 1;
        color: var(--ink);
        background: transparent;
        border: 0;
        border-radius: 50%;
        cursor: pointer;
      }
      .kte-summary__remove:focus-visible,
      .kte-summary__go:focus-visible,
      .kte-summary__toggle:focus-visible {
        outline: 2px solid var(--brand-mid);
        outline-offset: -2px;
      }

      .kte-summary__footer {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 12px 16px 16px;
        border-top: 1px solid var(--border-light);
        background: var(--kte-surface);
      }
      .kte-summary__total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .kte-summary__total strong {
        font-size: 20px;
      }
      .kte-summary__go {
        min-height: 48px;
        font: inherit;
        font-weight: 700;
        color: #ffffff;
        background: var(--brand-deep);
        border: 0;
        border-radius: var(--kte-radius);
        cursor: pointer;
      }
      .kte-summary__go:disabled {
        background: var(--seat-disabled);
        color: var(--ink);
        cursor: not-allowed;
      }

      /* Wide screens: a card beside the grid that sticks while the page scrolls. */
      @media (min-width: 900px) {
        :host {
          position: sticky;
          top: 88px;
          align-self: start;
        }
      }

      /* Phones: a bar glued to the bottom edge; the list opens upwards on demand. */
      @media (max-width: 899px) {
        :host {
          position: sticky;
          bottom: 0;
          z-index: 20;
        }
        .kte-summary {
          border-radius: var(--kte-radius-lg) var(--kte-radius-lg) 0 0;
          box-shadow: 0 -4px 16px rgba(20, 18, 26, 0.18);
        }
        .kte-summary__toggle {
          cursor: pointer;
          min-height: 44px;
        }
        .kte-summary__body {
          display: none;
        }
        .kte-summary--open .kte-summary__body {
          display: block;
        }
        .kte-summary__footer {
          flex-direction: row;
          align-items: center;
          padding: 8px 16px 12px;
        }
        .kte-summary__total {
          flex: 1;
          flex-direction: column;
          align-items: flex-start;
        }
        .kte-summary__go {
          flex: 1.4;
        }
      }
    `,
  ],
})
export class SeatSummaryComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);

  constructor() {
    // On a phone this bar is glued to the bottom edge, exactly where the chat bubble floats.
    // While it is stuck there it publishes how much of the viewport it takes (`--dock-inset`)
    // and the bubble rides above it. Once the page has scrolled to where the bar rests in the
    // flow (above the footer) it takes nothing and the bubble drops back into the footer's room.
    afterNextRender(() => {
      const view = this.document.defaultView;
      if (!view || typeof ResizeObserver === 'undefined') {
        return;
      }
      const root = this.document.documentElement;
      const el = this.host.nativeElement;
      const phone = view.matchMedia('(max-width: 899px)');
      let frame = 0;
      const publish = (): void => {
        frame = 0;
        const rect = el.getBoundingClientRect();
        const viewportBottom = view.visualViewport?.height ?? view.innerHeight;
        const stuck = phone.matches && rect.height > 0 && rect.bottom >= viewportBottom - 2;
        root.style.setProperty(
          '--dock-inset',
          stuck ? `${Math.max(0, Math.round(viewportBottom - rect.top))}px` : '0px',
        );
      };
      const schedule = (): void => {
        if (!frame) {
          frame = view.requestAnimationFrame(publish);
        }
      };
      const resize = new ResizeObserver(schedule);
      resize.observe(el);
      view.addEventListener('resize', schedule);
      // The scroller is the shell's content pane, not the window: listen in the capture phase.
      this.document.addEventListener('scroll', schedule, { capture: true, passive: true });
      phone.addEventListener('change', schedule);
      schedule();
      this.destroyRef.onDestroy(() => {
        resize.disconnect();
        view.removeEventListener('resize', schedule);
        this.document.removeEventListener('scroll', schedule, { capture: true });
        phone.removeEventListener('change', schedule);
        if (frame) {
          view.cancelAnimationFrame(frame);
        }
        root.style.removeProperty('--dock-inset');
      });
    });
  }

  private readonly destroyRef = inject(DestroyRef);
  protected readonly max = MAX_CART_ITEMS;
  protected readonly open = signal(false);
  private readonly list = signal<readonly CartItem[]>([]);

  @Input() set items(value: readonly CartItem[]) {
    this.list.set(value ?? []);
  }
  get items(): readonly CartItem[] {
    return this.list();
  }
  /** A lock or release is in flight: do not let the visitor leave yet. */
  @Input() busy = false;
  @Output() remove = new EventEmitter<string>();
  @Output() proceed = new EventEmitter<void>();

  protected readonly total = computed(() => this.list().reduce((sum, i) => sum + i.price, 0));

  protected name(item: CartItem): string {
    return sectorName(item.section, item.sectorName ?? null);
  }
}
