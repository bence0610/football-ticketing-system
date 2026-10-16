import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatchListItem } from '../../../../shared/models/match.model';

@Component({
  selector: 'kte-match-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgFor,
    NgIf,
    DatePipe,
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
  ],
  template: `
    <mat-form-field appearance="outline" class="kte-match-selector">
      <mat-label>
        <mat-icon class="kte-match-selector__icon">stadium</mat-icon>
        Mérkőzés kiválasztása
      </mat-label>
      <mat-select
        [ngModel]="matchId"
        (ngModelChange)="matchIdChange.emit($event)"
        [disabled]="matches.length === 0"
        panelClass="kte-match-selector__panel"
      >
        <mat-option *ngFor="let match of matches" [value]="match.id">
          <div class="kte-match-selector__option">
            <strong>{{ match.homeTeam }} – {{ match.awayTeam }}</strong>
            <small>
              {{ match.kickoffAt | date: "yyyy. MMM d. HH:mm":'':'hu-HU' }}
              · {{ match.venue }}
            </small>
          </div>
        </mat-option>
        <mat-option *ngIf="matches.length === 0" disabled>
          Nincs elérhető mérkőzés
        </mat-option>
      </mat-select>
    </mat-form-field>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-match-selector {
        width: 100%;
        max-width: 520px;
      }

      .kte-match-selector__icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        margin-right: 4px;
        vertical-align: middle;
      }

      .kte-match-selector__option {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px 0;

        strong {
          font-weight: 600;
          color: var(--kte-brand-deep);
        }

        small {
          color: var(--kte-muted);
          font-size: 12px;
        }
      }
    `,
  ],
})
export class MatchSelectorComponent {
  @Input() matches: readonly MatchListItem[] = [];
  @Input() matchId: string | null = null;
  @Output() matchIdChange = new EventEmitter<string>();
}
