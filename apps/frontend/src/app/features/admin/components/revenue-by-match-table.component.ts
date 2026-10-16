import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { RevenueByMatch } from '../../../shared/models/admin.model';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';

@Component({
  selector: 'kte-revenue-by-match-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatTableModule, HufCurrencyPipe],
  template: `
    <table mat-table [dataSource]="rows" class="kte-revenue-table">
      <ng-container matColumnDef="match">
        <th mat-header-cell *matHeaderCellDef>Mérkőzés</th>
        <td mat-cell *matCellDef="let row">
          <strong>{{ row.homeTeam }}</strong> vs {{ row.awayTeam }}
        </td>
      </ng-container>

      <ng-container matColumnDef="kickoff">
        <th mat-header-cell *matHeaderCellDef>Kezdés</th>
        <td mat-cell *matCellDef="let row">
          {{ row.kickoffAt | date: "yyyy. MMM d." : '' : 'hu-HU' }}
        </td>
      </ng-container>

      <ng-container matColumnDef="tickets">
        <th mat-header-cell *matHeaderCellDef class="kte-revenue-table__num">Jegyek</th>
        <td mat-cell *matCellDef="let row" class="kte-revenue-table__num">{{ row.ticketCount }}</td>
      </ng-container>

      <ng-container matColumnDef="revenue">
        <th mat-header-cell *matHeaderCellDef class="kte-revenue-table__num">Bevétel</th>
        <td mat-cell *matCellDef="let row" class="kte-revenue-table__num">
          <strong>{{ row.revenue | hufCurrency }}</strong>
        </td>
      </ng-container>

      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns"></tr>
    </table>

    @if (rows.length === 0) {
      <p class="kte-revenue-table__empty">Még nincs eladott jegy a kiválasztott időszakban.</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .kte-revenue-table {
        width: 100%;
        background: var(--kte-surface);
        border-radius: var(--kte-radius-sm);
        overflow: hidden;
      }
      .kte-revenue-table__num {
        text-align: right;
      }
      .kte-revenue-table__empty {
        padding: 24px;
        text-align: center;
        color: var(--kte-muted);
      }
    `,
  ],
})
export class RevenueByMatchTableComponent {
  @Input() rows: readonly RevenueByMatch[] = [];

  protected readonly columns: readonly string[] = ['match', 'kickoff', 'tickets', 'revenue'];
}
