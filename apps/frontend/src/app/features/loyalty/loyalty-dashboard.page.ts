import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoyaltyService } from '../../core/services/loyalty.service';
import {
  LoyaltySnapshotResponse,
  LoyaltyTierResponse,
  TIER_COLORS,
  TIER_LABELS,
  TRANSACTION_SOURCE_LABELS,
  LoyaltyTransactionResponse,
} from '../../core/models/loyalty.models';

@Component({
  selector: 'kte-loyalty-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    DatePipe,
    MatCardModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatChipsModule,
    MatIconModule,
  ],
  template: `
    <section class="loyalty-page">
      @if (loading()) {
        <div class="loader"><mat-spinner diameter="48"></mat-spinner></div>
      } @else if (snapshot()) {
        <div class="hero" [style.borderColor]="snapshot()!.tier.color">
          <div class="hero-meta">
            <h1>Hűségprogram</h1>
            <div class="tier-badge" [style.background]="snapshot()!.tier.color">
              {{ tierLabel(snapshot()!.tier.tier) }}
            </div>
          </div>
          <div class="points-display">
            <div class="points-value">{{ snapshot()!.points }}</div>
            <div class="points-label">aktuális pont</div>
          </div>
        </div>

        <mat-card class="progress-card">
          @if (snapshot()!.nextTier) {
            <div class="progress-header">
              <span>Következő szint: <strong>{{ tierLabel(snapshot()!.nextTier!.tier) }}</strong></span>
              <span class="points-needed">{{ snapshot()!.pointsToNextTier }} pont szükséges</span>
            </div>
            <mat-progress-bar
              mode="determinate"
              [value]="progressPercent()"
              class="kte-progress"
            ></mat-progress-bar>
            <div class="progress-info">
              <span>{{ snapshot()!.tier.minPoints }} pont</span>
              <span>{{ snapshot()!.nextTier!.minPoints }} pont</span>
            </div>
          } @else {
            <div class="max-tier">
              <mat-icon>emoji_events</mat-icon>
              Elérted a legmagasabb hűségszintet. Köszönjük a támogatásod!
            </div>
          }
        </mat-card>

        @if (allTiers().length > 0) {
          <mat-card class="tiers-card">
            <h3>Szintek áttekintése</h3>
            <div class="tier-grid">
              @for (tier of allTiers(); track tier.tier) {
                <div class="tier-cell" [class.active]="snapshot()!.tier.tier === tier.tier">
                  <div class="tier-color" [style.background]="tier.color"></div>
                  <div class="tier-name">{{ tierLabel(tier.tier) }}</div>
                  <div class="tier-min">{{ tier.minPoints }}+</div>
                  <div class="tier-discount">{{ tier.discountPercent }}% kedvezmény</div>
                </div>
              }
            </div>
          </mat-card>
        }

        <mat-card class="transactions-card">
          <h3>Pontmozgások</h3>
          @if (snapshot()!.recentTransactions.length === 0) {
            <p class="empty">Még nincs pontmozgásod.</p>
          } @else {
            <table mat-table [dataSource]="snapshot()!.recentTransactions" class="kte-tx-table">
              <ng-container matColumnDef="createdAt">
                <th mat-header-cell *matHeaderCellDef>Dátum</th>
                <td mat-cell *matCellDef="let tx">{{ tx.createdAt | date: 'short' : '' : 'hu-HU' }}</td>
              </ng-container>
              <ng-container matColumnDef="source">
                <th mat-header-cell *matHeaderCellDef>Forrás</th>
                <td mat-cell *matCellDef="let tx">{{ sourceLabel(tx) }}</td>
              </ng-container>
              <ng-container matColumnDef="description">
                <th mat-header-cell *matHeaderCellDef>Leírás</th>
                <td mat-cell *matCellDef="let tx">{{ tx.description ?? '—' }}</td>
              </ng-container>
              <ng-container matColumnDef="points">
                <th mat-header-cell *matHeaderCellDef>Pont</th>
                <td mat-cell *matCellDef="let tx" [class.positive]="tx.points > 0" [class.negative]="tx.points < 0">
                  {{ tx.points > 0 ? '+' : '' }}{{ tx.points }}
                </td>
              </ng-container>
              <ng-container matColumnDef="balance">
                <th mat-header-cell *matHeaderCellDef>Egyenleg</th>
                <td mat-cell *matCellDef="let tx">{{ tx.balanceAfter }}</td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="tableColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: tableColumns;"></tr>
            </table>
          }
        </mat-card>
      }
    </section>
  `,
  styles: [
    `
      /* Loyalty dashboard: light surface base per design-token refactor.
         Gold accents reserved for the tier badge/card only, per token policy. */
      .loyalty-page { display: block; padding: 24px; max-width: 1080px; margin: 0 auto; }
      .loader { display: flex; justify-content: center; padding: 64px; }

      .hero {
        background: var(--kte-surface);
        border: 2px solid var(--kte-border);
        border-radius: var(--kte-radius-lg);
        padding: 32px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 16px;
      }
      .hero h1 { margin: 0 0 12px; font-size: 28px; color: var(--kte-ink); font-family: var(--kte-font-display); }
      .tier-badge {
        display: inline-block;
        padding: 8px 18px;
        border-radius: var(--kte-radius-pill);
        color: var(--kte-surface);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        font-size: 13px;
      }
      .points-value {
        font-size: 56px;
        font-weight: 700;
        color: var(--kte-gold);
        line-height: 1;
        font-family: var(--kte-font-display);
      }
      .points-label { color: var(--kte-muted); font-size: 13px; text-align: right; }

      .progress-card { background: var(--kte-surface); border: 1px solid var(--kte-border); padding: 20px; margin-bottom: 16px; color: var(--kte-ink); }
      .progress-header { display: flex; justify-content: space-between; margin-bottom: 12px; font-size: 14px; }
      .points-needed { color: var(--kte-muted); }
      .progress-info { display: flex; justify-content: space-between; margin-top: 6px; font-size: 12px; color: var(--kte-faint); }

      .kte-progress {
        --mdc-linear-progress-track-color: var(--kte-line);
        --mdc-linear-progress-active-indicator-color: var(--kte-brand-mid);
        height: 10px; border-radius: 6px;
      }
      .max-tier { color: var(--kte-gold-ink); background: var(--kte-gold-bg); padding: 12px 16px; border-radius: var(--kte-radius); font-weight: 600; display: flex; gap: 8px; align-items: center; }

      .tiers-card { background: var(--kte-surface); border: 1px solid var(--kte-border); padding: 20px; margin-bottom: 16px; color: var(--kte-ink); }
      .tiers-card h3 { margin: 0 0 16px; font-size: 16px; color: var(--kte-muted); text-transform: uppercase; letter-spacing: 0.6px; }
      .tier-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .tier-cell { background: var(--kte-page); border: 1px solid var(--kte-border); border-radius: var(--kte-radius); padding: 16px; transition: border-color .15s; }
      .tier-cell.active { border-color: var(--kte-brand-mid); }
      .tier-color { width: 32px; height: 32px; border-radius: var(--kte-radius-sm); margin-bottom: 8px; }
      .tier-name { font-weight: 700; font-size: 16px; color: var(--kte-ink); }
      .tier-min { font-size: 13px; color: var(--kte-muted); }
      .tier-discount { font-size: 13px; color: var(--kte-success); margin-top: 4px; }

      .transactions-card { background: var(--kte-surface); border: 1px solid var(--kte-border); padding: 20px; color: var(--kte-ink); }
      .transactions-card h3 { margin: 0 0 16px; font-size: 16px; color: var(--kte-muted); text-transform: uppercase; letter-spacing: 0.6px; }
      .kte-tx-table { width: 100%; background: transparent; }
      .kte-tx-table th { color: var(--kte-muted); background: var(--kte-page); }
      .kte-tx-table tr.mat-mdc-row { height: 46px; }
      .kte-tx-table tr.mat-mdc-row td { border-bottom: 1px solid var(--kte-line); color: var(--kte-ink); }
      .positive { color: var(--kte-success); font-weight: 600; }
      .negative { color: var(--kte-danger); font-weight: 600; }
      .empty { color: var(--kte-muted); padding: 16px; text-align: center; }
    `,
  ],
})
export class LoyaltyDashboardPageComponent implements OnInit {
  protected readonly snapshot = signal<LoyaltySnapshotResponse | null>(null);
  protected readonly allTiers = signal<LoyaltyTierResponse[]>([]);
  protected readonly loading = signal<boolean>(true);
  protected readonly tableColumns = ['createdAt', 'source', 'description', 'points', 'balance'];

  private readonly loyaltyService = inject(LoyaltyService);
  private readonly snack = inject(MatSnackBar);
  private previousTier: string | null = null;

  ngOnInit(): void {
    this.loyaltyService.getTiers().subscribe({
      next: (tiers) => this.allTiers.set(tiers),
      error: () => this.allTiers.set([]),
    });
    this.loyaltyService.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot.set(snap);
        this.loading.set(false);
        if (this.previousTier && this.previousTier !== snap.tier.tier) {
          this.snack.open(`Új hűségszintet értél el: ${TIER_LABELS[snap.tier.tier]}`, 'Bezár', {
            duration: 5000,
            panelClass: ['kte-toast'],
          });
        }
        this.previousTier = snap.tier.tier;
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  protected progressPercent(): number {
    const snap = this.snapshot();
    if (!snap || !snap.nextTier) {
      return 100;
    }
    const range = snap.nextTier.minPoints - snap.tier.minPoints;
    if (range <= 0) {
      return 100;
    }
    const earned = snap.points - snap.tier.minPoints;
    return Math.max(0, Math.min(100, Math.round((earned / range) * 100)));
  }

  protected tierLabel(tier: string): string {
    return TIER_LABELS[tier as keyof typeof TIER_LABELS] ?? tier;
  }

  protected tierColor(tier: string): string {
    // Fallback mirrors --kte-faint from styles.scss (inline style, no CSS vars).
    return TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? '#9D96A8';
  }

  protected sourceLabel(tx: LoyaltyTransactionResponse): string {
    return TRANSACTION_SOURCE_LABELS[tx.source] ?? tx.source;
  }
}
