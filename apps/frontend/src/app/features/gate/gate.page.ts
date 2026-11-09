import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { catchError, of, timeout } from 'rxjs';
import { TicketScanResponse } from '../../core/models/ticket.models';
import { MatchResource, MatchesService } from '../../core/services/matches.service';
import { TicketsService } from '../../core/services/tickets.service';
import { ScreenWakeLock } from '../../shared/utils/screen-wake-lock';
import { CameraError, CameraFailure, CameraSession, GateCamera, RepeatGuard } from './gate-camera.service';
import { GateFeedback } from './gate-feedback.service';
import {
  Verdict,
  isAdmission,
  verdictFromFailure,
  verdictFromResponse,
  verdictNotATicket,
  whenLabel,
} from './gate-verdict';
import { extractTicketId } from './ticket-token';

type Mode = 'scan' | 'manual';
type CameraState = 'starting' | 'on' | CameraFailure;

/** The scan endpoint answers in well under a second; past this the check is treated as failed. */
const SCAN_TIMEOUT_MS = 10_000;
/** A verdict ignores presses for this long, so a stray tap cannot dismiss it unseen. */
const PRESS_GUARD_MS = 450;
const ADMITTED_KEY = 'kte.gate.admitted';
/** A match counts as "current" from this long before kickoff... */
const MATCH_WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;
const IGNORED_MATCH_STATUSES: readonly string[] = ['cancelled', 'postponed', 'finished'];

const CAMERA_MESSAGES: Record<CameraFailure, string> = {
  denied: 'A kamera használata le van tiltva. Engedélyezd a böngésző beállításaiban, vagy használd a kézi bevitelt.',
  unavailable: 'Nem érhető el kamera ezen az eszközön. Használd a kézi bevitelt.',
  insecure: 'A kamera csak biztonságos (https) kapcsolaton működik. Használd a kézi bevitelt.',
};

@Component({
  selector: 'kte-gate-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <main class="gate" (pointerdown)="onTouch()">
      <div class="screen" [attr.inert]="verdict() ? '' : null">
        <!-- ───── Top bar ───── -->
        <header class="bar">
          <div class="bar__row">
            <span class="live" [class.live--off]="!live()" data-testid="live">
              <i class="live__dot" aria-hidden="true"></i>
              {{ live() ? 'Beléptetés' : 'Nincs hálózat' }}
            </span>
            <span class="count" data-testid="admitted-count">
              <strong>{{ admitted() }}</strong>
              <small>belépett<span class="sr"> ezen az eszközön</span></small>
            </span>
          </div>
          @if (fixture(); as f) {
            <p class="fixture" data-testid="fixture">
              <span class="fixture__teams">{{ f.teams }}</span>
              <span class="fixture__time">{{ f.kickoff }}</span>
            </p>
          }
        </header>

        @if (mode() === 'scan') {
          <!-- ───── Scanning ───── -->
          <section class="scan">
            <div class="scan__view">
              <video #video class="scan__video" autoplay playsinline muted></video>
              @if (cameraState() === 'on') {
                <div class="frame" aria-hidden="true">
                  <span class="frame__c frame__c--tl"></span>
                  <span class="frame__c frame__c--tr"></span>
                  <span class="frame__c frame__c--bl"></span>
                  <span class="frame__c frame__c--br"></span>
                  <span class="frame__line"></span>
                </div>
              }
              @if (!live()) {
                <div class="scan__notice" role="status" data-testid="offline-notice">
                  <mat-icon aria-hidden="true">wifi_off</mat-icon>
                  <p><strong>Nincs hálózat.</strong> A beléptetés szünetel: jegyet nem lehet ellenőrizni.</p>
                </div>
              } @else if (cameraState() === 'starting') {
                <div class="scan__notice" role="status"><p>Kamera indítása…</p></div>
              } @else if (cameraFailure()) {
                <div class="scan__notice" role="status" data-testid="camera-notice">
                  <mat-icon aria-hidden="true">no_photography</mat-icon>
                  <p>{{ cameraFailure() }}</p>
                  @if (cameraState() !== 'insecure') {
                    <button type="button" class="link" (click)="restartCamera()">Kamera újrapróbálása</button>
                  }
                </div>
              }
              @if (checking()) {
                <div class="scan__notice scan__notice--busy" role="status">
                  <p>Ellenőrzés…</p>
                </div>
              }
            </div>
            <p class="scan__caption">Tartsd a QR-kódot a keretbe</p>
            @if (feedback.needsTap()) {
              <p class="scan__hint" data-testid="sound-hint">Érintsd meg a képernyőt a hang bekapcsolásához.</p>
            }
          </section>
          <footer class="foot">
            <button type="button" class="btn btn--outline" (click)="showManual()">Kézi bevitel</button>
          </footer>
        } @else {
          <!-- ───── Manual entry ───── -->
          <section class="manual">
            <h1 class="manual__title">Kézi bevitel</h1>
            <p class="manual__help" id="manual-help">
              Illeszd be vagy írd be a teljes QR-token szöveget. A rövid azonosító nem váltható be.
            </p>
            <textarea
              #field
              class="manual__field"
              aria-label="QR token"
              aria-describedby="manual-help"
              rows="6"
              spellcheck="false"
              autocomplete="off"
              autocapitalize="off"
              autocorrect="off"
              inputmode="text"
              [value]="tokenInput()"
              (input)="onInput($event)"
            ></textarea>
            @if (manualError(); as err) {
              <p class="manual__error" role="alert" data-testid="manual-error">{{ err }}</p>
            }
            @if (canPaste) {
              <button type="button" class="link link--wide" (click)="paste()">Beillesztés a vágólapról</button>
            }
          </section>
          <footer class="foot foot--row">
            <button type="button" class="btn btn--outline" (click)="showScan()">Vissza</button>
            <button
              type="button"
              class="btn btn--white"
              [disabled]="!tokenInput().trim() || checking()"
              (click)="checkManual()"
            >
              {{ checking() ? 'Ellenőrzés…' : 'Ellenőrzés' }}
            </button>
          </footer>
        }
      </div>

      @if (verdict(); as v) {
        <!-- ───── Verdict: the whole screen ───── -->
        <section
          class="verdict"
          [class]="'verdict verdict--' + v.tone"
          role="alert"
          aria-live="assertive"
          [attr.data-testid]="'verdict-' + v.kind"
        >
          <div class="verdict__body">
            <mat-icon class="verdict__glyph" aria-hidden="true">{{ v.glyph }}</mat-icon>
            <h1 class="verdict__title" data-testid="verdict-title">{{ v.title }}</h1>

            @if (v.kind === 'admitted') {
              @if (v.seat) {
                <p class="verdict__seat">{{ v.seat }}</p>
              }
              @if (v.holderName) {
                <p class="verdict__holder" data-testid="gate-holder">{{ v.holderName }}</p>
              }
              @if (v.typeLabel) {
                <span class="verdict__chip">{{ v.typeLabel }}</span>
              }
              @if (v.fixture) {
                <p class="verdict__meta">{{ v.fixture }}</p>
              }
            } @else if (v.kind === 'used') {
              @if (scannedWhenText(v); as when) {
                <p class="verdict__when" data-testid="scanned-when">Beolvasva: {{ when }}</p>
              }
              @if (v.seat || v.holderName || v.fixture) {
                <div class="verdict__panel">
                  @if (v.seat) {
                    <p class="verdict__seat">{{ v.seat }}</p>
                  }
                  @if (v.holderName) {
                    <p class="verdict__holder" data-testid="gate-holder">{{ v.holderName }}</p>
                  }
                  @if (v.fixture) {
                    <p class="verdict__meta">{{ v.fixture }}</p>
                  }
                  @if (v.typeLabel) {
                    <span class="verdict__chip">{{ v.typeLabel }}</span>
                  }
                </div>
              }
            }
            @if (v.instruction) {
              <p class="verdict__instruction" data-testid="verdict-instruction">{{ v.instruction }}</p>
            }
          </div>

          <div class="verdict__actions">
            @if (v.retryable) {
              <button type="button" class="btn btn--white" (click)="retry()">
                Újra
              </button>
              <button type="button" class="btn btn--ghost" (click)="next()">
                Vissza
              </button>
            } @else {
              <button type="button" class="btn btn--white" (click)="next()">
                Következő
              </button>
            }
          </div>
        </section>
      }
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .gate {
        --ok: color-mix(in srgb, var(--chip-paid) 76%, #000);
        --warn: var(--seat-locked);
        --bad: var(--seat-sold);
        --down: color-mix(in srgb, var(--ink) 80%, #fff);
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        background: var(--ink);
        color: #fff;
        font-family: var(--font-body);
        overflow: hidden;
        padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
          env(safe-area-inset-left);
        /* No pull-to-refresh, no text selection: nothing here should move by accident. */
        overscroll-behavior: none;
        user-select: none;
        -webkit-user-select: none;
        touch-action: manipulation;
      }
      .screen {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      /* Top bar */
      .bar {
        padding: 14px 16px 10px;
      }
      .bar__row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .live {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 14px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--on-brand-lead);
      }
      .live__dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #4ade80;
        box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.25);
      }
      .live--off {
        color: #fff;
      }
      .live--off .live__dot {
        background: #f87171;
        box-shadow: 0 0 0 4px rgba(248, 113, 113, 0.3);
      }
      .count {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
      }
      .count strong {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 28px;
        line-height: 1;
      }
      .count small {
        font-size: 13px;
        color: var(--on-brand-lead);
      }
      .fixture {
        margin: 8px 0 0;
        display: flex;
        flex-wrap: wrap;
        gap: 2px 10px;
        align-items: baseline;
      }
      .fixture__teams {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 17px;
      }
      .fixture__time {
        font-size: 14px;
        color: var(--on-brand-eyebrow);
      }

      /* Scanning */
      .scan {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        padding: 0 16px;
      }
      .scan__view {
        position: relative;
        flex: 1;
        min-height: 0;
        border-radius: 20px;
        overflow: hidden;
        background: #000;
      }
      .scan__video {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .frame {
        position: absolute;
        left: 50%;
        top: 50%;
        width: min(72%, 300px);
        aspect-ratio: 1;
        transform: translate(-50%, -50%);
        pointer-events: none;
      }
      .frame__c {
        position: absolute;
        width: 38px;
        height: 38px;
        border: 0 solid #fff;
      }
      .frame__c--tl { top: 0; left: 0; border-top-width: 5px; border-left-width: 5px; border-top-left-radius: 14px; }
      .frame__c--tr { top: 0; right: 0; border-top-width: 5px; border-right-width: 5px; border-top-right-radius: 14px; }
      .frame__c--bl { bottom: 0; left: 0; border-bottom-width: 5px; border-left-width: 5px; border-bottom-left-radius: 14px; }
      .frame__c--br { bottom: 0; right: 0; border-bottom-width: 5px; border-right-width: 5px; border-bottom-right-radius: 14px; }
      .frame__line {
        position: absolute;
        left: 8px;
        right: 8px;
        top: 8%;
        height: 3px;
        border-radius: 2px;
        background: var(--on-brand-eyebrow);
        box-shadow: 0 0 14px 2px var(--brand-mid);
        animation: sweep 2.2s ease-in-out infinite alternate;
      }
      @keyframes sweep {
        to {
          top: 90%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .frame__line {
          animation: none;
          top: 50%;
        }
      }
      .scan__notice {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 24px;
        text-align: center;
        background: rgba(20, 18, 26, 0.88);
        font-size: 16px;
        line-height: 1.4;
      }
      .scan__notice p {
        margin: 0;
        max-width: 28ch;
      }
      .scan__notice mat-icon {
        width: 44px;
        height: 44px;
        font-size: 44px;
      }
      .scan__notice--busy {
        background: rgba(20, 18, 26, 0.7);
        font-size: 20px;
        font-weight: 600;
      }
      .scan__caption {
        margin: 14px 0 4px;
        text-align: center;
        font-size: 18px;
        font-weight: 600;
      }
      .scan__hint {
        margin: 0 0 4px;
        text-align: center;
        font-size: 13px;
        color: var(--on-brand-eyebrow);
      }

      /* Manual */
      .manual {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 6px 16px 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        user-select: text;
        -webkit-user-select: text;
      }
      .manual__title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 26px;
      }
      .manual__help {
        margin: 0;
        font-size: 15px;
        line-height: 1.4;
        color: var(--on-brand-lead);
      }
      .manual__field {
        width: 100%;
        box-sizing: border-box;
        min-height: 150px;
        padding: 14px;
        border: 2px solid var(--glass-outline);
        border-radius: var(--radius-block);
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
        font-size: 18px;
        line-height: 1.35;
        letter-spacing: 0.02em;
        word-break: break-all;
        resize: none;
      }
      .manual__field:focus {
        outline: 3px solid var(--on-brand-eyebrow);
        outline-offset: 2px;
      }
      .manual__error {
        margin: 0;
        padding: 10px 12px;
        border-radius: var(--radius-block);
        background: var(--bad);
        font-size: 15px;
      }

      /* Buttons */
      .foot {
        padding: 12px 16px 16px;
      }
      .foot--row {
        display: grid;
        grid-template-columns: 1fr 1.4fr;
        gap: 12px;
      }
      .btn {
        width: 100%;
        min-height: 64px;
        padding: 0 16px;
        border-radius: var(--radius-button);
        font: inherit;
        font-size: 19px;
        font-weight: 700;
        cursor: pointer;
        border: 2px solid transparent;
      }
      .btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
      .btn--outline {
        background: transparent;
        color: #fff;
        border-color: var(--glass-outline);
      }
      .btn--white {
        background: #fff;
        color: var(--ink);
      }
      .btn--ghost {
        background: transparent;
        color: #fff;
        border-color: rgba(255, 255, 255, 0.55);
      }
      .link {
        align-self: center;
        min-height: 44px;
        padding: 0 10px;
        background: none;
        border: 0;
        color: var(--on-brand-eyebrow);
        font: inherit;
        font-size: 15px;
        font-weight: 600;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }
      .link--wide {
        align-self: flex-start;
        padding: 0;
      }

      /* Verdict: fills the screen */
      .verdict {
        position: fixed;
        inset: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: calc(24px + env(safe-area-inset-top)) 20px calc(20px + env(safe-area-inset-bottom));
        color: #fff;
        --on-white: var(--ink);
      }
      .verdict--ok { background: var(--ok); --on-white: var(--ok); }
      .verdict--warn { background: var(--warn); color: var(--ink); --on-white: var(--ink); }
      .verdict--bad { background: var(--bad); --on-white: var(--bad); }
      .verdict--down { background: var(--down); --on-white: var(--ink); }
      .verdict__body {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        text-align: center;
      }
      .verdict__glyph {
        width: 112px;
        height: 112px;
        font-size: 112px;
      }
      .verdict__title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: clamp(30px, 10.2vw, 40px);
        line-height: 1.05;
        letter-spacing: 0.02em;
        overflow-wrap: anywhere;
      }
      .verdict__seat {
        margin: 0;
        font-size: 21px;
        font-weight: 600;
      }
      .verdict__holder {
        margin: 0;
        font-size: 24px;
        font-weight: 700;
        overflow-wrap: anywhere;
      }
      .verdict__meta {
        margin: 0;
        font-size: 15px;
        opacity: 0.9;
      }
      .verdict__when {
        margin: 0;
        font-size: 21px;
        font-weight: 700;
      }
      .verdict__chip {
        padding: 6px 16px;
        border-radius: 999px;
        font-size: 16px;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.55);
      }
      .verdict--warn .verdict__chip {
        background: rgba(20, 18, 26, 0.12);
        border-color: rgba(20, 18, 26, 0.5);
      }
      .verdict__panel {
        width: 100%;
        max-width: 420px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 16px;
        border-radius: var(--radius-block);
        background: rgba(20, 18, 26, 0.14);
      }
      .verdict__instruction {
        margin: 4px 0 0;
        max-width: 30ch;
        font-size: 19px;
        line-height: 1.35;
        font-weight: 600;
      }
      .verdict__actions {
        display: grid;
        gap: 10px;
      }
      .verdict .btn--white {
        color: var(--on-white);
      }
      .verdict--warn .btn--ghost {
        color: var(--ink);
        border-color: rgba(20, 18, 26, 0.6);
      }

      @media (max-height: 560px) {
        .verdict__glyph { width: 64px; height: 64px; font-size: 64px; }
        .verdict__body { gap: 8px; }
      }
    `,
  ],
})
export class GatePageComponent {
  private readonly tickets = inject(TicketsService);
  private readonly matches = inject(MatchesService);
  private readonly camera = inject(GateCamera);
  protected readonly feedback = inject(GateFeedback);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly mode = signal<Mode>('scan');
  protected readonly verdict = signal<Verdict | null>(null);
  protected readonly checking = signal(false);
  protected readonly cameraState = signal<CameraState>('starting');
  protected readonly tokenInput = signal('');
  protected readonly manualError = signal<string | null>(null);
  protected readonly admitted = signal(readAdmitted());
  private pressReady = signal(false);
  private readonly browserOnline = signal(navigator.onLine);
  private readonly serverReachable = signal(true);
  private readonly match = signal<MatchResource | null>(null);

  /** The dot: green only while the device is online and the server has been answering. */
  protected readonly live = computed(() => this.browserOnline() && this.serverReachable());

  protected readonly cameraFailure = computed(() => {
    const state = this.cameraState();
    return state === 'on' || state === 'starting' ? null : CAMERA_MESSAGES[state];
  });

  protected readonly fixture = computed(() => {
    const m = this.match();
    return m ? { teams: `${m.homeTeam} – ${m.awayTeam}`, kickoff: whenLabel(m.kickoffAt, new Date()) } : null;
  });

  protected readonly canPaste = typeof navigator.clipboard?.readText === 'function';

  private session: CameraSession | null = null;
  private cameraGeneration = 0;
  private readonly guard = new RepeatGuard();
  private lastToken: string | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private primed = false;

  constructor() {
    // The camera runs only while the scanning view (and so its <video>) exists.
    effect(() => {
      const video = this.videoRef()?.nativeElement;
      const scanning = this.mode() === 'scan';
      untracked(() => {
        if (video && scanning) void this.startCamera(video);
        else this.stopCamera();
      });
    });

    const wakeLock = new ScreenWakeLock(this.document);
    wakeLock.acquire();
    const online = (): void => {
      this.browserOnline.set(true);
      this.serverReachable.set(true);
    };
    const offline = (): void => this.browserOnline.set(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    this.destroyRef.onDestroy(() => {
      wakeLock.release();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      this.stopCamera();
      clearTimeout(this.pressTimer);
    });

    this.matches
      .listAll({ silent: true })
      .pipe(catchError(() => of<MatchResource[]>([])))
      .subscribe((all) => this.match.set(currentMatch(all, Date.now())));
  }

  // ───── Camera ─────

  private async startCamera(video: HTMLVideoElement): Promise<void> {
    if (this.session) return;
    const generation = ++this.cameraGeneration;
    this.cameraState.set('starting');
    try {
      const session = await this.camera.start(
        video,
        (code) => this.onFrame(code),
        () => this.verdict() !== null || this.checking(),
      );
      if (generation !== this.cameraGeneration) {
        session.stop();
        return;
      }
      this.session = session;
      this.cameraState.set('on');
    } catch (e) {
      if (generation !== this.cameraGeneration) return;
      this.cameraState.set(e instanceof CameraError ? e.reason : 'unavailable');
    }
  }

  private stopCamera(): void {
    this.cameraGeneration++;
    this.session?.stop();
    this.session = null;
  }

  protected restartCamera(): void {
    const video = this.videoRef()?.nativeElement;
    if (video) void this.startCamera(video);
  }

  private onFrame(code: string | null): void {
    const fresh = this.guard.frame(code);
    if (fresh) this.submit(fresh);
  }

  // ───── Modes ─────

  protected showManual(): void {
    this.manualError.set(null);
    this.mode.set('manual');
  }

  protected showScan(): void {
    this.manualError.set(null);
    this.mode.set('scan');
  }

  protected onInput(event: Event): void {
    this.tokenInput.set((event.target as HTMLTextAreaElement).value);
    this.manualError.set(null);
  }

  protected async paste(): Promise<void> {
    try {
      this.tokenInput.set((await navigator.clipboard.readText()).trim());
      this.manualError.set(null);
    } catch {
      this.manualError.set('A vágólap nem olvasható. Illeszd be kézzel a mezőbe.');
    }
  }

  protected checkManual(): void {
    const token = this.tokenInput().trim();
    if (!token) return;
    if (!extractTicketId(token)) {
      // Typed or pasted by hand: point at the mistake instead of a full-screen refusal.
      this.manualError.set('Ez nem érvényes QR-token. Ellenőrizd, hogy a teljes szöveget illesztetted be.');
      return;
    }
    this.submit(token);
  }

  /** Any touch primes audio, so the first verdict can make a sound. */
  protected onTouch(): void {
    if (this.feedback.needsTap() || !this.primed) {
      this.primed = true;
      this.feedback.prime();
    }
  }

  // ───── Checking a ticket ─────

  private submit(token: string): void {
    if (this.checking() || this.verdict()) return;
    this.lastToken = token;

    // No offline mode: without the server there is no way to know whether the
    // ticket was already used at another gate, so nobody is admitted.
    if (!this.browserOnline()) {
      this.show(verdictFromFailure(0));
      return;
    }
    const ticketId = extractTicketId(token);
    if (!ticketId) {
      this.show(verdictNotATicket());
      return;
    }

    this.checking.set(true);
    this.tickets
      .scan(ticketId, token)
      .pipe(timeout(SCAN_TIMEOUT_MS))
      .subscribe({
        next: (res: TicketScanResponse) => {
          this.checking.set(false);
          this.serverReachable.set(true);
          this.show(verdictFromResponse(res));
        },
        error: (err: unknown) => {
          this.checking.set(false);
          const status = err instanceof HttpErrorResponse ? err.status : 504;
          if (status === 0 || status >= 500) this.serverReachable.set(false);
          this.show(verdictFromFailure(status));
        },
      });
  }

  private show(v: Verdict): void {
    this.verdict.set(v);
    this.feedback.play(isAdmission(v));
    if (isAdmission(v)) this.bumpAdmitted();
    // A stray tap must not dismiss a verdict before it was seen.
    this.pressReady.set(false);
    clearTimeout(this.pressTimer);
    this.pressTimer = setTimeout(() => this.pressReady.set(true), PRESS_GUARD_MS);
  }

  protected scannedWhenText(v: Verdict): string | undefined {
    return whenLabel(v.scannedAt, new Date());
  }

  /** "Következő": back to scanning with a clean slate. */
  protected next(): void {
    if (!this.pressReady()) return; // a stray tap right as the verdict appears
    this.verdict.set(null);
    this.lastToken = null;
    this.tokenInput.set('');
    this.manualError.set(null);
  }

  /** "Újra": the check never happened, so run it again for the same code. */
  protected retry(): void {
    if (!this.pressReady()) return;
    const token = this.lastToken;
    this.verdict.set(null);
    if (token) this.submit(token);
  }

  private bumpAdmitted(): void {
    const n = this.admitted() + 1;
    this.admitted.set(n);
    try {
      sessionStorage.setItem(ADMITTED_KEY, String(n));
    } catch {
      // Storage blocked: the count just restarts on reload.
    }
  }
}

function readAdmitted(): number {
  try {
    const n = Number(sessionStorage.getItem(ADMITTED_KEY));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/**
 * The match the gate is most likely working: the earliest one that has not
 * finished (kickoff up to four hours ago counts as still on).
 */
export function currentMatch(all: readonly MatchResource[], now: number): MatchResource | null {
  return (
    all
      .filter(
        (m) =>
          !IGNORED_MATCH_STATUSES.includes(m.status) &&
          new Date(m.kickoffAt).getTime() >= now - MATCH_WINDOW_AFTER_MS,
      )
      .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))[0] ?? null
  );
}
