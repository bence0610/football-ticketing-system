import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, DatePipe, formatDate } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, of } from 'rxjs';
import { PassLoanResponse, SeasonPassResponse } from '../../../core/models/season-pass.models';
import { TicketResponse } from '../../../core/models/ticket.models';
import { MatchResource, MatchesService } from '../../../core/services/matches.service';
import { SeasonPassesService } from '../../../core/services/season-passes.service';
import {
  TicketQrDialogComponent,
  TicketQrDialogData,
} from './ticket-qr-dialog.component';
import {
  LoanInitiationDialogComponent,
  LoanInitiationDialogData,
  LoanInitiationDialogResult,
} from './loan-initiation-dialog/loan-initiation-dialog.component';
import { extractApiErrorMessage } from '../../../shared/utils/api-error';

type MatchRowState =
  | 'mine_upcoming'
  | 'loaned_accepted'
  | 'invitation_pending'
  | 'used_by_me'
  | 'loaned_completed'
  | 'mine_past';

interface MatchRow {
  matchId: string;
  matchTitle: string;
  kickoffAt: string;
  isPast: boolean;
  state: MatchRowState;
  activeLoan?: PassLoanResponse;
  completedLoan?: PassLoanResponse;
  /** Scan time as HH:mm, only when it is a real, formattable time. */
  scannedTime?: string;
}

/**
 * "HH:mm" for a scan time, or undefined when there is none or it is not a
 * valid date. The template drops the whole "beolvasva …-kor" clause then,
 * so the sentence never has a hole in it.
 */
export function scanTimeLabel(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  try {
    return formatDate(date, 'HH:mm', 'hu-HU') || undefined;
  } catch {
    return undefined;
  }
}

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
    MatProgressSpinnerModule,
  ],
  template: `
    @if (pass) {
      <mat-card class="pass-card">
        <mat-card-header>
          <mat-card-title>
            Bérlet — {{ pass.seasonLabel }}
            @if (pass.section) {
              <span class="section-badge">{{ pass.section }} szektor</span>
            }
          </mat-card-title>
          <mat-card-subtitle>
            Érvényes: {{ pass.validFrom | date: 'mediumDate' : '' : 'hu-HU' }} –
            {{ pass.validUntil | date: 'mediumDate' : '' : 'hu-HU' }}
          </mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <div class="row">
            <span class="label">Birtokos</span>
            <span data-testid="pass-holder">{{ pass.holderName }}</span>
          </div>
          @if (!pass.isBuyer && pass.buyerName) {
            <div class="row">
              <span class="label">Vásárló</span>
              <span>{{ pass.buyerName }}</span>
            </div>
          }
          @if (pass.section) {
            <div class="row">
              <span class="label">Szektor</span>
              <span>{{ pass.section }}</span>
            </div>
          }
          @if (pass.seatLabel) {
            <div class="row">
              <span class="label">Hely</span>
              <span>{{ pass.seatLabel }}</span>
            </div>
          }
          @if (pass.purchasedAt) {
            <div class="row">
              <span class="label">Vásárlás dátuma</span>
              <span>{{ pass.purchasedAt | date: 'mediumDate' : '' : 'hu-HU' }}</span>
            </div>
          }

          <h4 class="section-heading">Mérkőzések</h4>

          @if (matchesLoading()) {
            <div class="loader-row">
              <mat-spinner diameter="28"></mat-spinner>
            </div>
          } @else if (matchRows().length === 0) {
            <p class="empty">Nincs bérlethez tartozó mérkőzés.</p>
          } @else {
            @for (row of matchRows(); track row.matchId) {
              <div class="match-row" [class.is-past]="row.isPast">
                <div class="match-info">
                  <div class="match-title">{{ row.matchTitle }}</div>
                  <div class="match-meta">
                    {{ row.kickoffAt | date: 'yyyy. MMM d. HH:mm' : '' : 'hu-HU' }}
                  </div>
                </div>

                <div class="match-state">
                  @if (row.state === 'mine_upcoming') {
                    <button
                      mat-flat-button
                      color="primary"
                      class="qr-btn"
                      data-testid="qr-btn"
                      (click)="openMatchQr(row)"
                    >
                      <mat-icon>qr_code_2</mat-icon> QR
                    </button>
                    <button
                      mat-stroked-button
                      class="loan-btn"
                      data-testid="loan-btn"
                      (click)="openLoanDialog(row)"
                    >
                      <mat-icon>swap_horiz</mat-icon> Átadás
                    </button>
                  } @else if (row.state === 'loaned_accepted') {
                    <div class="state-stacked">
                      <span class="state-primary" data-testid="loaned-accepted-text">
                        Átadva — {{ row.activeLoan!.borrowerEmail }}
                      </span>
                      <span class="no-qr-text" data-testid="no-qr-text">nincs QR-od</span>
                    </div>
                    <button
                      mat-stroked-button
                      color="warn"
                      class="revoke-btn"
                      data-testid="revoke-btn"
                      (click)="onCancelLoan(row.activeLoan!)"
                    >
                      <mat-icon>cancel</mat-icon> Visszavonás
                    </button>
                  } @else if (row.state === 'invitation_pending') {
                    <div class="state-stacked">
                      <span class="state-primary" data-testid="invitation-text">
                        Meghívó kiküldve — {{ row.activeLoan!.borrowerEmail }}
                      </span>
                      <span class="validity-text">
                        Érvényes: {{ row.activeLoan!.expiresAt | date: 'MMM d. HH:mm' : '' : 'hu-HU' }}-ig
                      </span>
                    </div>
                    <button
                      mat-stroked-button
                      color="warn"
                      class="revoke-btn"
                      data-testid="revoke-btn"
                      (click)="onCancelLoan(row.activeLoan!)"
                    >
                      <mat-icon>cancel</mat-icon> Visszavonás
                    </button>
                  } @else if (row.state === 'used_by_me') {
                    <span class="state-primary dimmed-label" data-testid="used-text">
                      Felhasználva@if (row.scannedTime) { — beolvasva {{ row.scannedTime }}-kor}
                    </span>
                  } @else if (row.state === 'loaned_completed') {
                    <span class="state-primary dimmed-label" data-testid="loaned-past-text">
                      Átadva volt — {{ row.completedLoan!.borrowerEmail }} léptetett be
                    </span>
                  }
                </div>
              </div>
            }
          }
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: [
    `
      :host { display: block; }

      .pass-card {
        background: var(--kte-surface);
        color: var(--kte-ink);
        border: 1px solid var(--kte-border);
      }

      .row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        border-bottom: 1px solid var(--kte-line);
      }

      .label { color: var(--kte-muted); }

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

      .section-heading {
        margin: 18px 0 8px;
        font-family: var(--kte-font-display);
        font-size: 13px;
        color: var(--kte-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .loader-row {
        display: flex;
        justify-content: center;
        padding: 12px 0;
      }

      .empty { color: var(--muted); font-size: 13px; }

      .match-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 0;
        border-bottom: 1px solid var(--kte-line);
      }

      .match-row:last-child { border-bottom: none; }

      .match-row.is-past { opacity: 0.55; }

      .match-info { flex: 1; min-width: 0; }

      .match-title {
        font-family: var(--kte-font-display);
        font-weight: 600;
        font-size: 14px;
        color: var(--kte-ink);
      }

      .match-meta {
        font-size: 12px;
        color: var(--kte-muted);
        margin-top: 2px;
      }

      .match-state {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .state-stacked {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
      }

      .state-primary {
        font-size: 13px;
        font-weight: 500;
        color: var(--kte-ink);
      }

      .no-qr-text {
        font-size: 12px;
        color: var(--kte-muted);
        font-style: italic;
      }

      .validity-text {
        font-size: 12px;
        color: var(--kte-muted);
      }

      .dimmed-label { color: var(--kte-muted); }

      .qr-btn {
        font-family: var(--kte-font-display);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
    `,
  ],
})
export class SeasonPassCardComponent implements OnInit, OnChanges {
  @Input({ required: true }) pass!: SeasonPassResponse;
  @Input() myTickets: readonly TicketResponse[] = [];
  @Output() readonly changed = new EventEmitter<void>();

  private readonly matchesService = inject(MatchesService);
  private readonly seasonPassesService = inject(SeasonPassesService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly matchesLoading = signal(true);

  private readonly rawMatches = signal<MatchResource[]>([]);
  private readonly passInternal = signal<SeasonPassResponse | null>(null);
  private readonly ticketsInternal = signal<readonly TicketResponse[]>([]);

  protected readonly matchRows = computed<MatchRow[]>(() => {
    const pass = this.passInternal();
    const tickets = this.ticketsInternal();
    const matches = this.rawMatches();
    if (!pass) return [];
    return this.deriveRows(pass, tickets, matches);
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['pass'] && this.pass) {
      this.passInternal.set(this.pass);
    }
    if (changes['myTickets']) {
      this.ticketsInternal.set(this.myTickets ?? []);
    }
  }

  ngOnInit(): void {
    this.matchesService
      .listAll()
      .pipe(catchError(() => of<MatchResource[]>([])))
      .subscribe((matches) => {
        this.rawMatches.set(matches);
        this.matchesLoading.set(false);
      });
  }

  private deriveRows(
    pass: SeasonPassResponse,
    tickets: readonly TicketResponse[],
    matches: MatchResource[],
  ): MatchRow[] {
    const now = Date.now();
    const validFrom = new Date(pass.validFrom).getTime();
    const validUntil = new Date(pass.validUntil).getTime();
    return matches
      .filter((m) => {
        if (!m.isSeasonPassEligible) return false;
        const t = new Date(m.kickoffAt).getTime();
        return t >= validFrom && t <= validUntil;
      })
      .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())
      .map((match) => {
        const isPast = new Date(match.kickoffAt).getTime() < now;

        const activeLoan = pass.loans.find(
          (l) =>
            l.matchId === match.id &&
            (l.status === 'accepted' || l.status === 'pending'),
        );

        const completedLoan = pass.loans.find(
          (l) => l.matchId === match.id && l.status === 'completed',
        );

        const ownerTicket = tickets.find(
          (t) => t.match.id === match.id && t.source === 'season_pass',
        );

        let state: MatchRowState;
        if (activeLoan?.status === 'accepted') {
          state = 'loaned_accepted';
        } else if (activeLoan?.status === 'pending') {
          state = 'invitation_pending';
        } else if (ownerTicket?.status === 'used') {
          state = 'used_by_me';
        } else if (completedLoan) {
          state = 'loaned_completed';
        } else if (!isPast) {
          state = 'mine_upcoming';
        } else {
          state = 'mine_past';
        }

        return {
          matchId: match.id,
          matchTitle: `${match.homeTeam} – ${match.awayTeam}`,
          kickoffAt: match.kickoffAt,
          isPast,
          state,
          activeLoan,
          completedLoan,
          scannedTime: scanTimeLabel(ownerTicket?.scannedAt ?? ownerTicket?.usedAt),
        };
      });
  }

  protected openMatchQr(row: MatchRow): void {
    const ref = this.dialog.open<TicketQrDialogComponent, TicketQrDialogData>(
      TicketQrDialogComponent,
      {
        width: '380px',
        panelClass: 'kte-qr-panel',
        data: {
          matchTitle: row.matchTitle,
          seatLabel: this.pass.seatLabel ?? '',
          holderName: this.pass.holderName,
          qrLoader$: this.seasonPassesService.getMatchQr(this.pass.id, row.matchId),
        },
      },
    );

    ref.afterClosed().subscribe((result: { loanConflict?: boolean } | undefined) => {
      if (result?.loanConflict) {
        this.changed.emit();
      }
    });
  }

  protected openLoanDialog(row: MatchRow): void {
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
      data: { pass: this.pass, initialMatchId: row.matchId },
    });

    ref.afterClosed().subscribe((result) => {
      if (result?.created) {
        this.snack.open('Kölcsönzési meghívó elküldve.', 'Bezár', { duration: 3000 });
        this.changed.emit();
      }
    });
  }

  protected onCancelLoan(loan: PassLoanResponse): void {
    const reason = window.prompt('Visszavonás indoka (opcionális):') ?? undefined;
    this.seasonPassesService.cancelLoan(this.pass.id, loan.id, { reason }).subscribe({
      next: () => {
        this.snack.open('Kölcsön visszavonva.', 'Bezár', { duration: 3000 });
        this.changed.emit();
      },
      error: (err) => {
        this.snack.open(
          `Sikertelen visszavonás: ${extractApiErrorMessage(err, 'ismeretlen hiba')}`,
          'Bezár',
          { duration: 4000 },
        );
      },
    });
  }
}
