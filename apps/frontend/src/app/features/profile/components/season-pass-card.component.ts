import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  PASS_LOAN_STATUS_LABELS,
  PassLoanResponse,
  SeasonPassResponse,
} from '../../../core/models/season-pass.models';
import { SeasonPassesService } from '../../../core/services/season-passes.service';
import {
  LoanInitiationDialogComponent,
  LoanInitiationDialogData,
  LoanInitiationDialogResult,
} from './loan-initiation-dialog/loan-initiation-dialog.component';

@Component({
  selector: 'kte-season-pass-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    DatePipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
  ],
  template: `
    @if (pass) {
      <mat-card class="pass-card">
        <mat-card-header>
          <mat-card-title>
            Bérlet - {{ pass.seasonLabel }}
            @if (pass.section) {
              <span class="section-badge">{{ pass.section }} szektor</span>
            }
          </mat-card-title>
          <mat-card-subtitle>
            Érvényes: {{ pass.validFrom | date: 'mediumDate' : '' : 'hu-HU' }} -
            {{ pass.validUntil | date: 'mediumDate' : '' : 'hu-HU' }}
          </mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          @if (pass.section) {
            <div class="row">
              <span class="label">Szektor</span><span>{{ pass.section }}</span>
            </div>
          }
          <div class="row" *ngIf="pass.seatLabel">
            <span class="label">Hely</span><span>{{ pass.seatLabel }}</span>
          </div>
          @if (pass.purchasedAt) {
            <div class="row">
              <span class="label">Vásárlás dátuma</span>
              <span>{{ pass.purchasedAt | date: 'mediumDate' : '' : 'hu-HU' }}</span>
            </div>
          }

          <h4 class="loan-heading">Kölcsönzések</h4>
          @if (pass.loans.length === 0) {
            <p class="empty">Nincs aktív kölcsönzés.</p>
          } @else {
            @for (loan of pass.loans; track loan.id) {
              <div class="loan-row">
                <div class="loan-info">
                  <div class="loan-title">{{ loan.matchTitle ?? 'Mérkőzés' }}</div>
                  <div class="loan-meta">
                    {{ loan.borrowerEmail }}
                    &middot; {{ loanStatusLabel(loan) }}
                    @if (loan.kickoffAt) { &middot; {{ loan.kickoffAt | date: 'short' : '' : 'hu-HU' }} }
                  </div>
                </div>
                @if (canCancel(loan)) {
                  <button mat-button color="warn" (click)="onCancelLoan(loan)">
                    <mat-icon>cancel</mat-icon> Visszavon
                  </button>
                }
              </div>
            }
          }
        </mat-card-content>
        <mat-card-actions align="end">
          <button
            mat-flat-button
            color="primary"
            class="loan-cta"
            [disabled]="!canInitiateLoan()"
            (click)="openLoanDialog()"
          >
            <mat-icon>swap_horiz</mat-icon>
            <span>Kölcsön adás</span>
          </button>
        </mat-card-actions>
      </mat-card>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pass-card { background: var(--kte-surface); color: var(--kte-ink); border: 1px solid var(--kte-border); }
      .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid var(--kte-line); }
      .label { color: var(--kte-muted); }
      .loan-heading { margin: 18px 0 8px; font-size: 14px; color: var(--kte-muted); text-transform: uppercase; letter-spacing: .5px; }
      .empty { color: var(--kte-faint); font-size: 13px; }
      .loan-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--kte-line); }
      .loan-row:last-child { border-bottom: none; }
      .loan-title { font-weight: 600; }
      .loan-meta { font-size: 12px; color: var(--kte-muted); margin-top: 2px; }
      mat-card-actions { padding: 8px 16px 16px; }
      .loan-cta {
        font-family: var(--kte-font-display);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .section-badge {
        margin-left: 8px;
        padding: 2px 8px;
        font-size: 12px;
        background: var(--kte-brand-tint);
        color: var(--kte-brand-deep);
        border-radius: var(--kte-radius);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
    `,
  ],
})
export class SeasonPassCardComponent {
  @Input({ required: true }) pass!: SeasonPassResponse;
  @Output() readonly changed = new EventEmitter<void>();

  private readonly service = inject(SeasonPassesService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  loanStatusLabel(loan: PassLoanResponse): string {
    return PASS_LOAN_STATUS_LABELS[loan.status];
  }

  canCancel(loan: PassLoanResponse): boolean {
    return loan.status === 'pending' || loan.status === 'accepted';
  }

  canInitiateLoan(): boolean {
    return this.pass.status === 'active';
  }

  openLoanDialog(): void {
    const ref = this.dialog.open<
      LoanInitiationDialogComponent,
      LoanInitiationDialogData,
      LoanInitiationDialogResult
    >(LoanInitiationDialogComponent, {
      width: '560px',
      maxWidth: '92vw',
      panelClass: 'kte-loan-dialog-panel',
      backdropClass: 'kte-loan-dialog-backdrop',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      data: { pass: this.pass },
    });

    ref.afterClosed().subscribe((result) => {
      if (result?.created) {
        this.snack.open('Kölcsönzési meghívó elküldve.', 'Bezár', { duration: 3000 });
        this.changed.emit();
      }
    });
  }

  onCancelLoan(loan: PassLoanResponse): void {
    const reason = window.prompt('Visszavonás indoka (opcionális):') ?? undefined;
    this.service.cancelLoan(this.pass.id, loan.id, { reason }).subscribe({
      next: () => {
        this.snack.open('Kölcsön visszavonva.', 'Bezár', { duration: 3000 });
        this.changed.emit();
      },
      error: (err) => {
        this.snack.open(`Sikertelen visszavonás: ${err?.error?.message ?? 'ismeretlen hiba'}`, 'Bezár', {
          duration: 4000,
        });
      },
    });
  }
}
