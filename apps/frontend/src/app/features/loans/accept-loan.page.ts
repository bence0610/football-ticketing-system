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
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import { LoanPreview, PassLoanResponse } from '../../core/models/season-pass.models';
import { kickoffLabel, loanSeatLabel, timeLeft } from '../../shared/utils/loan-format';

/**
 * The refusals are told apart by the server's own `code`, never guessed on the
 * client: the reader's next step differs for each.
 */
type PageState =
  | { kind: 'loading' }
  | { kind: 'preview' }
  | { kind: 'accepting' }
  | { kind: 'success'; loan: PassLoanResponse }
  | { kind: 'loan_expired' }
  | { kind: 'loan_revoked' }
  | { kind: 'seat_already_used' }
  | { kind: 'loan_already_accepted' }
  | { kind: 'error'; message: string; status: number | null };

@Component({
  selector: 'kte-accept-loan-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <section class="accept-page">
      <div class="accept-page__inner">
        @if (state().kind === 'loading') {
          <div class="card card--centre" aria-busy="true" aria-label="Meghívó betöltése">
            <div class="sk sk--icon"></div>
            <div class="sk sk--title"></div>
            <div class="sk sk--line"></div>
            <div class="sk sk--panel"></div>
            <div class="sk sk--btn"></div>
          </div>
        }

        @if (state().kind === 'preview' || state().kind === 'accepting') {
          <div class="card card--centre">
            <span class="glyph glyph--brand" aria-hidden="true">
              <mat-icon>confirmation_number</mat-icon>
            </span>
            <h2 class="title" data-testid="pending-heading">
              {{ preview()?.lenderName }} átadja a helyét
            </h2>
            <p class="lead">
              A hely egyetlen mérkőzésre szól. A QR-kód a saját fiókodban jelenik meg, miután
              elfogadtad.
            </p>

            <dl class="panel" data-testid="invitation-details">
              <div>
                <dt>Mérkőzés</dt>
                <dd>{{ preview()?.matchTitle }}</dd>
              </div>
              <div>
                <dt>Kezdés</dt>
                <dd>{{ kickoff() }}</dd>
              </div>
              <div>
                <dt>Hely</dt>
                <dd>{{ seat() }}</dd>
              </div>
              <div>
                <dt>Meghívó érvényes</dt>
                <dd class="amber" data-testid="invitation-left">{{ validity() }}</dd>
              </div>
            </dl>

            <div class="actions">
              <button
                mat-flat-button
                color="primary"
                class="btn-lg"
                data-testid="accept-button"
                [disabled]="state().kind === 'accepting'"
                (click)="accept()"
              >
                @if (state().kind === 'accepting') {
                  <mat-spinner diameter="20" class="spinner" />
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
            </div>

            <p class="note" data-testid="accept-note">
              Az elfogadással a tulajdonos belépője erre az egy mérkőzésre érvénytelenné válik. A
              bérlete a következő meccsen újra működik.
            </p>
          </div>
        }

        @if (state().kind === 'success') {
          <div class="card card--centre" data-testid="accept-success">
            <span class="glyph glyph--ok" aria-hidden="true"><mat-icon>check_circle</mat-icon></span>
            <h2 class="title">Megvan a helyed</h2>
            @if (successSubtitle()) {
              <p class="lead">{{ successSubtitle() }}</p>
            }
            <div class="actions">
              <a mat-flat-button color="primary" class="btn-lg" routerLink="/profile" data-testid="open-qr">
                <mat-icon>qr_code_2</mat-icon> QR megnyitása
              </a>
            </div>
            <p class="note">
              Ez a belépő csak erre az egy mérkőzésre szól. Ha a tulajdonos visszavonja, értesítünk.
            </p>
          </div>
        }

        @if (state().kind === 'loan_expired') {
          <div class="card card--refusal card--amber" role="alert" data-testid="refusal-expired">
            <mat-icon class="refusal__glyph refusal__glyph--amber" aria-hidden="true">schedule</mat-icon>
            <div class="refusal__body">
              <h2 class="title title--left">A meghívó lejárt</h2>
              <p class="lead lead--left">
                Az elfogadásra szánt idő letelt, ezért a hely a tulajdonosnál maradt erre a
                mérkőzésre.
              </p>
              <p class="next next--amber">
                <mat-icon aria-hidden="true">mail_outline</mat-icon>
                <span>Kérd meg a bérlet tulajdonosát, hogy küldjön új meghívót.</span>
              </p>
              <div class="actions actions--left">
                <a mat-stroked-button routerLink="/profile">Vissza a profilomhoz</a>
              </div>
            </div>
          </div>
        }

        @if (state().kind === 'loan_revoked') {
          <div class="card card--refusal card--red" role="alert" data-testid="refusal-revoked">
            <mat-icon class="refusal__glyph refusal__glyph--red" aria-hidden="true">undo</mat-icon>
            <div class="refusal__body">
              <h2 class="title title--left">A tulajdonos visszavonta</h2>
              <p class="lead lead--left">
                A tulajdonos visszavonta az átadást, a hely nála marad erre a mérkőzésre.
              </p>
              <div class="actions actions--left">
                <a mat-flat-button color="primary" routerLink="/stadium">Másik hely vásárlása</a>
              </div>
            </div>
          </div>
        }

        @if (state().kind === 'seat_already_used') {
          <div class="card card--refusal card--red" role="alert" data-testid="refusal-used">
            <mat-icon class="refusal__glyph refusal__glyph--red" aria-hidden="true">block</mat-icon>
            <div class="refusal__body">
              <h2 class="title title--left">A helyet már használták</h2>
              <p class="lead lead--left">
                Egy hely egy mérkőzésen egyetlen embert léptet be, és erre a mérkőzésre ezt a helyet
                már használták.
              </p>
              <div class="actions actions--left">
                <a mat-flat-button color="primary" routerLink="/stadium">Másik hely vásárlása</a>
              </div>
            </div>
          </div>
        }

        @if (state().kind === 'loan_already_accepted') {
          <div class="card card--centre" data-testid="refusal-accepted">
            <span class="glyph glyph--ok" aria-hidden="true"><mat-icon>check_circle</mat-icon></span>
            <h2 class="title">Ezt a meghívót már elfogadták</h2>
            <p class="lead">Ha te fogadtad el, a QR-kódot a profilodban találod.</p>
            <div class="actions">
              <a mat-flat-button color="primary" class="btn-lg" routerLink="/profile">Profil megnyitása</a>
            </div>
          </div>
        }

        @if (state().kind === 'error') {
          <div class="card card--refusal card--red" role="alert" data-testid="refusal-error">
            <mat-icon class="refusal__glyph refusal__glyph--red" aria-hidden="true">{{ errorGlyph() }}</mat-icon>
            <div class="refusal__body">
              <h2 class="title title--left">{{ errorTitle() }}</h2>
              <p class="lead lead--left">{{ errorLead() }}</p>
              @if (errorMessage()) {
                <p class="technical">{{ errorMessage() }}</p>
              }
              @if (errorRetryable()) {
                <div class="actions actions--left">
                  <button mat-flat-button color="primary" (click)="retry()">Újra próbálom</button>
                </div>
              }
            </div>
          </div>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host { display: block; }

      .accept-page {
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: 40px 16px 48px;
        background: transparent;
      }
      .accept-page__inner { width: 100%; max-width: 520px; }

      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        box-shadow: var(--kte-shadow-md);
        padding: 28px 24px 24px;
      }
      .card--centre { text-align: center; }

      .glyph {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 64px;
        height: 64px;
        border-radius: 50%;
        mat-icon { width: 34px; height: 34px; font-size: 34px; }
      }
      .glyph--brand { background: var(--brand-tint); color: var(--brand-deep); }
      .glyph--ok { background: var(--chip-paid-bg); color: var(--chip-paid); }

      .title {
        margin: 14px 0 0;
        font-family: var(--font-display);
        font-size: 22px;
        line-height: 1.25;
        font-weight: 700;
        color: var(--ink);
        overflow-wrap: anywhere;
      }
      .title--left { margin-top: 0; }
      .lead {
        margin: 8px 0 0;
        font-size: 15px;
        line-height: 1.55;
        color: var(--ink);
      }
      .lead--left { margin-top: 6px; }

      .panel {
        margin: 20px 0 0;
        padding: 4px 16px;
        text-align: left;
        background: var(--page);
        border: 1px solid var(--border-light);
        border-radius: var(--radius-block);
        > div {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 0;
          border-bottom: 1px solid var(--border-light);
        }
        > div:last-child { border-bottom: none; }
        dt { color: var(--muted); font-size: 13px; flex: none; }
        dd { margin: 0; font-size: 14px; font-weight: 600; color: var(--ink); text-align: right; overflow-wrap: anywhere; }
        dd.amber { color: var(--amber-ink); }
      }

      .actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 20px;
      }
      .actions--left { align-items: flex-start; }
      .actions .btn-lg { height: 52px; min-height: 52px; font-size: 16px; }
      .actions button, .actions a { min-height: 44px; }
      .spinner { display: inline-flex; vertical-align: middle; }

      .note {
        margin: 16px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: var(--muted);
      }
      .technical {
        margin: 8px 0 0;
        font-family: monospace;
        font-size: 12px;
        color: var(--muted);
        overflow-wrap: anywhere;
      }

      /* ── Refusals: a left edge colour, a glyph, and different actions ── */
      .card--refusal {
        display: flex;
        gap: 14px;
        align-items: flex-start;
        text-align: left;
        border-left-width: 4px;
      }
      .card--amber { border-left-color: var(--amber-icon); }
      .card--red { border-left-color: var(--error-edge); }
      .refusal__body { flex: 1; min-width: 0; }
      .refusal__glyph { flex: none; width: 28px; height: 28px; font-size: 28px; margin-top: 2px; }
      .refusal__glyph--amber { color: var(--amber-icon); }
      .refusal__glyph--red { color: var(--error-edge); }
      .next {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        margin: 14px 0 0;
        padding: 10px 12px;
        border-radius: var(--radius-block);
        font-size: 14px;
        line-height: 1.5;
        mat-icon { flex: none; width: 20px; height: 20px; font-size: 20px; }
      }
      .next--amber { background: var(--amber-bg); color: var(--amber-ink); mat-icon { color: var(--amber-icon); } }

      /* ── Skeleton ── */
      @keyframes shimmer {
        from { background-position: 200% 0; }
        to   { background-position: -200% 0; }
      }
      .sk {
        margin: 0 auto 12px;
        border-radius: 6px;
        background: linear-gradient(
          90deg,
          color-mix(in srgb, var(--muted) 20%, transparent) 25%,
          color-mix(in srgb, var(--muted) 8%, transparent) 50%,
          color-mix(in srgb, var(--muted) 20%, transparent) 75%
        );
        background-size: 400% 100%;
        animation: shimmer 1.8s ease-in-out infinite;
      }
      .sk--icon  { width: 64px; height: 64px; border-radius: 50%; }
      .sk--title { width: 70%; height: 24px; }
      .sk--line  { width: 85%; height: 16px; }
      .sk--panel { width: 100%; height: 150px; }
      .sk--btn   { width: 100%; height: 52px; }

      @media (max-width: 599px) {
        .accept-page { padding-inline: 0; }
      }
      @media (max-width: 480px) {
        .accept-page { padding: 16px 0 32px; }
        .card { padding: 22px 16px 18px; }
        .panel > div { flex-direction: column; gap: 2px; }
        .panel dd { text-align: left; }
      }
    `,
  ],
})
export class AcceptLoanPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly seasonPassesService = inject(SeasonPassesService);

  protected readonly state = signal<PageState>({ kind: 'loading' });
  private readonly loadedPreview = signal<LoanPreview | null>(null);
  private token: string | null = null;

  /** Fixed when the page opens: the "time left" is a from-now hint, not a ticker. */
  private readonly now = Date.now();

  protected readonly preview = computed(() => this.loadedPreview());

  protected readonly kickoff = computed(() => {
    const p = this.loadedPreview();
    return p ? kickoffLabel(p.kickoffAt) : '';
  });

  protected readonly seat = computed(() => {
    const p = this.loadedPreview();
    return p ? loanSeatLabel(p) : '';
  });

  protected readonly validity = computed(() => {
    const p = this.loadedPreview();
    if (!p) return '';
    const left = timeLeft(p.expiresAt, this.now);
    return left ? `még ${left}` : 'lejárt';
  });

  protected readonly successSubtitle = computed(() => {
    const s = this.state();
    if (s.kind !== 'success') return '';
    const title = s.loan.matchTitle ?? '';
    const kickoff = s.loan.kickoffAt ? kickoffLabel(s.loan.kickoffAt) : '';
    return [title, kickoff].filter(Boolean).join(' — ');
  });

  protected readonly errorMessage = computed(() => {
    const s = this.state();
    return s.kind === 'error' && s.status !== null && s.status >= 500 ? s.message : '';
  });

  private readonly errorStatus = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s.status : null;
  });

  /** A missing/unknown invitation cannot be fixed by retrying; a dropped connection can. */
  protected readonly errorRetryable = computed(() => this.errorStatus() !== 404);
  protected readonly errorGlyph = computed(() => (this.errorStatus() === 404 ? 'search_off' : 'wifi_off'));
  protected readonly errorTitle = computed(() =>
    this.errorStatus() === 404 ? 'Nem találjuk ezt a meghívót' : 'A szerver nem érhető el',
  );
  protected readonly errorLead = computed(() =>
    this.errorStatus() === 404
      ? 'Ellenőrizd, hogy a teljes linket nyitottad-e meg az e-mailből.'
      : 'A meghívó nem lett elfogadva, semmi sem változott. Ellenőrizd a kapcsolatot, majd próbáld újra.',
  );

  ngOnInit(): void {
    this.token =
      this.route.snapshot.paramMap.get('token') ?? this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      this.state.set({ kind: 'error', message: 'Hiányzó meghívókód.', status: 404 });
      return;
    }
    this.loadPreview();
  }

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
    } else if (code === 'loan_already_accepted') {
      this.state.set({ kind: 'loan_already_accepted' });
    } else {
      this.state.set({
        kind: 'error',
        message: this.extractErrorMessage(err),
        status: err instanceof HttpErrorResponse ? err.status : null,
      });
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
