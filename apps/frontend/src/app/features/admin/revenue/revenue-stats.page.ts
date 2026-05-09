import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { RevenueStats } from '../../../shared/models/admin.model';
import { AdminApiService } from '../../../shared/services/admin.api.service';
import { HufCurrencyPipe } from '../../../shared/pipes/huf-currency.pipe';
import { RevenueByMatchTableComponent } from '../components/revenue-by-match-table.component';
import { RevenueLineChartComponent } from '../components/revenue-line-chart.component';
import { RevenueSummaryCardComponent } from '../components/revenue-summary-card.component';

@Component({
  selector: 'kte-admin-revenue-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatIconModule,
    HufCurrencyPipe,
    RevenueSummaryCardComponent,
    RevenueLineChartComponent,
    RevenueByMatchTableComponent,
  ],
  template: `
    <section class="kte-revenue">
      @if (loading()) {
        <div class="kte-revenue__loader">
          <mat-spinner diameter="40" />
          <span>Bevételi statisztikák betöltése…</span>
        </div>
      } @else {
        @if (error(); as err) {
          <div class="kte-revenue__error" role="alert">
            <mat-icon>error</mat-icon>
            {{ err }}
          </div>
        } @else {
          @if (stats(); as data) {
            <div class="kte-revenue__cards">
              <kte-revenue-summary-card
                label="Mai bevétel"
                icon="today"
                [amount]="data.summary.todayRevenue"
                [subtitle]="data.summary.todayTicketCount + ' jegy ma'"
              />
              <kte-revenue-summary-card
                label="Havi bevétel"
                icon="calendar_month"
                [amount]="data.summary.monthRevenue"
                [subtitle]="data.summary.monthTicketCount + ' jegy a hónapban'"
              />
              @if (data.summary.topMatch; as top) {
                <kte-revenue-summary-card
                  label="Legjobb meccs"
                  icon="emoji_events"
                  [amount]="top.revenue"
                  [subtitle]="top.homeTeam + ' vs ' + top.awayTeam"
                />
              }
            </div>

            <kte-revenue-line-chart [data]="data.daily" />

            <article class="kte-revenue__table">
              <header>
                <h2>Top mérkőzések bevétel szerint</h2>
                <p>Az összesítés a {{ daysWindow() }} napos időablak alapján készül.</p>
              </header>
              <kte-revenue-by-match-table [rows]="data.byMatch" />
            </article>
          }
        }
      }
    </section>
  `,
  styles: [
    `
      .kte-revenue {
        display: flex;
        flex-direction: column;
        gap: 24px;
        padding: 16px;
      }
      .kte-revenue__loader {
        display: flex;
        align-items: center;
        gap: 12px;
        justify-content: center;
        padding: 48px 0;
        color: rgba(0, 0, 0, 0.6);
      }
      .kte-revenue__error {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 16px;
        background: rgba(244, 67, 54, 0.08);
        color: #b71c1c;
        border-radius: 8px;
      }
      .kte-revenue__cards {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 16px;
      }
      .kte-revenue__table {
        background: #FFFFFF;
        border-radius: 12px;
        padding: 16px;
      }
      .kte-revenue__table header {
        margin-bottom: 12px;
      }
      .kte-revenue__table h2 {
        margin: 0;
        color: #222222;
        font-size: 18px;
      }
      .kte-revenue__table p {
        margin: 4px 0 0;
        color: rgba(0, 0, 0, 0.55);
        font-size: 13px;
      }
      @media (max-width: 900px) {
        .kte-revenue__cards {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class RevenueStatsPageComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly stats = signal<RevenueStats | null>(null);
  protected readonly daysWindow = signal<number>(30);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.api.revenue(this.daysWindow()));
      this.stats.set(data);
    } catch (error) {
      this.error.set(this.normalizeError(error));
    } finally {
      this.loading.set(false);
    }
  }

  private normalizeError(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const err = error as { error?: { message?: string }; message?: string };
      if (err.error?.message) {
        return err.error.message;
      }
      if (err.message) {
        return err.message;
      }
    }
    return 'A statisztikák betöltése sikertelen.';
  }
}
