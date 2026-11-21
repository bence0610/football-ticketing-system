import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../../core/auth/auth.service';
import { CartFacade } from '../../../../core/cart/cart.facade';
import { SIGN_IN_TO_LOCK_MESSAGE, lockErrorMessage } from '../../../../shared/utils/lock-error';
import { MAX_CART_ITEMS } from '../../../../shared/models/cart.model';
import { BestSeatsRefusal, BestSeatsResponse, SeatStatus } from '../../../../shared/models/seat.model';
import { SeatsApiService } from '../../../../shared/services/seats.api.service';

/** The part of a match the finder needs; a `MatchListItem` satisfies it. */
export interface BestSeatsMatch {
  readonly id: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly kickoffAt: string;
}

/** What the panel tells the page when seats were locked for the visitor. */
export interface BestSeatsPlaced {
  readonly seats: readonly SeatStatus[];
  readonly response: BestSeatsResponse;
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'placed'; response: BestSeatsResponse }
  | { kind: 'refused'; refusal: BestSeatsRefusal; count: number }
  | { kind: 'error'; message: string };

/**
 * "Best free seats": the visitor says how many they are, the server finds the best
 * run of adjacent free seats in this sector and locks it in one operation.
 *
 * "Best" is the server's rule (see api: best-seats.ts): closest to the pitch's
 * halfway line and to the front, adjacent, never across an aisle. When no run is
 * long enough the panel says so, names the longest run there is, and, if two shorter
 * runs would do, offers them as a button; it never pretends.
 */
@Component({
  selector: 'kte-best-seats-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="kte-finder" aria-labelledby="kte-finder-title" data-testid="best-seats-panel">
      <h3 id="kte-finder-title" class="kte-finder__title">Legjobb helyek automatikusan</h3>
      <p class="kte-finder__run" data-testid="finder-longest-run">
        @if (longestRun > 0) {
          Leghosszabb szabad sor ebben a szektorban: <strong>{{ longestRun }} hely</strong> egymás mellett.
        } @else {
          Ebben a szektorban nincs szabad hely.
        }
      </p>

      <div class="kte-finder__row">
        <span id="kte-finder-count-label" class="kte-finder__label">Hányan vagytok?</span>
        <div class="kte-finder__stepper" role="group" aria-labelledby="kte-finder-count-label">
          <button type="button" aria-label="Eggyel kevesebb" [disabled]="count() <= 1 || working()" (click)="step(-1)">−</button>
          <output data-testid="finder-count" aria-live="polite">{{ count() }}</output>
          <button type="button" aria-label="Eggyel több" [disabled]="count() >= limit() || working()" (click)="step(1)">+</button>
        </div>
      </div>

      <button
        type="button"
        class="kte-finder__go"
        data-testid="finder-go"
        [disabled]="disabled || working() || longestRun === 0 || limit() < 1"
        (click)="find(false)"
      >
        {{ working() ? 'Keresés…' : 'Keresd meg a legjobb helyeket' }}
      </button>

      <div class="kte-finder__result" role="status" aria-live="polite" data-testid="finder-result">
        @switch (outcome().kind) {
          @case ('placed') {
            <p class="kte-finder__ok">{{ placedText() }}</p>
          }
          @case ('refused') {
            <p class="kte-finder__refusal" data-testid="finder-refusal">{{ refusalText() }}</p>
            @if (offer(); as o) {
              <p data-testid="finder-offer">Ehelyett két külön helyen tudunk helyet adni a társaságnak:</p>
              <button type="button" class="kte-finder__alt" data-testid="finder-accept-split" [disabled]="working()" (click)="find(true)">
                {{ o }} – elfogadom
              </button>
            }
          }
          @case ('error') {
            <p class="kte-finder__refusal">{{ errorText() }}</p>
          }
        }
        @if (limit() < 1) {
          <p class="kte-finder__note">A kosár tele van ({{ max }} hely). Vegyél ki egy helyet, hogy újat kérhess.</p>
        } @else if (count() >= limit() && limit() < max) {
          <p class="kte-finder__note">A kosárban már {{ max - limit() }} hely van, még {{ limit() }} fér mellé.</p>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .kte-finder {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px 20px;
        background: var(--kte-surface);
        border: 1px solid var(--border);
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-sm);
      }
      .kte-finder__title {
        margin: 0;
        font-family: var(--kte-font-display);
        font-size: 18px;
        color: var(--kte-brand-deep);
      }
      .kte-finder__run,
      .kte-finder__note {
        margin: 0;
        font-size: 14px;
        color: var(--kte-muted);
      }
      .kte-finder__run strong {
        color: var(--ink);
      }
      .kte-finder__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .kte-finder__label {
        font-weight: 600;
      }
      .kte-finder__stepper {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .kte-finder__stepper button {
        width: 48px;
        height: 48px;
        font-size: 24px;
        line-height: 1;
        color: var(--ink);
        background: var(--kte-surface);
        border: 1px solid var(--border);
        border-radius: var(--kte-radius);
        cursor: pointer;
      }
      .kte-finder__stepper output {
        min-width: 40px;
        text-align: center;
        font-size: 22px;
        font-weight: 700;
      }
      .kte-finder button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .kte-finder button:focus-visible {
        outline: 2px solid var(--brand-mid);
        outline-offset: 2px;
      }
      .kte-finder__go,
      .kte-finder__alt {
        min-height: 48px;
        padding: 0 16px;
        font: inherit;
        font-weight: 700;
        border-radius: var(--kte-radius);
        cursor: pointer;
      }
      .kte-finder__go {
        color: #ffffff;
        background: var(--brand-deep);
        border: 0;
      }
      .kte-finder__alt {
        color: var(--brand-deep);
        background: var(--brand-tint);
        border: 1px solid var(--brand-deep);
      }
      .kte-finder__result {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .kte-finder__result p {
        margin: 0;
        font-size: 14px;
      }
      .kte-finder__ok {
        padding: 10px 12px;
        background: var(--chip-paid-bg);
        color: var(--chip-paid);
        border-radius: var(--kte-radius);
        font-weight: 600;
      }
      .kte-finder__refusal {
        padding: 10px 12px;
        background: var(--chip-pending-bg);
        color: var(--ink);
        border-left: 4px solid var(--chip-pending);
        border-radius: var(--kte-radius);
      }
    `,
  ],
})
export class BestSeatsPanelComponent {
  private readonly api = inject(SeatsApiService);
  private readonly cart = inject(CartFacade);
  private readonly auth = inject(AuthService);

  protected readonly max = MAX_CART_ITEMS;
  @Input({ required: true }) section!: string;
  @Input() sectorName: string | null = null;
  /** From the sector summary: the longest free run now. */
  @Input() longestRun = 0;
  @Input({ required: true }) match!: BestSeatsMatch;
  /** The match has kicked off (or nothing can be bought): the panel is inert. */
  @Input() disabled = false;
  @Output() placed = new EventEmitter<BestSeatsPlaced>();

  protected readonly count = signal(2);
  protected readonly working = signal(false);
  protected readonly outcome = signal<Outcome>({ kind: 'idle' });

  /** How many more seats the cart can take. */
  protected limit(): number {
    return Math.max(0, MAX_CART_ITEMS - this.cart.items().length);
  }

  protected step(delta: number): void {
    this.count.set(Math.min(Math.max(1, this.count() + delta), Math.max(1, this.limit())));
    this.outcome.set({ kind: 'idle' });
  }

  protected async find(allowSplit: boolean): Promise<void> {
    if (this.working()) return;
    const count = Math.min(this.count(), this.limit());
    if (count < 1) return;
    if (!this.auth.isAuthenticated()) {
      this.outcome.set({ kind: 'error', message: SIGN_IN_TO_LOCK_MESSAGE });
      return;
    }
    this.working.set(true);
    try {
      const response = await firstValueFrom(
        this.api.findBestSeats(this.match.id, { section: this.section, count, allowSplit }),
      );
      const seats = response.runs.flatMap((r) => r.seats);
      this.cart.addLocked(
        seats,
        { ownerToken: response.ownerToken, ttlSeconds: response.ttlSeconds },
        { ...this.match, matchId: this.match.id, sectorName: this.sectorName ?? undefined },
      );
      this.outcome.set({ kind: 'placed', response });
      this.placed.emit({ seats, response });
    } catch (error) {
      this.outcome.set(this.explain(error, count));
    } finally {
      this.working.set(false);
    }
  }

  private explain(error: unknown, count: number): Outcome {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      return { kind: 'error', message: SIGN_IN_TO_LOCK_MESSAGE };
    }
    if (
      error instanceof HttpErrorResponse &&
      (error.status === 429 ||
        (error.status === 409 &&
          ['seat_limit_reached', 'hold_limit_reached'].includes(error.error?.code)))
    ) {
      // The server's own words: too many seats held, or too many requests.
      return { kind: 'error', message: lockErrorMessage(error) };
    }
    if (error instanceof HttpErrorResponse && error.status === 409 && error.error?.code) {
      return { kind: 'refused', refusal: error.error as BestSeatsRefusal, count };
    }
    if (error instanceof HttpErrorResponse && error.status === 403) {
      return { kind: 'error', message: 'A vendégszektor helyei a portálon nem vásárolhatók meg.' };
    }
    if (error instanceof Error && !(error instanceof HttpErrorResponse)) {
      return { kind: 'error', message: error.message };
    }
    return { kind: 'error', message: 'A keresés most nem sikerült. Próbáld újra egy pillanat múlva.' };
  }

  // ---- wording -----------------------------------------------------------------------

  protected placedText(): string {
    const o = this.outcome();
    if (o.kind !== 'placed') return '';
    const parts = o.response.runs.map((r) => {
      const first = r.seats[0].number;
      const last = r.seats[r.seats.length - 1].number;
      return first === last ? `${r.row}. sor ${first}. szék` : `${r.row}. sor ${first}–${last}. szék`;
    });
    const total = o.response.runs.reduce((n, r) => n + r.seats.length, 0);
    const where = o.response.kind === 'split' ? `két külön helyen: ${parts.join(' és ')}` : `egymás mellett: ${parts[0]}`;
    return `Lefoglaltunk ${total} helyet ${where}. A kosárba tettük, a foglalás pár percig érvényes.`;
  }

  protected refusalText(): string {
    const o = this.outcome();
    if (o.kind !== 'refused') return '';
    const r = o.refusal;
    switch (r.code) {
      case 'no_adjacent_run':
        return `Nincs ${o.count} egymás melletti szabad hely ebben a szektorban; a leghosszabb szabad sor ${r.longestRun ?? 0} hely.${
          r.alternative ? '' : ' Két külön sorba sem tudjuk elosztani a társaságot: próbálj kevesebb főt, vagy válassz másik szektort.'
        }`;
      case 'not_enough_seats':
        return `Ebben a szektorban már csak ${r.freeSeats ?? 0} szabad hely van, ${o.count} főnek nem elég. Válassz másik szektort.`;
      case 'contended':
        return 'A szektor helyeit épp most foglalták le mások. Próbáld újra egy pillanat múlva.';
      default:
        return r.message;
    }
  }

  /** "3. sor 5–6. szék és 7. sor 2–3. szék", when the server can split the party. */
  protected offer(): string | null {
    const o = this.outcome();
    if (o.kind !== 'refused' || !o.refusal.alternative) return null;
    return o.refusal.alternative.runs
      .map((r) => (r.length === 1 ? `${r.row}. sor ${r.firstNumber}. szék` : `${r.row}. sor ${r.firstNumber}–${r.lastNumber}. szék`))
      .join(' és ');
  }

  protected errorText(): string {
    const o = this.outcome();
    return o.kind === 'error' ? o.message : '';
  }
}
