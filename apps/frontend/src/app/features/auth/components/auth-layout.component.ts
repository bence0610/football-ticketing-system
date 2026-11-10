import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export type AuthMode = 'login' | 'register' | 'reset';

interface Feature {
  readonly icon: string;
  readonly text: string;
}

interface BrandCopy {
  readonly title: string;
  readonly lead: string;
  readonly features: readonly Feature[];
}

/**
 * Every line below is something the system really does: QR codes per ticket,
 * the loyalty tiers and their discount, and lending a pass seat for one match.
 */
const COPY: Record<AuthMode, BrandCopy> = {
  login: {
    title: 'Jegyeid, bérleted és pontjaid egy helyen',
    lead: 'Jelentkezz be, hogy elérd a QR-kódjaidat, kezeld a bérletedet és gyűjtsd a hűségpontokat.',
    features: [
      { icon: 'qr_code_2', text: 'Minden jegyhez QR-kód jár – a kapunál csak ezt kell megmutatni.' },
      { icon: 'swap_horiz', text: 'A bérleted helyét egy-egy meccsre átadhatod másnak.' },
      { icon: 'stars', text: 'Hűségpontok és kedvezmény minden vásárlás után.' },
    ],
  },
  reset: {
    title: 'Új jelszó pár lépésben',
    lead: 'Nem veszett el semmi: a jegyeid, a bérleted és a pontjaid a fiókodhoz tartoznak.',
    features: [
      { icon: 'mail', text: 'Add meg az e-mail-címedet, és küldünk egy linket.' },
      { icon: 'timer', text: 'A link rövid ideig érvényes, és csak egyszer használható.' },
      { icon: 'lock', text: 'Az új jelszó beállítása után a többi eszközön megszűnik a bejelentkezés.' },
    ],
  },
  register: {
    title: 'Egy fiók, ahol minden jegyed és bérleted egy helyen van',
    lead: 'Pár adat elég a kezdéshez. Ezt kapod a fiókkal:',
    features: [
      { icon: 'qr_code_2', text: 'QR-kódos jegyeid és bérleted a profilodban.' },
      { icon: 'stars', text: 'Hűségpontok már a regisztrációért, később kedvezmény.' },
      { icon: 'swap_horiz', text: 'Bérletvásárlás, és a hely átadása egy-egy meccsre.' },
    ],
  },
};

/**
 * The split layout both auth pages share. The structure is identical on
 * /login and /register (same grid, same panel, form pinned to the same top
 * offset), so going from one to the other changes the content, not the page.
 *
 * The brand panel's optional last block (the next match on the login page) is
 * projected into `[brandExtra]`; a page that has nothing to show simply does not
 * project it, and no empty box is left behind.
 */
@Component({
  selector: 'kte-auth-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="auth">
      <aside class="auth__brand" aria-label="KTE Jegyportál">
        <div class="auth__glow" aria-hidden="true"></div>
        <svg class="auth__stadium" viewBox="0 0 800 160" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <g fill="#fff">
            <path d="M0 160V118l60-18 120-10h440l120 10 60 18v42z" />
            <path d="M40 160V96h720v64z" opacity=".55" />
            <path d="M120 96c60-34 140-46 280-46s220 12 280 46z" />
            <rect x="70" y="12" width="5" height="88" />
            <rect x="52" y="8" width="41" height="12" rx="2" />
            <rect x="725" y="12" width="5" height="88" />
            <rect x="707" y="8" width="41" height="12" rx="2" />
          </g>
        </svg>

        <div class="auth__inner">
          <div class="auth__logo">
            <svg class="auth__crest" width="88" height="100" viewBox="0 0 88 100" aria-hidden="true">
              <path
                d="M44 3 6 15v34c0 24 15 40 38 48 23-8 38-24 38-48V15z"
                fill="rgba(255,255,255,.1)"
                stroke="#fff"
                stroke-width="3"
                stroke-linejoin="round"
              />
              <text x="44" y="58" text-anchor="middle" font-family="Archivo, sans-serif" font-weight="800" font-size="24" fill="#fff">KTE</text>
            </svg>
            <span class="auth__wordmark">Jegyportál</span>
          </div>

          <h2 class="auth__title" data-testid="auth-brand-title">{{ copy.title }}</h2>
          <p class="auth__lead">{{ copy.lead }}</p>

          <ul class="auth__features">
            @for (f of copy.features; track f.icon) {
              <li>
                <mat-icon aria-hidden="true">{{ f.icon }}</mat-icon>
                <span>{{ f.text }}</span>
              </li>
            }
          </ul>

          <div class="auth__extra">
            <ng-content select="[brandExtra]" />
          </div>
        </div>
      </aside>

      <div class="auth__form">
        <div class="auth__form-inner">
          <ng-content />
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }

      .auth {
        display: grid;
        grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
        min-height: calc(100dvh - var(--header-h, 72px));
      }

      /* ── Brand panel ─────────────────────────────────────────────── */
      .auth__brand {
        position: relative;
        overflow: hidden;
        background: var(--brand-deep);
        color: #fff;
      }
      .auth__glow {
        position: absolute;
        inset: 0;
        background: radial-gradient(
          ellipse 80% 60% at 20% 15%,
          rgba(255, 255, 255, 0.16),
          rgba(255, 255, 255, 0) 70%
        );
      }
      .auth__stadium {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: auto;
        opacity: 0.1;
      }
      .auth__inner {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 0;
        height: 100%;
        padding: 56px 48px 48px;
        max-width: 560px;
        margin-left: auto;
      }
      .auth__logo { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
      .auth__wordmark {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 20px;
        letter-spacing: 0.02em;
      }
      .auth__title {
        margin: 36px 0 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 34px;
        line-height: 1.15;
        overflow-wrap: anywhere;
        /* Two lines on both pages, so the lines below start at the same height on each. */
        min-height: 2.3em;
      }
      .auth__lead {
        margin: 14px 0 0;
        font-size: 16px;
        line-height: 1.55;
        color: var(--on-brand-lead, rgba(255, 255, 255, 0.82));
      }
      .auth__features {
        list-style: none;
        margin: 28px 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      .auth__features li { display: flex; align-items: flex-start; gap: 12px; font-size: 15px; line-height: 1.45; }
      .auth__features mat-icon {
        flex: none;
        width: 36px;
        height: 36px;
        padding: 6px;
        box-sizing: border-box;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.12);
      }
      .auth__features span { padding-top: 6px; }
      .auth__extra { margin-top: auto; padding-top: 32px; }
      .auth__extra:empty { display: none; }

      /* ── Form side ───────────────────────────────────────────────── */
      .auth__form {
        background: var(--surface);
        display: flex;
        justify-content: center;
        padding: 64px 32px 48px;
      }
      .auth__form-inner { width: 100%; max-width: 420px; }

      /* ── Phone: the brand panel shrinks to a header, the form fills the rest ── */
      @media (max-width: 767px) {
        .auth { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 1fr; }
        .auth__inner { padding: 16px; max-width: none; height: auto; }
        .auth__logo { flex-direction: row; align-items: center; gap: 12px; }
        .auth__crest { width: 35px; height: 40px; }
        .auth__wordmark { font-size: 18px; }
        .auth__title { margin: 10px 0 0; font-size: 17px; min-height: 2.5em; }
        .auth__lead, .auth__features, .auth__extra { display: none; }
        .auth__stadium { display: none; }
        .auth__form { padding: 24px 16px 32px; }
      }
    `,
  ],
})
export class AuthLayoutComponent {
  @Input({ required: true }) mode: AuthMode = 'login';

  protected get copy(): BrandCopy {
    return COPY[this.mode];
  }
}
