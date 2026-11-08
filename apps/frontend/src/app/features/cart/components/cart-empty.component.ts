import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DatePipe, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatchListItem } from '../../../shared/models/match.model';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';

export interface SectorHighlight {
  readonly name: string;
  readonly free: number;
  readonly fromPrice: number;
}

/**
 * Empty cart: instead of a bare message, show what is worth buying - the next
 * home match and how many seats are free in a named sector (both from the
 * API) - and a way to pick seats.
 */
@Component({
  selector: 'kte-cart-empty',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, DatePipe, RouterLink, MatButtonModule, HufCurrencyPipe],
  template: `
    <section class="empty" data-testid="cart-empty" aria-labelledby="cart-empty-title">
      <h2 id="cart-empty-title">A kosarad üres</h2>

      <ng-container *ngIf="match; else generic">
        <p class="empty__eyebrow">Következő hazai mérkőzés</p>
        <p class="empty__fixture">{{ match.homeTeam }} – {{ match.awayTeam }}</p>
        <p class="empty__when">
          {{ match.kickoffAt | date: "yyyy. MMMM d., EEEE · HH:mm" : '' : 'hu-HU' }} · {{ match.venue }}
        </p>
        <p class="empty__sector" *ngIf="sector" data-testid="cart-empty-sector">
          {{ sector.name }}: <strong>{{ sector.free }} szabad hely</strong> · {{ sector.fromPrice | hufCurrency }}-tól
        </p>
        <a mat-flat-button color="primary" class="empty__cta" routerLink="/stadium" [queryParams]="{ matchId: match.id }">
          Helyet választok
        </a>
      </ng-container>

      <ng-template #generic>
        <p class="empty__when">
          {{ loading ? 'Mérkőzések betöltése…' : 'Jelenleg nincs meghirdetett hazai mérkőzés – nézz vissza hamarosan.' }}
        </p>
        <a mat-flat-button color="primary" class="empty__cta" routerLink="/stadium">Helyet választok</a>
      </ng-template>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .empty {
        padding: 32px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }

      h2 {
        margin: 0 0 16px;
      }

      .empty__eyebrow {
        margin: 0 0 4px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--brand-mid);
      }

      .empty__fixture {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 21px;
        line-height: 1.3;
      }

      .empty__when {
        margin: 4px 0 0;
        color: var(--muted);
        font-size: 15px;
      }

      .empty__sector {
        margin: 16px 0 0;
        padding: 12px 16px;
        background: var(--brand-tint);
        border-radius: var(--radius-block);
        color: var(--brand-deep);
        font-size: 15px;
      }

      .empty__cta {
        margin-top: 24px;
      }

      @media (max-width: 599px) {
        .empty {
          padding: 20px 16px;
        }
        .empty__cta {
          width: 100%;
        }
      }
    `,
  ],
})
export class CartEmptyComponent {
  @Input() match: MatchListItem | null = null;
  @Input() sector: SectorHighlight | null = null;
  @Input() loading = false;
}
