import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import {
  LoyaltySnapshotResponse,
  LoyaltyTierResponse,
  LoyaltyTransactionResponse,
  TIER_LABELS,
} from '../../core/models/loyalty.models';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';
import { sectorName } from '../../shared/utils/sector-name';
import { MatchesActions, selectAllMatches } from '../../state/matches';
import { upcomingHomeMatches } from '../home/logic/match-availability';
import { MatchPricesService } from '../home/logic/match-prices.service';
import { loyaltyProgress } from '../home/logic/loyalty-progress';
import { withArticle } from '../../shared/utils/hungarian-article';
import { checkoutExample, earningRules, ledgerRow } from './loyalty-page.logic';

/** Rows the "more" button fetches at a time. */
const LEDGER_PAGE = 50;

@Component({
  selector: 'kte-loyalty-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, HufCurrencyPipe, MatIconModule, MatProgressSpinnerModule],
  template: `
    @if (loading()) {
      <div class="loader"><mat-spinner diameter="48"></mat-spinner></div>
    } @else {
    @if (snapshot(); as s) {
      <!-- Tier header: full-width band on --ink -->
      <section class="band" [attr.data-tier]="s.tier.tier" aria-labelledby="band-title">
        <div class="band__inner">
          <div class="band__tier">
            <span class="badge badge--lg" aria-hidden="true"><mat-icon>star</mat-icon></span>
            <div>
              <p class="eyebrow">Jelenlegi szinted</p>
              <h1 id="band-title" class="band__name" data-testid="loyalty-tier-badge">{{ s.tier.label }}</h1>
              <p class="band__discount">{{ discountText(s.tier.discountPercent) }}</p>
            </div>
          </div>

          <div class="band__points">
            <p class="band__total"><span data-testid="loyalty-points">{{ s.points }}</span> pont</p>
            @if (progress().isTopTier) {
              <p class="band__top">
                <mat-icon aria-hidden="true">emoji_events</mat-icon>
                Elérted a legmagasabb szintet, nincs több szint, amire gyűjthetnél.
              </p>
            } @else {
              <div
                class="bar"
                data-testid="loyalty-progress-bar"
                role="progressbar"
                [attr.aria-label]="'Haladás ' + withArticle(s.nextTier!.label) + ' szintig'"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="percent()"
                [attr.aria-valuetext]="percent() + '%'"
              >
                <div class="bar__fill" [style.width.%]="percent()" [hidden]="percent() === 0"></div>
              </div>
              <p class="band__left">
                Még <strong>{{ progress().pointsLeft }} pont</strong> {{ withArticle(s.nextTier!.label) }} szintig
              </p>
            }
          </div>

          @if (s.matchesAttended !== undefined) {
            <dl class="band__figures">
              <div>
                <dt>Meccs, amin jártál</dt>
                <dd data-testid="loyalty-attended">{{ s.matchesAttended }}</dd>
              </div>
            </dl>
          }
        </div>
      </section>

      <div class="page">
        <!-- A négy szint -->
        @if (tiers().length > 0) {
          <section aria-labelledby="tiers-title">
            <h2 id="tiers-title" class="h2">A négy szint</h2>
            <ul class="tiers">
              @for (t of tiers(); track t.tier) {
                <li class="tier" [attr.data-tier]="t.tier" [class.tier--current]="t.tier === s.tier.tier">
                  @if (t.tier === s.tier.tier) {
                    <span class="tier__ribbon">Itt vagy</span>
                  }
                  <span class="badge" aria-hidden="true"><mat-icon>star</mat-icon></span>
                  <h3 class="tier__name">{{ t.label }}</h3>
                  <p class="tier__min">{{ t.minPoints === 0 ? 'Induló szint' : t.minPoints + ' ponttól' }}</p>
                  <p class="tier__benefit">{{ discountText(t.discountPercent) }}</p>
                </li>
              }
            </ul>
          </section>
        }

        <div class="cols">
          <!-- Pontmozgások -->
          <section class="main" aria-labelledby="ledger-title">
            <h2 id="ledger-title" class="h2">Pontmozgások</h2>
            @if (rows().length === 0) {
              <p class="empty">Még nincs pontmozgásod.</p>
            } @else {
              <table class="ledger" data-testid="loyalty-transaction-table">
                <thead>
                  <tr>
                    <th scope="col">Esemény</th>
                    <th scope="col">Forrás</th>
                    <th scope="col" class="num">Pont</th>
                    <th scope="col" class="num">Egyenleg</th>
                  </tr>
                </thead>
                <tbody>
                  @for (r of rows(); track r.id) {
                    <tr data-testid="loyalty-transaction-row">
                      <td data-label="Esemény">
                        <span class="ledger__event">{{ r.event }}</span>
                        <span class="ledger__date">{{ r.createdAt | date: 'yyyy. MM. dd. HH:mm' }}</span>
                      </td>
                      <td data-label="Forrás">
                        <code class="mono">{{ r.source }}</code>
                        <code class="mono mono--ref">{{ r.reference ?? '—' }}</code>
                      </td>
                      <td data-label="Pont" class="num" [class.pos]="r.points > 0" [class.neg]="r.points < 0">
                        {{ r.pointsText }}
                      </td>
                      <td data-label="Egyenleg" class="num">{{ r.balance }}</td>
                    </tr>
                  }
                </tbody>
              </table>

              @if (hasMore()) {
                <button type="button" class="more" [disabled]="loadingMore()" (click)="loadMore()">
                  {{ loadingMore() ? 'Betöltés…' : 'Régebbi mozgások (' + remaining() + ')' }}
                </button>
              }
              @if (moreFailed()) {
                <p class="note note--err" role="alert">A régebbi mozgásokat nem sikerült betölteni, próbáld újra.</p>
              }
            }

            <p class="note">
              Minden jóváírás egy <strong>forrás és hivatkozás</strong> párral kerül a naplóba, és ez a páros az
              adatbázisban egyedi. Ezért ugyanaz a vásárlás nem írható jóvá kétszer, akkor sem, ha a fizetési
              értesítés kétszer érkezik meg.
            </p>
          </section>

          <!-- Sidebar -->
          <aside class="side">
            @if (s.earning; as e) {
              <section class="card" aria-labelledby="earn-title">
                <h2 id="earn-title" class="h3">Hogyan gyűjthetsz</h2>
                <ul class="rules">
                  @for (r of rules(); track r.label) {
                    <li>
                      <span class="rules__row"><span>{{ r.label }}</span><strong>{{ r.amount }}</strong></span>
                      @if (r.detail) {
                        <span class="rules__detail">{{ r.detail }}</span>
                      }
                    </li>
                  }
                </ul>
                <p class="card__fine">
                  Szezonzáráskor (június 30.) a pontjaid {{ e.carryoverPercent }}%-a marad meg, a többi lejár.
                </p>
                <p class="card__fine">
                  A jegyvásárlás pontjait a fizetés megerősítésekor írjuk jóvá, a belépés ehhez nem szükséges.
                </p>
              </section>
            }

            @if (example(); as x) {
              <section class="card" aria-labelledby="worth-title" data-testid="loyalty-example">
                <h2 id="worth-title" class="h3">Mit ér a szint a kasszánál</h2>
                <p class="card__fine card__fine--top">
                  Legolcsóbb hely a következő meccsen ({{ x.match }}), {{ x.sector }}:
                </p>
                <dl class="calc">
                  <div><dt>Jegy ára</dt><dd>{{ x.calc.price | hufCurrency }}</dd></div>
                  <div class="calc__disc">
                    <dt>{{ s.tier.label }} szint, {{ x.calc.percent }}%</dt>
                    <dd>{{ x.calc.discount > 0 ? '−' : '' }}{{ x.calc.discount | hufCurrency }}</dd>
                  </div>
                  <div class="calc__pay"><dt>Te fizetsz</dt><dd>{{ x.calc.pay | hufCurrency }}</dd></div>
                </dl>
                @if (s.tier.discountPercent === 0) {
                  <p class="card__fine">A Kék szint nem ad kedvezményt; a következő szinttől jár.</p>
                }
              </section>
            }

            <section class="note-card">
              <mat-icon aria-hidden="true">info</mat-icon>
              <p>
                A szintedhez tartozó kedvezmény az egyes meccsjegyek vásárlására vonatkozik, a szezonbérletekre
                nem. A pontok kedvezményt jelentenek, nem pénzt: nem válthatók készpénzre, és nem utalhatók át másik
                fiókra.
              </p>
            </section>
          </aside>
        </div>
      </div>
    } @else {
      <p class="empty page">A hűségadataidat most nem sikerült betölteni.</p>
    }
    }
  `,
  styles: [
    `
      :host {
        display: block;
        background: var(--page);
        color: var(--ink);
        font-family: var(--font-body);
      }
      .loader { display: flex; justify-content: center; padding: 64px; }

      /* ---- Tier badge (circle + star), per tier through data-tier ---- */
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: var(--tier-pill-bg);
        color: var(--tier-star);
        border: 2px solid var(--tier-pill-border);
      }
      .badge mat-icon { width: 24px; height: 24px; font-size: 24px; }
      .badge--lg { width: 86px; height: 86px; box-shadow: 0 0 0 4px var(--glass-outline); }
      .badge--lg mat-icon { width: 44px; height: 44px; font-size: 44px; }

      /* ---- Band on --ink ---- */
      .band {
        background: var(--ink);
        color: #fff;
        /* Tier fill tuned for a dark band: the page tokens are made for white. */
        --band-fill: var(--tier-fill);
      }
      .band[data-tier='bronze'] { --band-fill: var(--on-ink-nav); }
      .band[data-tier='platinum'] { --band-fill: var(--on-brand-eyebrow); }
      .band__inner {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 24px 40px;
        align-items: center;
      }
      .band__tier { display: flex; align-items: center; gap: 20px; }
      .eyebrow {
        margin: 0 0 4px;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--on-brand-eyebrow);
      }
      .band__name {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 800;
        font-size: 34px;
        line-height: 1.1;
      }
      .band__discount { margin: 6px 0 0; color: var(--on-ink-nav); font-size: 15px; }
      .band__total {
        margin: 0 0 12px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 26px;
      }
      .bar {
        height: 12px;
        border-radius: 999px;
        background: var(--glass);
        outline: 1px solid var(--divider-on-brand);
        overflow: hidden;
      }
      .bar__fill { height: 100%; border-radius: 999px; background: var(--band-fill); }
      .band__left { margin: 10px 0 0; font-size: 14px; color: var(--on-ink-nav); }
      .band__left strong { color: #fff; }
      .band__top {
        margin: 0;
        display: flex;
        gap: 8px;
        align-items: center;
        font-size: 15px;
        color: var(--on-brand-lead);
      }
      .band__figures { margin: 0; display: flex; gap: 32px; }
      .band__figures dt { font-size: 13px; color: var(--on-ink-nav); }
      .band__figures dd {
        margin: 4px 0 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 26px;
      }

      /* ---- Page ---- */
      .page { max-width: 1180px; margin: 0 auto; padding: 32px; }
      .h2 { margin: 0 0 16px; font-family: var(--font-display); font-weight: 800; font-size: 24px; }
      .h3 { margin: 0 0 12px; font-family: var(--font-display); font-weight: 700; font-size: 18px; }
      .empty { color: var(--muted); text-align: center; padding: 24px 0; }

      /* ---- Tier cards ---- */
      .tiers {
        list-style: none;
        margin: 0 0 40px;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 16px;
      }
      .tier {
        position: relative;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        padding: 28px 16px 20px;
        text-align: center;
      }
      .tier--current { border: 2px solid var(--tier-pill-border); padding: 27px 15px 19px; background: var(--tier-soft); }
      .tier__ribbon {
        position: absolute;
        top: -13px;
        left: 50%;
        transform: translateX(-50%);
        padding: 3px 14px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        background: var(--tier-pill-bg);
        color: var(--tier-pill-fg);
        border: 1.5px solid var(--tier-pill-border);
      }
      .tier .badge { width: 56px; height: 56px; margin-bottom: 12px; }
      .tier .badge mat-icon { width: 30px; height: 30px; font-size: 30px; }
      .tier__name { margin: 0; font-family: var(--font-display); font-weight: 800; font-size: 20px; }
      .tier__min { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
      .tier__benefit { margin: 8px 0 0; font-weight: 600; font-size: 15px; }

      /* ---- Two columns ---- */
      .cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 32px; align-items: start; }
      .main { min-width: 0; }
      .side { display: grid; gap: 16px; }

      /* ---- Ledger ---- */
      .ledger { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); }
      .ledger th {
        text-align: left;
        padding: 12px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--muted);
        background: var(--page);
        border-bottom: 1px solid var(--border);
      }
      .ledger td { padding: 12px 16px; border-bottom: 1px solid var(--border-light); vertical-align: top; font-size: 15px; }
      .ledger tr:last-child td { border-bottom: 0; }
      .ledger .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .ledger__event { display: block; font-weight: 600; }
      .ledger__date { display: block; margin-top: 2px; color: var(--muted); font-size: 13px; }
      .mono { display: block; font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
      .mono--ref { margin-top: 2px; color: var(--muted); }
      .pos { color: var(--chip-paid); font-weight: 600; }
      .neg { color: var(--chip-expired); font-weight: 600; }
      .more {
        margin-top: 12px;
        min-height: var(--min-target);
        padding: 0 20px;
        border: 1.5px solid var(--brand-deep);
        border-radius: var(--radius-button);
        background: var(--surface);
        color: var(--brand-deep);
        font: 600 15px var(--font-body);
        cursor: pointer;
      }
      .more:disabled { opacity: 0.6; cursor: default; }
      .note { margin: 16px 0 0; color: var(--muted); font-size: 14px; line-height: 1.55; }
      .note--err { color: var(--error-ink); }

      /* ---- Sidebar cards ---- */
      .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); padding: 20px; }
      .rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
      .rules__row { display: flex; justify-content: space-between; gap: 12px; }
      .rules__row strong { white-space: nowrap; color: var(--brand-deep); }
      .rules__detail { display: block; margin-top: 2px; color: var(--muted); font-size: 13px; }
      .card__fine { margin: 14px 0 0; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
      .card__fine--top { margin: 0 0 12px; }
      .calc { margin: 0; display: grid; gap: 8px; }
      .calc > div { display: flex; justify-content: space-between; gap: 12px; }
      .calc dt, .calc dd { margin: 0; }
      .calc dd { font-variant-numeric: tabular-nums; white-space: nowrap; }
      .calc__disc dd { color: var(--chip-paid); font-weight: 600; }
      .calc__pay { padding-top: 10px; border-top: 1px solid var(--border); font-weight: 700; font-size: 17px; }
      .note-card {
        display: flex;
        gap: 12px;
        padding: 16px;
        border-radius: var(--radius-card);
        background: var(--brand-tint);
        color: var(--ink);
        font-size: 14px;
        line-height: 1.5;
      }
      .note-card p { margin: 0; }
      .note-card mat-icon { flex: none; color: var(--brand-deep); }

      /* ---- Tablet ---- */
      @media (max-width: 960px) {
        .band__inner { grid-template-columns: auto minmax(0, 1fr); }
        .band__figures { grid-column: 1 / -1; }
        .cols { grid-template-columns: minmax(0, 1fr); }
      }

      /* ---- Phone: tier cards 2x2, ledger as stacked rows (no sideways scroll) ---- */
      @media (max-width: 640px) {
        .band__inner { grid-template-columns: minmax(0, 1fr); padding: 24px 16px; }
        .band__name { font-size: 28px; }
        .badge--lg { width: 72px; height: 72px; }
        .badge--lg mat-icon { width: 36px; height: 36px; font-size: 36px; }
        .page { padding: 24px 16px; }
        .tiers { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 12px; }

        .ledger, .ledger tbody, .ledger tr, .ledger td { display: block; }
        .ledger { background: transparent; border: 0; }
        .ledger thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
        .ledger tr {
          margin-bottom: 12px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius-block);
        }
        .ledger td {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 10px 14px;
          text-align: right;
        }
        .ledger td::before {
          content: attr(data-label);
          flex: none;
          color: var(--muted);
          font-size: 13px;
          font-weight: 600;
          text-align: left;
        }
        .ledger td > span, .ledger td > code { text-align: right; }
        .ledger td:first-child { display: block; text-align: left; }
        .ledger td:first-child::before { content: none; }
        .ledger td[data-label='Forrás'] > :first-of-type { margin-left: auto; }
        .ledger td[data-label='Forrás'] { flex-wrap: wrap; }
      }

      @media (prefers-reduced-motion: no-preference) {
        .bar__fill { transition: width 0.4s ease; }
      }
    `,
  ],
})
export class LoyaltyDashboardPageComponent implements OnInit {
  private readonly loyaltyService = inject(LoyaltyService);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);
  private readonly store = inject(Store);
  private readonly prices = inject(MatchPricesService);

  protected readonly withArticle = withArticle;

  protected readonly snapshot = signal<LoyaltySnapshotResponse | null>(null);
  protected readonly tiers = signal<LoyaltyTierResponse[]>([]);
  protected readonly loading = signal(true);

  /** Ledger rows: the snapshot's newest page, then whatever "more" appended. */
  private readonly extra = signal<LoyaltyTransactionResponse[]>([]);
  protected readonly loadingMore = signal(false);
  protected readonly moreFailed = signal(false);

  protected readonly rows = computed(() =>
    [...(this.snapshot()?.recentTransactions ?? []), ...this.extra()].map(ledgerRow),
  );
  protected readonly remaining = computed(() =>
    Math.max(0, (this.snapshot()?.totalTransactions ?? this.rows().length) - this.rows().length),
  );
  protected readonly hasMore = computed(() => this.remaining() > 0);

  protected readonly progress = computed(() => {
    const s = this.snapshot();
    return s ? loyaltyProgress(s) : { ratio: 0, pointsLeft: null, isTopTier: false };
  });
  protected readonly percent = computed(() => Math.round(this.progress().ratio * 100));

  protected readonly rules = computed(() => {
    const e = this.snapshot()?.earning;
    return e ? earningRules(e) : [];
  });

  /** The next on-sale home match, for a real sector price in the checkout example. */
  private readonly nextMatch = toSignal(
    this.store
      .select(selectAllMatches)
      .pipe(map((all) => upcomingHomeMatches(all, Date.now()).find((m) => m.status === 'on_sale') ?? null)),
    { initialValue: null },
  );
  private readonly nextMatchPrices = toSignal(
    toObservable(this.nextMatch).pipe(switchMap((m) => (m ? this.prices.forMatch(m.id) : of(null)))),
    { initialValue: null },
  );

  protected readonly example = computed(() => {
    const s = this.snapshot();
    const match = this.nextMatch();
    const sector = this.nextMatchPrices()?.sectors[0];
    if (!s || !match || !sector || !Number.isFinite(sector.minPrice) || sector.minPrice <= 0) {
      return null;
    }
    return {
      match: `${match.homeTeam} – ${match.awayTeam}`,
      sector: sectorName(sector.section, sector.name),
      calc: checkoutExample(sector.minPrice, s.tier.discountPercent),
    };
  });

  ngOnInit(): void {
    this.store.dispatch(MatchesActions.loadMatches());
    this.loyaltyService.getTiers().subscribe({
      next: (tiers) => this.tiers.set(tiers),
      error: () => this.tiers.set([]),
    });
    this.loyaltyService.getSnapshot().subscribe({
      next: (snap) => {
        this.snapshot.set(snap);
        this.loading.set(false);
        const userId = this.auth.user()?.id;
        const reached = userId
          ? this.loyaltyService.recordTierAndDetectUpgrade(userId, snap.tier.tier)
          : null;
        if (reached) {
          this.snack.open(`Új hűségszintet értél el: ${TIER_LABELS[reached]}`, 'Bezár', {
            duration: 5000,
            panelClass: ['kte-toast'],
          });
        }
      },
      error: () => this.loading.set(false),
    });
  }

  protected loadMore(): void {
    if (this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.moreFailed.set(false);
    this.loyaltyService.getTransactions(this.rows().length, LEDGER_PAGE).subscribe({
      next: (more) => {
        this.extra.update((cur) => [...cur, ...more]);
        this.loadingMore.set(false);
      },
      error: () => {
        this.moreFailed.set(true);
        this.loadingMore.set(false);
      },
    });
  }

  protected discountText(percent: number): string {
    return percent > 0 ? `${percent}% kedvezmény az egyes meccsjegyekből` : 'Nincs kedvezmény';
  }
}
