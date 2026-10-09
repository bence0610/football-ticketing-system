import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatchListItem } from '../../../../shared/models/match.model';

@Component({
  selector: 'kte-heatmap-match-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatSelectModule],
  template: `
    <mat-form-field appearance="outline" class="kte-match-picker">
      <mat-label>Mérkőzés</mat-label>
      <mat-select
        [ngModel]="selectedMatchId"
        (ngModelChange)="matchChanged.emit($event)"
      >
        @for (match of matches; track match.id) {
          <mat-option [value]="match.id">
            {{ match.homeTeam }} – {{ match.awayTeam }}
            ({{ match.kickoffAt | date: "yyyy. MMM d. HH:mm" : '' : 'hu-HU' }})
          </mat-option>
        }
      </mat-select>
    </mat-form-field>
  `,
  styles: [
    `
      .kte-match-picker {
        width: 100%;
        max-width: 480px;
      }
    `,
  ],
})
export class MatchPickerComponent {
  @Input() matches: readonly MatchListItem[] = [];
  @Input() selectedMatchId: string | null = null;
  @Output() readonly matchChanged = new EventEmitter<string>();
}
