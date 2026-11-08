import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DatePipe, NgClass, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatchListItem } from '../../../../shared/models/match.model';
import { HufCurrencyPipe } from '../../../../shared/pipes/huf-currency.pipe';
import { availabilityOf } from '../../logic/match-availability';
import { competitionLabel } from '../../logic/competition-label';

@Component({
  selector: 'kte-match-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIf, NgClass, DatePipe, RouterLink, MatButtonModule, HufCurrencyPipe],
  template: `
    <article class="card" [class.card--sold-out]="soldOut" *ngIf="match">
      <div class="card__bar" aria-hidden="true"></div>
      <div class="card__body">
        <div class="card__top">
          <p class="card__eyebrow">{{ competition }}</p>
          <span class="status-chip" [ngClass]="'status-chip--' + availability.chipClass">
            {{ availability.label }}
          </span>
        </div>

        <h3 class="card__fixture">{{ match.homeTeam }} – {{ match.awayTeam }}</h3>

        <p class="card__meta">
          {{ match.kickoffAt | date: "yyyy. MMMM d., EEEE · HH:mm":'':'hu-HU' }}<br />
          {{ match.venue }}
        </p>

        <div class="card__footer">
          <div class="card__price" *ngIf="!soldOut; else gone">
            <span class="card__price-label">Jegyek ettől</span>
            <strong>{{ (lowestPrice ?? match.basePrice) | hufCurrency }}</strong>
          </div>
          <ng-template #gone>
            <div class="card__price"><strong>Elfogyott</strong></div>
          </ng-template>

          <a
            *ngIf="!soldOut; else waitlist"
            mat-flat-button
            color="primary"
            routerLink="/stadium"
            [queryParams]="{ matchId: match.id }"
            [attr.aria-label]="'Jegyek: ' + match.homeTeam + ' – ' + match.awayTeam"
          >
            Jegyek
          </a>
          <ng-template #waitlist>
            <a
              mat-stroked-button
              color="primary"
              routerLink="/stadium"
              [queryParams]="{ matchId: match.id }"
              [attr.aria-label]="'Várólista: ' + match.homeTeam + ' – ' + match.awayTeam"
            >
              Várólista
            </a>
          </ng-template>
        </div>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .card {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        overflow: hidden;
      }

      .card__bar {
        height: 6px;
        background: var(--brand-mid);
      }

      .card--sold-out .card__bar {
        background: var(--faint);
      }

      .card__body {
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        padding: 20px 24px 24px;
        gap: 12px;
      }

      .card__top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .card__eyebrow {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--brand-mid);
      }

      .card--sold-out .card__eyebrow {
        color: var(--muted);
      }

      .card__fixture {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 21px;
        line-height: 1.25;
        letter-spacing: -0.01em;
        overflow-wrap: anywhere;
      }

      .card__meta {
        margin: 0;
        font-size: 15px;
        line-height: 1.55;
        color: var(--muted);
      }

      .card__footer {
        margin-top: auto;
        padding-top: 16px;
        border-top: 1px solid var(--border-light);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .card__price {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .card__price-label {
        font-size: 12px;
        color: var(--muted);
      }

      .card__price strong {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 20px;
      }

      .card--sold-out .card__price strong {
        color: var(--muted);
      }
    `,
  ],
})
export class MatchCardComponent {
  @Input({ required: true }) match!: MatchListItem;
  /** Lowest seat price from the sector summary; falls back to the match base price. */
  @Input() lowestPrice: number | null = null;

  protected get availability() {
    return availabilityOf(this.match);
  }

  protected get soldOut(): boolean {
    return this.availability.kind === 'sold_out';
  }

  protected get competition(): string {
    return competitionLabel(this.match.competition);
  }
}
