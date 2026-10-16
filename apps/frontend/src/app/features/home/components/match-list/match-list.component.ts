import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatchListItem } from '../../../../shared/models/match.model';
import { MatchListItemComponent } from '../match-list-item/match-list-item.component';

@Component({
  selector: 'kte-match-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgFor, NgIf, MatProgressSpinnerModule, MatchListItemComponent],
  template: `
    <section class="kte-match-list" aria-labelledby="kte-match-list-title">
      <header class="kte-match-list__header">
        <h2 id="kte-match-list-title">Aktuális mérkőzések</h2>
        <p>Foglald le a helyed a legközelebbi NB1-es összecsapásokra.</p>
      </header>

      <div class="kte-match-list__loading" *ngIf="loading">
        <mat-progress-spinner diameter="36" mode="indeterminate"></mat-progress-spinner>
        <span>Meccsek betöltése…</span>
      </div>

      <div class="kte-match-list__error" *ngIf="!loading && error">
        <p>{{ error }}</p>
      </div>

      <div class="kte-match-list__empty" *ngIf="!loading && !error && matches.length === 0">
        <p>Jelenleg nincs meghirdetett mérkőzés.</p>
      </div>

      <div class="kte-match-list__grid" *ngIf="!loading && matches.length > 0">
        <kte-match-list-item *ngFor="let match of matches" [match]="match"></kte-match-list-item>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-match-list {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .kte-match-list__header h2 {
        margin: 0;
        font-family: var(--kte-font-display);
        font-size: 28px;
        font-weight: 700;
        color: var(--kte-brand-deep);
        letter-spacing: -0.01em;
      }

      .kte-match-list__header p {
        margin: 4px 0 0;
        color: var(--kte-muted);
      }

      .kte-match-list__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 20px;
      }

      .kte-match-list__loading {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--kte-muted);
      }

      .kte-match-list__error {
        padding: 16px;
        border-radius: var(--kte-radius);
        background: var(--kte-danger-bg);
        color: var(--kte-danger);
      }

      .kte-match-list__empty {
        padding: 24px;
        border-radius: var(--kte-radius);
        background: var(--kte-surface);
        color: var(--kte-muted);
        text-align: center;
        border: 1px dashed var(--kte-border);
      }
    `,
  ],
})
export class MatchListComponent {
  @Input() matches: readonly MatchListItem[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
}
