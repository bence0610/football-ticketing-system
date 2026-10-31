import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import { LoanPreview, PassLoanResponse } from '../../core/models/season-pass.models';

type PageState =
  | { kind: 'loading' }
  | { kind: 'preview' }
  | { kind: 'accepting' }
  | { kind: 'success'; loan: PassLoanResponse }
  | { kind: 'loan_expired' }
  | { kind: 'loan_revoked' }
  | { kind: 'seat_already_used' }
  | { kind: 'error'; message: string };

@Component({
  selector: 'kte-accept-loan-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <section class="accept-page">
      <div class="accept-page__inner">

        @if (state().kind === 'loading') {
          <mat-card class="accept-card accept-card--skeleton" appearance="outlined">
            <div class="accept-card__icon-row">
              <div class="sk sk--icon"></div>
            </div>
            <mat-card-header>
              <div class="sk sk--title"></div>
              <div class="sk sk--subtitle"></div>
            </mat-card-header>
            <mat-card-content class="accept-card__content">
              <div class="sk sk--line"></div>
              <div class="sk sk--line sk--short"></div>
              <div class="sk sk--line"></div>
              <div class="sk sk--line sk--short"></div>
            </mat-card-content>
            <mat-card-actions class="accept-card__actions">
              <div class="sk sk--btn"></div>
              <div class="sk sk--btn sk--btn-sm"></div>
            </mat-card-actions>
          </mat-card>
        }

        @if (state().kind === 'preview' || state().kind === 'accepting') {
          <mat-card class="accept-card" appearance="outlined">
            <div class="accept-card__icon-row">
              <mat-icon class="accept-card__icon">confirmation_number</mat-icon>
            </div>
            <mat-card-header>
              <mat-card-title data-testid="pending-heading">
                {{ preview()?.lenderName }} átadja a helyét
              </mat-card-title>
              <mat-card-subtitle>{{ previewMatchSubtitle() }}</mat-card-subtitle>
            </mat-card-header>
            <mat-card-content class="accept-card__content">
              <ul class="accept-card__details">
                <li>
                  <mat-icon>stadium</mat-icon>
                  <span>{{ preview()?.matchVenue }}</span>
                </li>
                <li>
                  <mat-icon>event</mat-icon>
                  <span>{{ kickoffLabel() }}</span>
                </li>
                <li>
                  <mat-icon>chair</mat-icon>
                  <span>{{ seatLabel() }}</span>
                </li>
                <li>
                  <mat-icon>schedule</mat-icon>
                  <span>Ajánlat érvényes: {{ expiryLabel() }}</span>
                </li>
              </ul>
              <p class="accept-card__note">
                Elfogadással a tulajdonos belépési joga erre a mérkőzésre
                érvénytelenné válik. Ha a tulajdonos visszavonja a kölcsönzést,
                e-mail értesítést kapsz.
              </p>
            </mat-card-content>
            <mat-card-actions class="accept-card__actions">
              <button
                mat-flat-button
                color="primary"
                data-testid="accept-button"
                [disabled]="state().kind === 'accepting'"
                (click)="accept()"
              >
                @if (state().kind === 'accepting') {
                  <mat-spinner diameter="20" class="accept-card__btn-spinner" />
                } @else {
                  Elfogadom
                }
              </button>
              <button
                mat-stroked-button
                data-testid="decline-button"
                [disabled]="state().kind === 'accepting'"
                (click)="decline()"
              >
                Most nem
              </button>
            </mat-card-actions>
          </mat-card>
        }

        @if (state().kind === 'success') {
          <mat-card class="accept-card accept-card--success" appearance="outlined">
            <div class="accept-card__icon-row">
              <mat-icon class="accept-card__icon accept-card__icon--success">check_circle</mat-icon>
            </div>
            <mat-card-header>
              <mat-card-title>Megvan a helyed!</mat-card-title>
              @if (successSubtitle()) {
                <mat-card-subtitle>{{ successSubtitle() }}</mat-card-subtitle>
              }
            </mat-card-header>
            <mat-card-content class="accept-card__content">
              <p>
                A QR kód a profil oldalon, a jegyeid között található. Belépési jog
                <strong>erre az egy mérkőzésre</strong> érvényes — a tulajdonos bérlete
                a következő meccsen újra aktiválódik. Visszavonás esetén e-mail értesítést kapsz.
              </p>
            </mat-card-content>
            <mat-card-actions class="accept-card__actions">
              <button mat-flat-button color="primary" routerLink="/profile">
                Profil megnyitása
              </button>
            </mat-card-actions>
          </mat-card>
        }

        @if (state().kind === 'loan_expired') {
          <mat-card class="accept-card accept-card--warn" appearance="outlined">
            <div class="accept-card__icon-row">
              <mat-icon class="accept-card__icon accept-card__icon--warn">schedule</mat-icon>
            </div>
            <mat-card-header>
              <mat-card-title>A meghívó lejárt</mat-card-title>
            </mat-card-header>
            <mat-card-content class="accept-card__content">
              <p>
                Ez a meghívó már nem érvényes — az érvényességi idő lejárt, és a
                tulajdonos újra használhatja a saját bérletét.
              </p>
              <div class="accept-card__next-step">
                <mat-icon>mail_outline</mat-icon>
                <span>
                  Lépj kapcsolatba a bérlet tulajdonosával, és kérj tőle új meghívót.
                </span>
              </div>
            </mat-card-content>
          </mat-card>
        }

        @if (state().kind === 'loan_revoked') {
          <mat-card class="accept-card accept-card--warn" appearance="outlined">
            <div class="accept-card__icon-row">
              <mat-icon class="accept-card__icon accept-card__icon--warn">undo</mat-icon>
            </div>
            <mat-card-header>
              <mat-card-title>A tulajdonos visszavonta</mat-card-title>
            </mat-card-header>
            <mat-card-content class="accept-card__content">
              <p>
                A bérlet tulajdonosa visszavonta a meghívót, és ő maga megy a meccsre.
                Ha szeretnél jegyet erre a mérkőzésre, vásárolhatsz szabad helyre.
              </p>
            </mat-card-content>
            <mat-card-actions class="accept-card__actions">
              <button mat-flat-button color="primary" routerLink="/stadium">
                Szabad helyek megtekintése
              </button>
            </mat-card-actions>
          </mat-card>
        }

        @if (state().kind === 'seat_already_used') {
          <mat-card class="accept-card accept-card--danger" appearance="outlined">
            <div class="accept-card__icon-row">
              <mat-icon class="accept-card__icon accept-card__icon--danger">block</mat-icon>
            </div>
            <mat-card-header>
              <mat-card-title>A helyet már használták</mat-card-title>
            </mat-card-header>
            <mat-card-content class="accept-card__content">
              <p>
                A bérletestulajdonos már belépett a stadionba ezzel a hellyel erre a mérkőzésre.
                Minden hely csak egyszer használható — a belépési jog nem ruházható át, ha
                azt már érvényesítették. Vásárolhatsz szabad helyre jegyet.
              </p>
            </mat-card-content>
            <mat-card-actions class="accept-card__actions">
              <button mat-flat-button color="primary" routerLink="/stadium">
                Szabad helyek megtekintése
              </button>
            </mat-card-actions>
          </mat-card>
        }

        @if (state().kind === 'error') {
          <mat-card class="accept-card accept-card--danger" appearance="outlined">
            <div class="accept-card__icon-row">
              <mat-icon class="accept-card__icon accept-card__icon--danger">wifi_off</mat-icon>
            </div>
            <mat-card-header>
              <mat-card-title>A szerver nem érhető el</mat-card-title>
            </mat-card-header>
            <mat-card-content class="accept-card__content">
              <p>
                Nem sikerült elérni a szervert. A meghívó nem lett elfogadva — semmi sem
                változott. Ellenőrizd a kapcsolatot, majd próbáld újra.
              </p>
              @if (errorMessage()) {
                <p class="accept-card__technical">{{ errorMessage() }}</p>
              }
            </mat-card-content>
            <mat-card-actions class="accept-card__actions">
              <button mat-flat-button color="primary" (click)="retry()">
                Újra próbálom
              </button>
            </mat-card-actions>
          </mat-card>
        }

      </div>
    </section>
  `,
  styles: [`
    .accept-page {
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 48px 16px;
      min-height: 100%;
      background: var(--kte-page);
    }
    .accept-page__inner {
      width: 100%;
      max-width: 520px;
    }
    .accept-card {
      border-radius: var(--kte-radius-lg);
      box-shadow: var(--kte-shadow-md);
      overflow: hidden;
    }
    .accept-card__icon-row {
      display: flex;
      justify-content: center;
      padding: 32px 32px 0;
    }
    .accept-card__icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--kte-brand-deep);
    }
    .accept-card__icon--success { color: var(--kte-success); }
    .accept-card__icon--warn    { color: var(--kte-warn); }
    .accept-card__icon--danger  { color: var(--kte-danger); }
    .accept-card__content {
      padding: 8px 16px 0;
      p {
        font-family: var(--kte-font-body);
        font-size: 15px;
        line-height: 1.6;
        color: var(--kte-ink);
        margin: 0 0 12px;
      }
    }
    .accept-card__details {
      list-style: none;
      margin: 0 0 16px;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
      li {
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: var(--kte-font-body);
        font-size: 15px;
        color: var(--kte-ink);
        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
          color: var(--kte-muted);
          flex-shrink: 0;
        }
      }
    }
    .accept-card__next-step {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: color-mix(in srgb, var(--kte-warn) 12%, transparent);
      border-left: 3px solid var(--kte-warn);
      border-radius: 4px;
      padding: 10px 14px;
      margin-top: 4px;
      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--kte-warn);
        flex-shrink: 0;
        margin-top: 1px;
      }
      span {
        font-family: var(--kte-font-body);
        font-size: 14px;
        line-height: 1.5;
        color: var(--kte-ink);
      }
    }
    .accept-card__note {
      font-size: 13px !important;
      color: var(--kte-muted) !important;
    }
    .accept-card__technical {
      font-size: 12px !important;
      color: var(--kte-faint) !important;
      font-family: monospace;
    }
    .accept-card__actions {
      display: flex;
      gap: 12px;
      padding: 16px 16px 24px;
      flex-wrap: wrap;
    }
    .accept-card__btn-spinner {
      display: inline-flex;
      vertical-align: middle;
    }
    mat-card-title {
      font-family: var(--kte-font-display);
      font-size: 22px;
      font-weight: 700;
      color: var(--kte-ink);
    }
    .accept-card--success mat-card-title { color: var(--kte-success); }
    .accept-card--warn    mat-card-title { color: var(--kte-warn); }
    .accept-card--danger  mat-card-title { color: var(--kte-danger); }

    /* ── Skeleton ── */
    @keyframes shimmer {
      from { background-position: 200% 0; }
      to   { background-position: -200% 0; }
    }
    .sk {
      border-radius: 4px;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--kte-muted) 20%, transparent) 25%,
        color-mix(in srgb, var(--kte-muted) 8%, transparent)  50%,
        color-mix(in srgb, var(--kte-muted) 20%, transparent) 75%
      );
      background-size: 400% 100%;
      animation: shimmer 1.8s ease-in-out infinite;
    }
    .sk--icon    { width: 48px; height: 48px; border-radius: 50%; }
    .sk--title   { width: 70%; height: 24px; margin-bottom: 8px; }
    .sk--subtitle{ width: 50%; height: 16px; }
    .sk--line    { height: 16px; margin-bottom: 10px; }
    .sk--short   { width: 60%; }
    .sk--btn     { height: 36px; width: 120px; border-radius: 18px; }
    .sk--btn-sm  { width: 80px; }
    .accept-card--skeleton mat-card-header {
      padding: 16px 16px 0;
    }
  `],
})
export class AcceptLoanPageComponent implements OnInit {
  private readonly route   = inject(ActivatedRoute);
  private readonly router  = inject(Router);
  private readonly seasonPassesService = inject(SeasonPassesService);

  protected readonly state = signal<PageState>({ kind: 'loading' });

  private readonly loadedPreview = signal<LoanPreview | null>(null);

  private token: string | null = null;

  // ── computed signals used by the template ────────────────────────────

  protected readonly preview = computed(() => this.loadedPreview());

  protected readonly previewMatchSubtitle = computed(() => {
    const p = this.loadedPreview();
    if (!p) return '';
    const kickoff = new Date(p.kickoffAt).toLocaleString('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    return `${p.matchTitle} — ${kickoff}`;
  });

  protected readonly kickoffLabel = computed(() => {
    const p = this.loadedPreview();
    if (!p) return '';
    return new Date(p.kickoffAt).toLocaleString('hu-HU', {
      timeZone: 'Europe/Budapest',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  });

  protected readonly seatLabel = computed(() => {
    const p = this.loadedPreview();
    if (!p) return '';
    return `${p.seatSection} szektor / ${p.seatRow}. sor / ${p.seatNumber}. szék`;
  });

  protected readonly expiryLabel = computed(() => {
    const p = this.loadedPreview();
    if (!p) return '';
    return new Date(p.expiresAt).toLocaleString('hu-HU', {
      timeZone: 'Europe/Budapest',
      month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  });

  protected readonly successSubtitle = computed(() => {
    const s = this.state();
    if (s.kind !== 'success') return '';
    const matchTitle = s.loan.matchTitle ?? '';
    const kickoff    = s.loan.kickoffAt
      ? new Date(s.loan.kickoffAt).toLocaleString('hu-HU', {
          timeZone: 'Europe/Budapest',
          year: 'numeric', month: 'long', day: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : '';
    if (matchTitle && kickoff) return `${matchTitle} — ${kickoff}`;
    if (matchTitle) return matchTitle;
    if (kickoff)    return kickoff;
    return '';
  });

  protected readonly errorMessage = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s.message : '';
  });

  // ── lifecycle ────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.token =
      this.route.snapshot.paramMap.get('token') ??
      this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      this.state.set({ kind: 'error', message: 'Hiányzó meghívókód.' });
      return;
    }
    this.loadPreview();
  }

  // ── actions ──────────────────────────────────────────────────────────

  protected accept(): void {
    if (!this.token || this.state().kind !== 'preview') return;
    this.state.set({ kind: 'accepting' });
    this.seasonPassesService.acceptLoan(this.token).subscribe({
      next: (loan) => this.state.set({ kind: 'success', loan }),
      error: (err: unknown) => this.applyErrorCode(err),
    });
  }

  protected decline(): void {
    void this.router.navigate(['/']);
  }

  protected retry(): void {
    if (!this.token) return;
    this.state.set({ kind: 'loading' });
    this.loadPreview();
  }

  // ── private helpers ──────────────────────────────────────────────────

  private loadPreview(): void {
    this.seasonPassesService.previewLoan(this.token!).subscribe({
      next: (preview) => {
        this.loadedPreview.set(preview);
        this.state.set({ kind: 'preview' });
      },
      error: (err: unknown) => this.applyErrorCode(err),
    });
  }

  private applyErrorCode(err: unknown): void {
    const code = this.extractErrorCode(err);
    if (code === 'loan_expired') {
      this.state.set({ kind: 'loan_expired' });
    } else if (code === 'loan_revoked') {
      this.state.set({ kind: 'loan_revoked' });
    } else if (code === 'seat_already_used') {
      this.state.set({ kind: 'seat_already_used' });
    } else {
      this.state.set({ kind: 'error', message: this.extractErrorMessage(err) });
    }
  }

  private extractErrorCode(err: unknown): string | null {
    if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
      const code = (err.error as Record<string, unknown>)['code'];
      return typeof code === 'string' ? code : null;
    }
    return null;
  }

  private extractErrorMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
      const msg = (err.error as Record<string, unknown>)['message'];
      if (typeof msg === 'string') return msg;
    }
    return 'Ismeretlen hiba.';
  }
}
