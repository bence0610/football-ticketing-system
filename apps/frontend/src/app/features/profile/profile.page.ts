import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import { Subscription, catchError, firstValueFrom, interval, of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import {
  LoyaltySnapshotResponse,
  TIER_COLORS,
  TIER_LABELS,
  TRANSACTION_SOURCE_LABELS,
} from '../../core/models/loyalty.models';
import { SeasonPassResponse } from '../../core/models/season-pass.models';
import { TICKET_STATUS_LABELS, TicketResponse } from '../../core/models/ticket.models';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { MatchResource, MatchesService } from '../../core/services/matches.service';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import { TicketsService } from '../../core/services/tickets.service';
import { withArticle } from '../../shared/utils/hungarian-article';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';
import { UserProfile } from '../../shared/models/auth.model';
import { WaitlistEntry } from '../../shared/models/waitlist.model';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { WaitlistApiService } from '../../shared/services/waitlist.api.service';
import {
  LoanInitiationDialogComponent,
  LoanInitiationDialogData,
  LoanInitiationDialogResult,
} from './components/loan-initiation-dialog/loan-initiation-dialog.component';
import { SeasonPassCardComponent } from './components/season-pass-card.component';
import {
  TicketRowComponent,
  openTicketQr,
  seatText,
} from './components/ticket-row.component';
import { WaitlistCardComponent } from './components/waitlist-card/waitlist-card.component';

const WAITLIST_POLL_MS = 5_000;
/** A match still counts as "next" for this long after kickoff. */
const MATCH_GRACE_MS = 3 * 60 * 60 * 1000;

type TabId = 'active' | 'used' | 'passes';

/** Hungarian "how long until" label, e.g. `3 nap múlva`, `2 óra múlva`. */
export function untilLabel(kickoffIso: string, now: number): string {
  const diff = new Date(kickoffIso).getTime() - now;
  if (diff <= 0) return 'Most zajlik';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} perc múlva`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} óra múlva`;
  return `${Math.floor(hours / 24)} nap múlva`;
}

@Component({
  selector: 'kte-profile-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    HufCurrencyPipe,
    SeasonPassCardComponent,
    TicketRowComponent,
    WaitlistCardComponent,
  ],
  template: `
    <section class="page">
      @if (loading()) {
        <div class="loader" role="status" aria-live="polite">
          <mat-spinner diameter="48" />
          <span>Profil betöltése...</span>
        </div>
      } @else {
        @if (profile(); as user) {
        <div class="layout">
          <div class="main">
            <!-- ───── Next match ───── -->
            <div>
              <div class="section-head">
                <h2 class="section-title">A következő mérkőzésed</h2>
                @if (nextTicket(); as t) {
                  <span class="until" data-testid="until">{{ until(t) }}</span>
                }
              </div>

              @if (nextTicket(); as t) {
                <article class="next" data-testid="next-match">
                  <header class="next__head">
                    <div>
                      <h3 class="next__fixture">{{ t.match.homeTeam }} – {{ t.match.awayTeam }}</h3>
                      <p class="next__sub">
                        {{ t.match.kickoffAt | date: 'yyyy. MMMM d., HH:mm' : '' : 'hu-HU' }}
                        · {{ t.match.venue }}
                      </p>
                    </div>
                    <span class="next__chip">{{ statusLabel(t) }}</span>
                  </header>
                  <div class="next__body">
                    <button type="button" class="qr-btn" (click)="openQr(t)">
                      <mat-icon>qr_code_2</mat-icon>
                      <span>QR mutatása</span>
                    </button>
                    <dl class="facts">
                      <div>
                        <dt>Ülés</dt>
                        <dd>{{ seat(t) }}</dd>
                      </div>
                      <div>
                        <dt>Fizetett ár</dt>
                        <dd>{{ price(t) }}</dd>
                      </div>
                      <div>
                        <dt>Jegy típusa</dt>
                        <dd>{{ sourceLabel(t) }}</dd>
                      </div>
                      <div>
                        <dt>Kategória</dt>
                        <dd>{{ t.seat.category }}</dd>
                      </div>
                    </dl>
                  </div>
                  @if (t.source === 'loan') {
                    <p class="next__loan" data-testid="borrowed-badge">
                      <mat-icon>swap_horiz</mat-icon> Kölcsönkapott belépő – más bérlete
                    </p>
                  }
                  <footer class="next__foot">
                    @if (lendablePass(t); as p) {
                      <button
                        mat-stroked-button
                        type="button"
                        class="next__lend"
                        (click)="openLoan(p, t.match.id)"
                      >
                        Átadás másnak
                      </button>
                    }
                    <span class="next__note">A QR-kódra csak a kapunál van szükség.</span>
                  </footer>
                </article>
              } @else {
                <div class="empty-next" data-testid="next-empty">
                  <mat-icon>event_available</mat-icon>
                  @if (nextOnSale(); as m) {
                    <div class="empty-next__text">
                      <strong>Nincs közelgő mérkőzésed.</strong>
                      <span>
                        Következő mérkőzés: {{ m.homeTeam }} – {{ m.awayTeam }},
                        {{ m.kickoffAt | date: 'MMMM d., HH:mm' : '' : 'hu-HU' }}.
                      </span>
                    </div>
                    <a
                      mat-flat-button
                      color="primary"
                      [routerLink]="['/stadium']"
                      [queryParams]="{ matchId: m.id }"
                    >
                      Jegyet veszek
                    </a>
                  } @else {
                    <div class="empty-next__text">
                      <strong>Nincs közelgő mérkőzésed.</strong>
                      <span>Jelenleg egyetlen mérkőzésre sincs jegyértékesítés.</span>
                    </div>
                  }
                </div>
              }
            </div>

            <!-- ───── Tabs ───── -->
            <div>
              <div class="tabs" role="tablist" aria-label="Jegyek és bérletek">
                @for (tab of tabs(); track tab.id) {
                  <button
                    type="button"
                    role="tab"
                    class="tab"
                    [id]="'tab-' + tab.id"
                    [class.tab--on]="activeTab() === tab.id"
                    [attr.aria-selected]="activeTab() === tab.id"
                    [attr.aria-controls]="'panel-' + tab.id"
                    [tabIndex]="activeTab() === tab.id ? 0 : -1"
                    (click)="activeTab.set(tab.id)"
                    (keydown)="onTabKey($event)"
                  >
                    {{ tab.label }} <span class="tab__count">{{ tab.count }}</span>
                  </button>
                }
              </div>

              <div
                class="list"
                role="tabpanel"
                [id]="'panel-' + activeTab()"
                [attr.aria-labelledby]="'tab-' + activeTab()"
              >
                @switch (activeTab()) {
                  @case ('active') {
                    @if (activeTickets().length === 0) {
                      <p class="empty">Még nincs aktív jegyed.</p>
                    }
                    @for (ticket of activeTickets(); track ticket.id) {
                      <kte-ticket-row [ticket]="ticket" />
                    }
                  }
                  @case ('used') {
                    @if (pastTickets().length === 0) {
                      <p class="empty">Még nincs felhasznált vagy lezárult jegyed.</p>
                    }
                    @for (ticket of pastTickets(); track ticket.id) {
                      <kte-ticket-row [ticket]="ticket" />
                    }
                  }
                  @case ('passes') {
                    @if (loadingPasses()) {
                      <div class="loader loader--sm"><mat-spinner diameter="32" /></div>
                    } @else if (passes().length === 0) {
                      <p class="empty">Még nincs bérleted.</p>
                    }
                    @for (pass of passes(); track pass.id) {
                      <kte-season-pass-card
                        [pass]="pass"
                        [myTickets]="tickets()"
                        (changed)="reloadPasses()"
                      />
                    }
                  }
                }
              </div>
            </div>

            @if (waitlistEntries().length > 0) {
              <div>
                <h2 class="section-title">Várólista</h2>
                <div class="list">
                  @for (entry of waitlistEntries(); track entry.id) {
                    <kte-waitlist-card [entry]="entry" (changed)="reloadWaitlist()" />
                  }
                </div>
              </div>
            }
          </div>

          <!-- ───── Sidebar ───── -->
          <aside class="side" aria-label="Fiók és hűségprogram">
            <section class="card tier" [style.--tier]="tierColor()" data-testid="tier-card">
              <div class="tier__head">
                <mat-icon class="tier__star">star</mat-icon>
                <div>
                  <div class="tier__name">{{ tierLabel() }}</div>
                  @if (discount() > 0) {
                    <div class="tier__discount">{{ discount() }}% kedvezmény</div>
                  }
                </div>
              </div>
              <div class="tier__body">
                <div class="tier__points">
                  <strong>{{ user.loyaltyPoints }}</strong> pont
                </div>
                @if (snapshot(); as s) {
                  @if (s.nextTier) {
                    <div
                      class="bar"
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      [attr.aria-valuenow]="progress()"
                      aria-label="Haladás a következő szintig"
                    >
                      <div class="bar__fill" [style.width.%]="progress()"></div>
                    </div>
                    <p class="tier__next">
                      Még {{ s.pointsToNextTier }} pont {{ withArticle(s.nextTier.label) }} szintig
                    </p>
                  } @else {
                    <p class="tier__next" data-testid="top-tier">
                      Elérted a legmagasabb szintet.
                    </p>
                  }
                }
              </div>
            </section>

            <section class="card">
              <h2 class="card__title">Honnan jöttek a pontok</h2>
              @if (ledger().length === 0) {
                <p class="muted">Még nincs pontmozgásod.</p>
              } @else {
                <ul class="ledger">
                  @for (tx of ledger(); track tx.id) {
                    <li>
                      <div class="ledger__text">
                        <span class="ledger__reason">{{ reason(tx.source) }}</span>
                        <span class="ledger__date">
                          {{ tx.createdAt | date: 'yyyy. MMM d.' : '' : 'hu-HU' }}
                        </span>
                      </div>
                      <span
                        class="ledger__amt"
                        [class.ledger__amt--neg]="tx.points < 0"
                        [class.ledger__amt--pos]="tx.points > 0"
                      >
                        {{ tx.points > 0 ? '+' : tx.points < 0 ? '−' : '' }}{{ abs(tx.points) }}
                      </span>
                    </li>
                  }
                </ul>
              }
              <p class="muted muted--note">
                Minden tétel lekönyvelt tranzakció; ugyanarra a hivatkozásra a pont nem írható jóvá
                kétszer.
              </p>
            </section>

            @if (sidebarPass(); as p) {
              <section class="card pass" data-testid="pass-card">
                <div class="pass__row">
                  <div class="pass__sq" aria-hidden="true"><mat-icon>event_seat</mat-icon></div>
                  <div>
                    <div class="pass__season">{{ p.seasonLabel }}</div>
                    <div class="pass__seat">
                      @if (p.section) { {{ p.section }} szektor }
                      @if (p.seatLabel) { · {{ p.seatLabel }} }
                    </div>
                    <div class="muted">
                      @if (homeMatchesLeft() !== null) {
                        {{ homeMatchesLeft() }} hazai mérkőzés van hátra
                      }
                    </div>
                  </div>
                </div>
                <p class="pass__tint">
                  A helyet egyetlen mérkőzésre át tudod adni valakinek – ez a bérletedet nem
                  érinti.
                </p>
                <button mat-stroked-button type="button" class="full" (click)="openLoan(p)">
                  Hely átadása egy meccsre
                </button>
              </section>
            }

            <section class="card">
              <h2 class="card__title">Fiók</h2>
              <dl class="acct">
                <div>
                  <dt>Név</dt>
                  <dd>{{ user.lastName }} {{ user.firstName }}</dd>
                </div>
                <div>
                  <dt>E-mail</dt>
                  <dd class="acct__email">{{ user.email }}</dd>
                </div>
                <div>
                  <dt>Tag ezóta</dt>
                  <dd>{{ user.createdAt | date: 'yyyy. MMMM' : '' : 'hu-HU' }}</dd>
                </div>
              </dl>
              <button mat-stroked-button type="button" class="full" (click)="logout()">
                <mat-icon>logout</mat-icon>
                Kijelentkezés
              </button>
            </section>
          </aside>
        </div>
        }
      }
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      .page {
        max-width: 1120px;
        margin: 0 auto;
        padding: 24px 16px 48px;
      }
      .loader {
        display: flex;
        align-items: center;
        gap: 12px;
        justify-content: center;
        padding: 32px;
      }
      .loader--sm { padding: 16px; }

      .layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 340px;
        gap: 24px;
        align-items: start;
      }
      .main, .side { display: flex; flex-direction: column; gap: 24px; min-width: 0; }
      .side { gap: 16px; }

      .section-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .section-title {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 20px;
        color: var(--ink);
      }
      .section-head .section-title { margin: 0; }
      .until { font-size: 14px; font-weight: 600; color: var(--brand-mid); white-space: nowrap; }

      /* Next match card */
      .next {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        overflow: hidden;
      }
      .next__head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        padding: 18px 20px;
        background: var(--brand-deep);
        color: #fff;
      }
      .next__fixture {
        margin: 0;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 22px;
        line-height: 1.2;
      }
      .next__sub { margin: 4px 0 0; font-size: 14px; color: var(--on-brand-eyebrow); }
      .next__chip {
        flex: none;
        padding: 4px 12px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        background: var(--glass);
        border: 1px solid var(--glass-outline);
        color: #fff;
        white-space: nowrap;
      }
      .next__body {
        display: grid;
        grid-template-columns: 132px 1fr;
        gap: 20px;
        padding: 20px;
        align-items: center;
      }
      .qr-btn {
        width: 132px;
        height: 132px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 2px solid var(--brand-deep);
        border-radius: var(--radius-block);
        background: var(--brand-tint);
        color: var(--brand-deep);
        font: inherit;
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
      }
      .qr-btn:hover { background: #fff; }
      .qr-btn mat-icon { width: 56px; height: 56px; font-size: 56px; }
      .facts {
        margin: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px 20px;
      }
      .facts dt, .acct dt {
        font-size: 12px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .facts dd, .acct dd { margin: 2px 0 0; font-weight: 600; color: var(--ink); }
      .next__loan {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 0 20px 14px;
        font-size: 13px;
        font-weight: 600;
        color: var(--seat-pass);
      }
      .next__loan mat-icon { font-size: 18px; width: 18px; height: 18px; }
      .next__foot {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        padding: 14px 20px;
        border-top: 1px solid var(--border-light);
      }
      .next__note { font-size: 13px; color: var(--muted); }
      .empty-next {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
        padding: 20px;
        background: var(--brand-tint);
        border: 1px dashed var(--brand-mid);
        border-radius: var(--radius-card);
      }
      .empty-next > mat-icon { color: var(--brand-deep); width: 32px; height: 32px; font-size: 32px; }
      .empty-next__text { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 2px; }
      .empty-next__text span { color: var(--muted); font-size: 14px; }

      /* Tabs */
      .tabs {
        display: flex;
        border-bottom: 1px solid var(--border);
        overflow-x: auto;
      }
      .tab {
        flex: 1 1 0;
        min-height: var(--min-target);
        padding: 0 8px;
        border: 0;
        border-bottom: 2.5px solid transparent;
        margin-bottom: -1px;
        background: none;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: var(--muted);
        cursor: pointer;
        white-space: nowrap;
      }
      .tab--on { color: var(--brand-deep); border-bottom-color: var(--brand-deep); }
      .tab__count { margin-left: 4px; font-weight: 500; color: var(--faint); }
      .list { display: grid; gap: 10px; padding-top: 14px; }
      .empty { margin: 0; padding: 24px; text-align: center; color: var(--muted); }

      /* Cards */
      .card {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
        padding: 18px;
      }
      .card__title {
        margin: 0 0 12px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 16px;
      }
      .muted { color: var(--muted); font-size: 13px; margin: 0; }
      .muted--note { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-light); }
      .full { width: 100%; }

      .tier { padding: 0; overflow: hidden; --tier: var(--seat-pass); }
      .tier__head {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 18px;
        background: color-mix(in srgb, var(--tier) 16%, #fff);
      }
      .tier__star { width: 44px; height: 44px; font-size: 44px; color: var(--tier); }
      .tier__name { font-family: var(--font-display); font-weight: 800; font-size: 26px; line-height: 1.1; color: var(--ink); }
      .tier__discount { font-size: 14px; color: var(--ink); margin-top: 2px; }
      .tier__body { padding: 16px 18px 18px; }
      .tier__points { font-size: 14px; color: var(--muted); }
      .tier__points strong { font-family: var(--font-display); font-size: 24px; color: var(--ink); }
      .bar { height: 8px; margin-top: 10px; border-radius: 999px; background: var(--border-light); overflow: hidden; }
      .bar__fill { height: 100%; background: var(--tier); border-radius: 999px; }
      .tier__next { margin: 8px 0 0; font-size: 13px; color: var(--muted); }

      .ledger { list-style: none; margin: 0; padding: 0; }
      .ledger li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 10px 0;
        border-bottom: 1px solid var(--border-light);
      }
      .ledger li:last-child { border-bottom: 0; }
      .ledger__text { display: flex; flex-direction: column; min-width: 0; }
      .ledger__reason { font-weight: 600; font-size: 14px; }
      .ledger__date { font-size: 12px; color: var(--muted); }
      .ledger__amt { font-weight: 700; font-variant-numeric: tabular-nums; }
      .ledger__amt--pos { color: var(--chip-paid); }
      .ledger__amt--neg { color: var(--chip-expired); }

      .pass__row { display: flex; gap: 12px; align-items: center; }
      .pass__sq {
        flex: none;
        width: 48px;
        height: 48px;
        border-radius: var(--radius-block);
        background: var(--seat-pass);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .pass__season { font-family: var(--font-display); font-weight: 700; }
      .pass__seat { font-size: 14px; }
      .pass__tint {
        margin: 14px 0;
        padding: 10px 12px;
        border-radius: var(--radius-block);
        background: color-mix(in srgb, var(--seat-pass) 10%, #fff);
        font-size: 13px;
        color: var(--ink);
      }

      .acct { margin: 0 0 14px; display: grid; gap: 10px; }
      .acct__email { overflow-wrap: anywhere; }

      @media (max-width: 860px) {
        .layout { grid-template-columns: minmax(0, 1fr); }
      }
      @media (max-width: 480px) {
        .page { padding: 16px 16px 40px; }
        .next__head { flex-direction: column; }
        .next__body { grid-template-columns: 1fr; justify-items: center; }
        .facts { width: 100%; }
        .section-head { flex-wrap: wrap; }
        .tab { font-size: 13px; padding: 0 2px; }
        .tab__count { margin-left: 3px; }
      }
    `,
  ],
})
export class ProfilePageComponent implements OnInit {
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly passesApi = inject(SeasonPassesService);
  private readonly ticketsService = inject(TicketsService);
  private readonly loyaltyService = inject(LoyaltyService);
  private readonly matchesService = inject(MatchesService);
  private readonly waitlistApi = inject(WaitlistApiService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadingPasses = signal(true);
  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly tickets = signal<readonly TicketResponse[]>([]);
  protected readonly passes = signal<readonly SeasonPassResponse[]>([]);
  protected readonly waitlistEntries = signal<readonly WaitlistEntry[]>([]);
  protected readonly snapshot = signal<LoyaltySnapshotResponse | null>(null);
  private readonly matches = signal<readonly MatchResource[]>([]);
  protected readonly activeTab = signal<TabId>('active');

  /** Fixed at load: the countdown is a "from now" hint, not a live ticker. */
  private readonly now = Date.now();

  protected readonly activeTickets = computed(() =>
    this.tickets().filter((t) => t.status === 'paid' || t.status === 'pending_payment'),
  );
  protected readonly pastTickets = computed(() =>
    this.tickets().filter((t) => t.status !== 'paid' && t.status !== 'pending_payment'),
  );

  protected readonly tabs = computed<readonly { id: TabId; label: string; count: number }[]>(() => [
    { id: 'active', label: 'Aktív jegyek', count: this.activeTickets().length },
    { id: 'used', label: 'Felhasznált', count: this.pastTickets().length },
    { id: 'passes', label: 'Bérletek', count: this.passes().length },
  ]);

  /** Earliest paid ticket whose match has not finished yet. */
  protected readonly nextTicket = computed(() => {
    const cutoff = this.now - MATCH_GRACE_MS;
    return (
      this.tickets()
        .filter((t) => t.status === 'paid' && new Date(t.match.kickoffAt).getTime() >= cutoff)
        .sort((a, b) => a.match.kickoffAt.localeCompare(b.match.kickoffAt))[0] ?? null
    );
  });

  /** Earliest upcoming match that is on sale — the empty state points here. */
  protected readonly nextOnSale = computed(
    () =>
      this.matches()
        .filter((m) => m.status === 'on_sale' && new Date(m.kickoffAt).getTime() > this.now)
        .sort((a, b) => a.kickoffAt.localeCompare(b.kickoffAt))[0] ?? null,
  );

  protected readonly tierLabel = computed(() => {
    const user = this.profile();
    return user ? TIER_LABELS[user.loyaltyTier] : '';
  });
  protected readonly tierColor = computed(() => {
    const user = this.profile();
    return user ? TIER_COLORS[user.loyaltyTier] : TIER_COLORS.bronze;
  });
  protected readonly discount = computed(() => this.snapshot()?.tier.discountPercent ?? 0);

  protected readonly progress = computed(() => {
    const s = this.snapshot();
    if (!s?.nextTier) return 100;
    const span = s.nextTier.minPoints - s.tier.minPoints;
    if (span <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round(((s.points - s.tier.minPoints) / span) * 100)));
  });

  protected readonly ledger = computed(() =>
    [...(this.snapshot()?.recentTransactions ?? [])].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  );

  /** The pass shown in the sidebar: the user's active one, if any. */
  protected readonly sidebarPass = computed(
    () => this.passes().find((p) => p.status === 'active') ?? null,
  );

  protected readonly homeMatchesLeft = computed<number | null>(() => {
    const pass = this.sidebarPass();
    const matches = this.matches();
    if (!pass || matches.length === 0) return null;
    const until = new Date(pass.validUntil).getTime();
    return matches.filter((m) => {
      const t = new Date(m.kickoffAt).getTime();
      return m.isSeasonPassEligible && t > this.now && t <= until && m.status !== 'cancelled';
    }).length;
  });

  private pollSub: Subscription | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const [profile, tickets] = await Promise.all([
        firstValueFrom(this.api.me()),
        firstValueFrom(this.ticketsService.listMine()),
      ]);
      this.profile.set(profile);
      this.tickets.set(tickets);
    } finally {
      this.loading.set(false);
    }
    this.reloadPasses();
    this.reloadWaitlist();
    this.loyaltyService
      .getSnapshot()
      .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
      .subscribe((s) => this.snapshot.set(s));
    this.matchesService
      .listAll()
      .pipe(catchError(() => of<MatchResource[]>([])), takeUntilDestroyed(this.destroyRef))
      .subscribe((m) => this.matches.set(m));
  }

  protected until(t: TicketResponse): string {
    return untilLabel(t.match.kickoffAt, this.now);
  }
  protected statusLabel(t: TicketResponse): string {
    return TICKET_STATUS_LABELS[t.status];
  }
  protected seat(t: TicketResponse): string {
    return seatText(t);
  }
  protected price(t: TicketResponse): string {
    return Number(t.pricePaid) > 0
      ? new HufCurrencyPipe().transform(t.pricePaid)
      : 'Bérlet része';
  }
  protected sourceLabel(t: TicketResponse): string {
    return t.source === 'season_pass'
      ? 'Bérletes belépő'
      : t.source === 'loan'
        ? 'Kölcsönkapott belépő'
        : 'Egyedi jegy';
  }
  protected reason(source: keyof typeof TRANSACTION_SOURCE_LABELS): string {
    return TRANSACTION_SOURCE_LABELS[source] ?? 'Pontmozgás';
  }
  protected withArticle = withArticle;
  protected abs(n: number): number {
    return Math.abs(n);
  }

  protected openQr(t: TicketResponse): void {
    openTicketQr(this.dialog, t);
  }

  /** The pass this season-pass ticket belongs to, when its seat can be lent. */
  protected lendablePass(t: TicketResponse): SeasonPassResponse | null {
    if (t.source !== 'season_pass') return null;
    const kickoff = new Date(t.match.kickoffAt).getTime();
    return (
      this.passes().find(
        (p) =>
          p.status === 'active' &&
          new Date(p.validFrom).getTime() <= kickoff &&
          kickoff <= new Date(p.validUntil).getTime() &&
          !p.loans.some(
            (l) => l.matchId === t.match.id && (l.status === 'accepted' || l.status === 'pending'),
          ),
      ) ?? null
    );
  }

  protected openLoan(pass: SeasonPassResponse, initialMatchId?: string): void {
    this.dialog
      .open<LoanInitiationDialogComponent, LoanInitiationDialogData, LoanInitiationDialogResult>(
        LoanInitiationDialogComponent,
        {
          width: '560px',
          maxWidth: '92vw',
          panelClass: 'kte-loan-dialog-panel',
          backdropClass: 'kte-loan-dialog-backdrop',
          autoFocus: 'first-tabbable',
          restoreFocus: true,
          data: { pass, initialMatchId },
        },
      )
      .afterClosed()
      .subscribe((result) => {
        if (result?.created) {
          this.snack.open('Kölcsönzési meghívó elküldve.', 'Bezár', { duration: 3000 });
          this.reloadPasses();
        }
      });
  }

  protected onTabKey(event: KeyboardEvent): void {
    const ids = this.tabs().map((t) => t.id);
    const i = ids.indexOf(this.activeTab());
    let next = i;
    if (event.key === 'ArrowRight') next = (i + 1) % ids.length;
    else if (event.key === 'ArrowLeft') next = (i - 1 + ids.length) % ids.length;
    else return;
    event.preventDefault();
    this.activeTab.set(ids[next]);
    setTimeout(() => document.getElementById('tab-' + ids[next])?.focus());
  }

  protected reloadPasses(): void {
    this.loadingPasses.set(true);
    this.passesApi.listMine().subscribe({
      next: (passes) => {
        this.passes.set(passes);
        this.loadingPasses.set(false);
      },
      error: () => {
        this.passes.set([]);
        this.loadingPasses.set(false);
      },
    });
  }

  protected reloadWaitlist(): void {
    this.waitlistApi.listMine().subscribe({
      next: (entries) => {
        this.waitlistEntries.set(entries);
        this.adjustPolling(entries);
      },
      error: () => {
        this.waitlistEntries.set([]);
        this.stopPolling();
      },
    });
  }

  /**
   * Polls the waitlist every 5 seconds while at least one entry is NOTIFIED,
   * so the "felszabadult egy hely" countdown stays accurate without sockets.
   */
  private adjustPolling(entries: readonly WaitlistEntry[]): void {
    const hasNotified = entries.some((e) => e.status === 'notified');
    if (hasNotified && !this.pollSub) {
      this.pollSub = interval(WAITLIST_POLL_MS)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          this.waitlistApi.listMine().subscribe({
            next: (next) => {
              this.waitlistEntries.set(next);
              if (!next.some((e) => e.status === 'notified')) this.stopPolling();
            },
          });
        });
    } else if (!hasNotified && this.pollSub) {
      this.stopPolling();
    }
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  protected logout(): void {
    this.stopPolling();
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/']),
    });
  }
}
