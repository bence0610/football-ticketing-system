import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { MatchListItem } from '../../../../shared/models/match.model';
import { MatchCardComponent } from '../match-card/match-card.component';

@Component({
  selector: 'kte-upcoming-matches',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgFor, NgIf, MatchCardComponent],
  template: `
    <section class="upcoming" aria-labelledby="upcoming-title">
      <div class="upcoming__inner">
        <h2 id="upcoming-title">Közelgő mérkőzések</h2>

        <p class="upcoming__note" *ngIf="loading && matches.length === 0">Meccsek betöltése…</p>
        <p class="error-block" *ngIf="!loading && error" role="alert">{{ error }}</p>
        <p class="upcoming__note" *ngIf="!loading && !error && matches.length === 0">
          Jelenleg nincs meghirdetett hazai mérkőzés.
        </p>

        <div class="upcoming__grid" *ngIf="matches.length > 0">
          <kte-match-card
            *ngFor="let m of matches; trackBy: trackById"
            [match]="m"
            [lowestPrice]="lowestPrices[m.id] ?? null"
          ></kte-match-card>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .upcoming {
        background: var(--page);
      }

      .upcoming__inner {
        max-width: 1180px;
        margin: 0 auto;
        padding: 56px 32px;
      }

      h2 {
        margin: 0 0 24px;
      }

      .upcoming__note {
        margin: 0;
        color: var(--muted);
      }

      .upcoming__grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
        gap: 24px;
      }

      @media (min-width: 1000px) {
        .upcoming__grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 599px) {
        .upcoming__inner {
          padding: 40px 16px;
        }
        .upcoming__grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
    `,
  ],
})
export class UpcomingMatchesComponent {
  @Input() matches: readonly MatchListItem[] = [];
  /** matchId -> lowest seat price (from the sector summary). */
  @Input() lowestPrices: Readonly<Record<string, number | null>> = {};
  @Input() loading = false;
  @Input() error: string | null = null;

  protected trackById(_: number, m: MatchListItem): string {
    return m.id;
  }
}
