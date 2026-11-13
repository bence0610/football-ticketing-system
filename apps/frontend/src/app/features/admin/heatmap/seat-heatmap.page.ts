import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SeatSale, SeatSales } from '../../../shared/models/admin.model';
import { AdminApiService } from '../../../shared/services/admin.api.service';
import { extractApiErrorMessage } from '../../../shared/utils/api-error';
import { AdminPageHeaderComponent } from '../components/admin-page-header.component';
import {
  headerSubtitle,
  heatmapInterpretation,
  sectionSummaries,
  takenPercent,
} from '../logic/admin-logic';

interface RowView {
  readonly row: string;
  readonly cells: readonly CellView[];
}

interface CellView {
  readonly number: number;
  readonly percent: number;
  readonly color: string;
  readonly title: string;
}

interface SectionView {
  readonly section: string;
  readonly averagePercent: number;
  readonly rows: readonly RowView[];
}

/** Pale to deep on the brand purple: the token pair, mixed by how often the seat sold. */
export function heatColor(percent: number): string {
  return `color-mix(in srgb, var(--brand-deep) ${percent}%, var(--brand-tint))`;
}

function byRowThenNumber(a: SeatSale, b: SeatSale): number {
  return a.row.localeCompare(b.row, 'hu', { numeric: true }) || a.number - b.number;
}

@Component({
  selector: 'kte-admin-heatmap-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatProgressSpinnerModule, AdminPageHeaderComponent],
  template: `
    <kte-admin-page-header title="Ülés-hőtérkép" [subtitle]="subtitle()" />

    <div class="page">
      @if (loading()) {
        <div class="state" role="status" aria-live="polite">
          <mat-spinner diameter="32" />
          <span>Betöltés…</span>
        </div>
      } @else {
        @if (error(); as message) {
          <div class="state state--error" role="alert">
            <mat-icon aria-hidden="true">error</mat-icon>
            <span>{{ message }}</span>
            <button type="button" class="retry" (click)="load()">Újra</button>
          </div>
        } @else {
          @if (data(); as d) {
            @if (d.matchCount === 0) {
              <p class="state" data-testid="heatmap-empty">
                Ebben a szezonban még nem volt lejátszott meccs, ezért nincs mit ábrázolni.
              </p>
            } @else {
              <section class="card" aria-labelledby="heat-title">
                <h2 id="heat-title" class="card__title">Milyen gyakran kel el egy ülés a szezonban</h2>
                <p class="interpretation" data-testid="heatmap-interpretation">{{ interpretation() }}</p>

                <div class="legend" aria-label="Jelmagyarázat">
                  <span>ritkán</span>
                  <span class="legend__bar" aria-hidden="true"></span>
                  <span>mindig</span>
                </div>

                @for (section of sections(); track section.section) {
                  <div class="section" data-testid="heat-section">
                    <h3 class="section__title">
                      {{ section.section }} szektor
                      <span class="section__avg">átlagosan {{ section.averagePercent }}%</span>
                    </h3>
                    <div class="grid" role="group" [attr.aria-label]="section.section + ' szektor ülései'">
                      @for (row of section.rows; track row.row) {
                        <div class="grid__row">
                          <span class="grid__row-label">{{ row.row }}. sor</span>
                          @for (cell of row.cells; track cell.number) {
                            <span
                              class="cell"
                              data-testid="heat-cell"
                              [attr.data-percent]="cell.percent"
                              [style.background]="cell.color"
                              [title]="cell.title"
                            ></span>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
              </section>
            }
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 24px 32px;
      }

      .state {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 0;
        padding: 24px;
        color: var(--muted);
      }

      .state--error {
        color: var(--error-ink);
        background: var(--error-bg);
        border: 1px solid var(--error-edge);
        border-radius: var(--radius-block);
      }

      .retry {
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius-block);
        background: var(--surface);
        color: var(--brand-deep);
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .card {
        padding: 20px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-card);
      }

      .card__title {
        margin: 0 0 8px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 16px;
      }

      .interpretation {
        margin: 0 0 16px;
        font-size: 14px;
        color: var(--ink);
      }

      .legend {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 20px;
        font-size: 12px;
        color: var(--muted);
      }

      .legend__bar {
        width: 180px;
        height: 10px;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: linear-gradient(to right, var(--brand-tint), var(--brand-deep));
      }

      .section + .section {
        margin-top: 24px;
      }

      .section__title {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 0 0 8px;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: 14px;
      }

      .section__avg {
        font-family: var(--font-body);
        font-weight: 400;
        font-size: 12px;
        color: var(--muted);
      }

      .grid {
        display: flex;
        flex-direction: column;
        gap: 3px;
        overflow-x: auto;
        padding-bottom: 4px;
      }

      .grid__row {
        display: flex;
        align-items: center;
        gap: 3px;
      }

      .grid__row-label {
        flex: 0 0 44px;
        font-size: 11px;
        color: var(--muted);
      }

      .cell {
        flex: 0 0 18px;
        height: 18px;
        border-radius: 3px;
        box-shadow: inset 0 0 0 1px rgba(20, 18, 26, 0.08);
      }

      @media (max-width: 899px) {
        .page {
          padding: 16px;
        }
      }
    `,
  ],
})
export class SeatHeatmapPageComponent {
  private readonly api = inject(AdminApiService);

  protected readonly data = signal<SeatSales | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly subtitle = computed(() =>
    headerSubtitle(this.data()?.season?.label ?? null, this.data()?.generatedAt ?? null),
  );

  private readonly summaries = computed(() => {
    const d = this.data();
    return d ? sectionSummaries(d.seats, d.matchCount) : [];
  });

  protected readonly interpretation = computed(() =>
    heatmapInterpretation(this.summaries(), this.data()?.matchCount ?? 0),
  );

  protected readonly sections = computed<readonly SectionView[]>(() => {
    const d = this.data();
    if (!d) return [];
    return this.summaries().map((summary) => {
      const seats = d.seats.filter((s) => s.section === summary.section).sort(byRowThenNumber);
      const rows = new Map<string, CellView[]>();
      for (const seat of seats) {
        const percent = takenPercent(seat.taken, d.matchCount);
        const cells = rows.get(seat.row) ?? [];
        cells.push({
          number: seat.number,
          percent,
          color: heatColor(percent),
          title: `${seat.section} szektor, ${seat.row}. sor, ${seat.number}. hely: ${seat.taken} / ${d.matchCount} meccsen foglalt`,
        });
        rows.set(seat.row, cells);
      }
      return {
        section: summary.section,
        averagePercent: summary.averagePercent,
        rows: [...rows.entries()].map(([row, cells]) => ({ row, cells })),
      };
    });
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.seatSales().subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(extractApiErrorMessage(err, 'A hőtérkép betöltése nem sikerült.'));
        this.loading.set(false);
      },
    });
  }
}
