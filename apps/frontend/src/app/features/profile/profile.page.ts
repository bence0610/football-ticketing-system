import { CommonModule } from '@angular/common';
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
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import { Subscription, firstValueFrom, interval } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { SeasonPassResponse } from '../../core/models/season-pass.models';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import {
  LoyaltyTier,
  UserProfile,
  UserTicket,
} from '../../shared/models/auth.model';
import { WaitlistEntry } from '../../shared/models/waitlist.model';
import { HufCurrencyPipe } from '../../shared/pipes/huf-currency.pipe';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { WaitlistApiService } from '../../shared/services/waitlist.api.service';
import { SeasonPassCardComponent } from './components/season-pass-card.component';
import { WaitlistCardComponent } from './components/waitlist-card/waitlist-card.component';

const TIER_LABEL: Readonly<Record<LoyaltyTier, string>> = {
  bronze: 'Bronz',
  silver: 'Ezüst',
  gold: 'Arany',
  platinum: 'Platina',
};

const TIER_COLOR: Readonly<Record<LoyaltyTier, string>> = {
  bronze: '#cd7f32',
  silver: '#9e9e9e',
  gold: '#ffc905',
  platinum: '#0a3d62',
};

const WAITLIST_POLL_MS = 5_000;

@Component({
  selector: 'kte-profile-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatCardModule,
    MatTabsModule,
    MatChipsModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    HufCurrencyPipe,
    SeasonPassCardComponent,
    WaitlistCardComponent,
  ],
  template: `
    <section class="kte-profile">
      @if (loading()) {
        <div class="kte-profile__loader" role="status" aria-live="polite">
          <mat-spinner diameter="48" />
          <span>Profil betöltése...</span>
        </div>
      } @else {
        @if (profile(); as user) {
        <mat-card class="kte-profile__hero" appearance="outlined">
          <mat-card-content class="kte-profile__hero-content">
            <div class="kte-profile__avatar" aria-hidden="true">
              {{ initials() }}
            </div>
            <div class="kte-profile__identity">
              <h1>{{ user.lastName }} {{ user.firstName }}</h1>
              <p>{{ user.email }}</p>
              @if (user.phoneNumber) {
                <p class="kte-profile__phone">
                  <mat-icon inline>phone</mat-icon>
                  {{ user.phoneNumber }}
                </p>
              }
            </div>
            <div class="kte-profile__loyalty">
              <mat-chip-set>
                <mat-chip
                  [style.background-color]="tierColor()"
                  [style.color]="user.loyaltyTier === 'gold' ? '#1a1a1a' : 'white'"
                  highlighted
                >
                  <mat-icon>workspace_premium</mat-icon>
                  {{ tierLabel() }}
                </mat-chip>
              </mat-chip-set>
              <strong>{{ user.loyaltyPoints }} pont</strong>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-tab-group dynamicHeight="true" mat-stretch-tabs="false">
          <mat-tab label="Aktív jegyek ({{ activeTickets().length }})">
            @if (activeTickets().length === 0) {
              <p class="kte-profile__empty">Még nincs aktív jegyed.</p>
            } @else {
              <div class="kte-profile__tickets">
                @for (ticket of activeTickets(); track ticket.id) {
                  <mat-card appearance="outlined" class="kte-profile__ticket">
                    <mat-card-header>
                      <mat-card-title>
                        {{ ticket.homeTeam }} – {{ ticket.awayTeam }}
                      </mat-card-title>
                      <mat-card-subtitle>
                        {{ ticket.kickoffAt | date: "yyyy. MMM d. HH:mm" : '' : 'hu' }}
                        · {{ ticket.venue }}
                      </mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content>
                      <dl class="kte-profile__ticket-grid">
                        <dt>Szektor</dt>
                        <dd>{{ ticket.section }}</dd>
                        <dt>Sor / Szék</dt>
                        <dd>{{ ticket.row }} / {{ ticket.seatNumber }}</dd>
                        <dt>Ár</dt>
                        <dd>{{ ticket.pricePaid | hufCurrency }}</dd>
                        <dt>QR azonosító</dt>
                        <dd class="kte-profile__qr">{{ ticket.qrCode }}</dd>
                      </dl>
                    </mat-card-content>
                  </mat-card>
                }
              </div>
            }
          </mat-tab>

          <mat-tab label="Vásárlási előzmények ({{ pastTickets().length }})">
            @if (pastTickets().length === 0) {
              <p class="kte-profile__empty">Még nincs lezárult mérkőzéshez tartozó jegyed.</p>
            } @else {
              <div class="kte-profile__history">
                @for (ticket of pastTickets(); track ticket.id) {
                  <mat-card appearance="outlined" class="kte-profile__history-row">
                    <mat-card-content>
                      <div class="kte-profile__history-meta">
                        <strong>{{ ticket.homeTeam }} – {{ ticket.awayTeam }}</strong>
                        <span>{{ ticket.kickoffAt | date: "yyyy. MMM d." : '' : 'hu' }}</span>
                      </div>
                      <div class="kte-profile__history-details">
                        <span>{{ ticket.section }} · sor {{ ticket.row }} · szék {{ ticket.seatNumber }}</span>
                        <span>{{ ticket.pricePaid | hufCurrency }}</span>
                      </div>
                    </mat-card-content>
                  </mat-card>
                }
              </div>
            }
          </mat-tab>

          <mat-tab label="Bérleteim ({{ passes().length }})">
            @if (loadingPasses()) {
              <div class="kte-profile__loader">
                <mat-spinner diameter="32" />
                <span>Bérletek betöltése...</span>
              </div>
            } @else if (passes().length === 0) {
              <p class="kte-profile__empty">Még nincs bérleted.</p>
            } @else {
              <div class="kte-profile__passes">
                @for (pass of passes(); track pass.id) {
                  <kte-season-pass-card [pass]="pass" (changed)="reloadPasses()" />
                }
              </div>
            }
          </mat-tab>

          <mat-tab label="Várólista ({{ waitlistEntries().length }})">
            @if (loadingWaitlist()) {
              <div class="kte-profile__loader">
                <mat-spinner diameter="32" />
                <span>Várólista betöltése…</span>
              </div>
            } @else if (waitlistEntries().length === 0) {
              <p class="kte-profile__empty">Jelenleg nem vagy egyetlen várólistán sem.</p>
            } @else {
              <div class="kte-profile__waitlist">
                @for (entry of waitlistEntries(); track entry.id) {
                  <kte-waitlist-card [entry]="entry" (changed)="reloadWaitlist()" />
                }
              </div>
            }
          </mat-tab>
        </mat-tab-group>

        <div class="kte-profile__actions">
          <button mat-stroked-button color="warn" type="button" (click)="logout()">
            <mat-icon>logout</mat-icon>
            Kijelentkezés
          </button>
        </div>
        }
      }
    </section>
  `,
  styles: [
    `
      .kte-profile {
        display: flex;
        flex-direction: column;
        gap: var(--kte-spacing-4);
        padding: var(--kte-spacing-6) var(--kte-spacing-4);
        max-width: 960px;
        margin: 0 auto;
      }
      .kte-profile__loader {
        display: flex;
        align-items: center;
        gap: var(--kte-spacing-3);
        justify-content: center;
        padding: var(--kte-spacing-8);
      }
      .kte-profile__hero {
        border-radius: var(--kte-radius-lg);
        box-shadow: var(--kte-shadow-md);
      }
      .kte-profile__hero-content {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: var(--kte-spacing-4);
        align-items: center;
        padding: var(--kte-spacing-4);
      }
      .kte-profile__avatar {
        width: 72px;
        height: 72px;
        border-radius: 50%;
        background: var(--kte-color-primary);
        color: white;
        font-size: 28px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        letter-spacing: 0.04em;
      }
      .kte-profile__identity h1 {
        margin: 0 0 4px;
        font-size: 24px;
      }
      .kte-profile__identity p {
        margin: 0;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-profile__phone {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .kte-profile__loyalty {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: var(--kte-spacing-2);
      }
      .kte-profile__loyalty strong {
        font-size: 18px;
        color: var(--kte-color-primary);
      }
      .kte-profile__tickets,
      .kte-profile__history,
      .kte-profile__passes,
      .kte-profile__waitlist {
        display: grid;
        gap: var(--kte-spacing-3);
        padding: var(--kte-spacing-4) 0;
      }
      .kte-profile__ticket-grid {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 6px var(--kte-spacing-3);
        margin: 0;
      }
      .kte-profile__ticket-grid dt {
        font-weight: 600;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-profile__ticket-grid dd {
        margin: 0;
      }
      .kte-profile__qr {
        font-family: 'Roboto Mono', monospace;
        font-size: 12px;
      }
      .kte-profile__history-meta {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
      }
      .kte-profile__history-details {
        display: flex;
        justify-content: space-between;
        margin-top: 4px;
        color: rgba(0, 0, 0, 0.6);
        font-size: 13px;
      }
      .kte-profile__empty {
        padding: var(--kte-spacing-6);
        text-align: center;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-profile__actions {
        display: flex;
        justify-content: flex-end;
      }
      @media (max-width: 600px) {
        .kte-profile__hero-content {
          grid-template-columns: 1fr;
          text-align: center;
        }
        .kte-profile__loyalty {
          align-items: center;
        }
      }
    `,
  ],
})
export class ProfilePageComponent implements OnInit {
  private readonly api = inject(AuthApiService);
  private readonly auth = inject(AuthService);
  private readonly passesApi = inject(SeasonPassesService);
  private readonly waitlistApi = inject(WaitlistApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly loadingPasses = signal(true);
  protected readonly loadingWaitlist = signal(true);
  protected readonly profile = signal<UserProfile | null>(null);
  protected readonly tickets = signal<readonly UserTicket[]>([]);
  protected readonly passes = signal<readonly SeasonPassResponse[]>([]);
  protected readonly waitlistEntries = signal<readonly WaitlistEntry[]>([]);

  protected readonly activeTickets = computed(() =>
    this.tickets().filter((t) => t.isActive),
  );
  protected readonly pastTickets = computed(() =>
    this.tickets().filter((t) => !t.isActive),
  );

  protected readonly initials = computed(() => {
    const user = this.profile();
    if (!user) {
      return '';
    }
    return `${(user.lastName[0] ?? '').toUpperCase()}${(user.firstName[0] ?? '').toUpperCase()}`;
  });

  protected readonly tierLabel = computed(() => {
    const user = this.profile();
    return user ? TIER_LABEL[user.loyaltyTier] : '';
  });

  protected readonly tierColor = computed(() => {
    const user = this.profile();
    return user ? TIER_COLOR[user.loyaltyTier] : '';
  });

  /**
   * Polls the waitlist endpoint every 5 seconds while at least one entry is
   * in NOTIFIED status — so the "felszabadult egy hely" countdown stays
   * accurate without requiring WebSocket. When no entry is notified the
   * polling subscription is paused (next reload restarts it).
   */
  private pollSub: Subscription | null = null;

  async ngOnInit(): Promise<void> {
    try {
      const [profile, ticketsPage] = await Promise.all([
        firstValueFrom(this.api.me()),
        firstValueFrom(this.api.myTickets(50, 0)),
      ]);
      this.profile.set(profile);
      this.tickets.set(ticketsPage.items);
    } finally {
      this.loading.set(false);
    }
    this.reloadPasses();
    this.reloadWaitlist();
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
    this.loadingWaitlist.set(true);
    this.waitlistApi.listMine().subscribe({
      next: (entries) => {
        this.waitlistEntries.set(entries);
        this.loadingWaitlist.set(false);
        this.adjustPolling(entries);
      },
      error: () => {
        this.waitlistEntries.set([]);
        this.loadingWaitlist.set(false);
        this.stopPolling();
      },
    });
  }

  private adjustPolling(entries: readonly WaitlistEntry[]): void {
    const hasNotified = entries.some((e) => e.status === 'notified');
    if (hasNotified && !this.pollSub) {
      this.pollSub = interval(WAITLIST_POLL_MS)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          this.waitlistApi.listMine().subscribe({
            next: (next) => {
              this.waitlistEntries.set(next);
              const stillNotified = next.some((e) => e.status === 'notified');
              if (!stillNotified) {
                this.stopPolling();
              }
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
