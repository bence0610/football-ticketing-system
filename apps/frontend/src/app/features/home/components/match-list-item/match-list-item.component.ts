import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { DatePipe, NgClass, NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatchListItem } from '../../../../shared/models/match.model';
import { HufCurrencyPipe } from '../../../../shared/pipes/huf-currency.pipe';

@Component({
  selector: 'kte-match-list-item',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgIf,
    NgClass,
    DatePipe,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    HufCurrencyPipe,
  ],
  template: `
    <mat-card class="kte-match-card" *ngIf="match">
      <header class="kte-match-card__top">
        <span class="kte-match-card__competition">{{ competitionLabel(match.competition) }}</span>
        <span
          class="kte-match-card__badge"
          [ngClass]="{
            'kte-match-card__badge--home': match.isHome,
            'kte-match-card__badge--away': !match.isHome
          }"
        >
          {{ match.isHome ? 'Hazai' : 'Idegenbeli' }}
        </span>
      </header>

      <div class="kte-match-card__teams">
        <span class="kte-match-card__team kte-match-card__team--home">{{ match.homeTeam }}</span>
        <span class="kte-match-card__separator">vs</span>
        <span class="kte-match-card__team kte-match-card__team--away">{{ match.awayTeam }}</span>
      </div>

      <dl class="kte-match-card__meta">
        <div>
          <dt><mat-icon inline>schedule</mat-icon></dt>
          <dd>{{ match.kickoffAt | date: "yyyy. MMM d. HH:mm":'':'hu-HU' }}</dd>
        </div>
        <div>
          <dt><mat-icon inline>place</mat-icon></dt>
          <dd>{{ match.venue }}</dd>
        </div>
        <div>
          <dt><mat-icon inline>event_seat</mat-icon></dt>
          <dd>{{ match.availableSeats }} szabad / {{ match.capacity }}</dd>
        </div>
        <div>
          <dt><mat-icon inline>payments</mat-icon></dt>
          <dd>{{ match.basePrice | hufCurrency }} alapár</dd>
        </div>
      </dl>

      <footer class="kte-match-card__footer">
        <span class="kte-match-card__status" [ngClass]="statusClass(match.status)">
          {{ statusLabel(match.status) }}
        </span>
        <a
          mat-flat-button
          color="primary"
          [routerLink]="['/stadium']"
          [queryParams]="{ matchId: match.id }"
          [disabled]="!isPurchasable(match.status)"
        >
          <mat-icon>shopping_cart</mat-icon>
          Jegyvásárlás
        </a>
      </footer>
    </mat-card>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-match-card {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 24px;
        border-radius: var(--kte-radius-lg);
        background: var(--kte-surface);
        box-shadow: var(--kte-shadow-sm);
        height: 100%;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .kte-match-card:hover {
        transform: translateY(-3px);
        box-shadow: var(--kte-shadow-md);
      }

      .kte-match-card__top {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .kte-match-card__competition {
        font-size: 11px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        font-weight: 700;
        color: var(--kte-brand-deep);
        background: var(--kte-brand-tint);
        padding: 4px 10px;
        border-radius: var(--kte-radius-pill);
      }

      .kte-match-card__badge {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        font-weight: 700;
        padding: 4px 10px;
        border-radius: var(--kte-radius-pill);
      }

      .kte-match-card__badge--home {
        background: var(--kte-brand-mid);
        color: var(--kte-surface);
      }

      .kte-match-card__badge--away {
        background: var(--kte-brand-deep);
        color: var(--kte-surface);
      }

      .kte-match-card__teams {
        display: flex;
        align-items: baseline;
        gap: 12px;
        flex-wrap: wrap;
      }

      .kte-match-card__team {
        font-family: var(--kte-font-display);
        font-size: 22px;
        font-weight: 700;
        line-height: 1.1;
      }

      .kte-match-card__team--home {
        color: var(--kte-brand-deep);
      }

      .kte-match-card__separator {
        color: var(--kte-faint);
        font-weight: 600;
        font-size: 14px;
      }

      .kte-match-card__meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 16px;
        margin: 0;
      }

      .kte-match-card__meta > div {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--kte-muted);
      }

      .kte-match-card__meta dt {
        margin: 0;
        display: inline-flex;
        align-items: center;
        color: var(--kte-brand-deep);
      }

      .kte-match-card__meta dd {
        margin: 0;
      }

      .kte-match-card__meta mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }

      .kte-match-card__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: auto;
        padding-top: 8px;
        border-top: 1px dashed var(--kte-border);
      }

      .kte-match-card__status {
        font-size: 12px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 6px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .kte-match-card__status--on_sale {
        background: var(--kte-success-bg);
        color: var(--kte-success);
      }

      .kte-match-card__status--scheduled {
        background: var(--kte-brand-tint);
        color: var(--kte-brand-deep);
      }

      .kte-match-card__status--sold_out {
        background: var(--kte-danger-bg);
        color: var(--kte-danger);
      }

      .kte-match-card__status--postponed,
      .kte-match-card__status--cancelled,
      .kte-match-card__status--finished {
        background: var(--kte-line);
        color: var(--kte-muted);
      }
    `,
  ],
})
export class MatchListItemComponent {
  @Input({ required: true }) match!: MatchListItem;

  protected isPurchasable(status: MatchListItem['status']): boolean {
    return status === 'on_sale';
  }

  protected statusClass(status: MatchListItem['status']): string {
    return `kte-match-card__status--${status}`;
  }

  protected statusLabel(status: MatchListItem['status']): string {
    switch (status) {
      case 'on_sale':
        return 'Kapható';
      case 'scheduled':
        return 'Hamarosan';
      case 'sold_out':
        return 'Elkelt';
      case 'postponed':
        return 'Halasztva';
      case 'cancelled':
        return 'Törölve';
      case 'finished':
        return 'Lejátszott';
      default:
        return status;
    }
  }

  protected competitionLabel(competition: MatchListItem['competition']): string {
    switch (competition) {
      case 'NB1':
        return 'NB I';
      case 'NB2':
        return 'NB II';
      case 'magyar_kupa':
        return 'Magyar Kupa';
      case 'friendly':
        return 'Felkészülési';
      default:
        return competition;
    }
  }
}
