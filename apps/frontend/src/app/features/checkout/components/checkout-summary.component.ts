import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CartItem } from '../../../shared/models/cart.model';
import {
  TierDiscount,
  TierDiscountRowComponent,
} from '../../../shared/components/tier-discount-row/tier-discount-row.component';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';
import { seatDescription } from '../../cart/logic/cart-logic';

/**
 * Sticky order summary: the fixture and kickoff, one line per seat, subtotal,
 * the loyalty discount row, the amount to pay, the pay button and two short
 * notes (when the ticket is issued, and the points earned).
 */
@Component({
  selector: 'kte-checkout-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgIf,
    NgFor,
    DatePipe,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    HufCurrencyPipe,
    TierDiscountRowComponent,
  ],
  template: `
    <aside class="summary kte-checkout__summary" aria-label="Összesítő">
      <header class="summary__match" *ngIf="items.length > 0">
        <h2 class="summary__fixture">{{ items[0].homeTeam }} – {{ items[0].awayTeam }}</h2>
        <p class="summary__when">
          {{ items[0].kickoffAt | date: "yyyy. MMMM d., EEEE · HH:mm" : '' : 'hu-HU' }}
          <ng-container *ngIf="venue"> · {{ venue }}</ng-container>
        </p>
      </header>

      <ul class="summary__lines">
        <li *ngFor="let item of items" class="summary__line" data-testid="summary-seat">
          <span>{{ describe(item) }}</span>
          <span class="summary__price">{{ item.price | hufCurrency }}</span>
        </li>
      </ul>

      <div class="summary__row">
        <span>Részösszeg</span>
        <span data-testid="summary-subtotal">{{ subtotal | hufCurrency }}</span>
      </div>

      <kte-tier-discount-row *ngIf="discount as d" [discount]="d"></kte-tier-discount-row>

      <div class="summary__total">
        <span>Fizetendő</span>
        <strong data-testid="summary-total">{{ total | hufCurrency }}</strong>
      </div>

      <button
        mat-flat-button
        color="primary"
        type="button"
        class="summary__pay"
        [disabled]="!canPay || processing"
        (click)="pay.emit()"
      >
        <ng-container *ngIf="processing; else label">
          <mat-spinner diameter="20"></mat-spinner>
          Feldolgozás…
        </ng-container>
        <ng-template #label>Fizetés<ng-container *ngIf="total !== null"> · {{ total | hufCurrency }}</ng-container></ng-template>
      </button>

      <p class="summary__note" data-testid="issue-note">
        A jegy akkor készül el, amikor a Stripe megerősíti a fizetést, nem amikor a böngésző
        visszatér.
      </p>

      <p class="summary__points" *ngIf="points !== null && points > 0" data-testid="summary-points">
        <mat-icon inline aria-hidden="true">check_circle</mat-icon>
        <span>Ezzel a vásárlással <strong>{{ points }} hűségpontot</strong> gyűjtesz.</span>
      </p>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .summary {
        position: sticky;
        top: calc(var(--header-h) + 16px);
        padding: 24px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .summary__match {
        padding-bottom: 14px;
        border-bottom: 1px solid var(--border-light);
      }

      .summary__fixture {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 18px;
        line-height: 1.3;
        letter-spacing: -0.01em;
        color: var(--brand-deep);
        overflow-wrap: anywhere;
      }

      .summary__when {
        margin: 4px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--muted);
      }

      .summary__lines {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .summary__line,
      .summary__row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 15px;
      }

      .summary__row {
        color: var(--muted);
        padding-top: 4px;
      }

      .summary__price {
        font-family: var(--font-display);
        font-weight: 700;
        white-space: nowrap;
      }

      .summary__total {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
        padding-top: 14px;
        border-top: 1px solid var(--border-light);
        font-size: 16px;
        font-weight: 600;
      }

      .summary__total strong {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 28px;
        line-height: 1.1;
      }

      .summary__pay.mat-mdc-button-base {
        --mdc-filled-button-container-height: 54px;
        height: 54px;
        min-height: 54px;
        width: 100%;
        font-size: 16px;
      }

      .summary__note {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--muted);
      }

      .summary__points {
        margin: 0;
        display: flex;
        gap: 8px;
        align-items: flex-start;
        font-size: 14px;
        line-height: 1.5;
        color: var(--chip-paid);
      }

      .summary__points mat-icon {
        flex: 0 0 auto;
        margin-top: 3px;
      }

      @media (max-width: 899px) {
        .summary {
          position: static;
          padding: 20px 16px;
        }
      }
    `,
  ],
})
export class CheckoutSummaryComponent {
  @Input() items: readonly CartItem[] = [];
  /** From GET /matches/:id; shown once loaded. */
  @Input() venue: string | null = null;
  @Input() subtotal: number | null = null;
  @Input() discount: TierDiscount | null = null;
  @Input() total: number | null = null;
  /** Loyalty points this purchase earns; null when unknown. */
  @Input() points: number | null = null;
  @Input() processing = false;
  /** False while the payment cannot start (element loading, a hold expired, ...). */
  @Input() canPay = false;
  @Output() readonly pay = new EventEmitter<void>();

  protected describe(item: CartItem): string {
    return seatDescription(item);
  }
}
