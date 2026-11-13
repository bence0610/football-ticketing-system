import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  signal,
} from '@angular/core';
import {
  ARC_LABEL,
  PRICE_CATEGORY_LABEL,
  SectorSummary,
  StadiumArc,
} from '../../../../shared/models/seat.model';
import { HufCurrencyPipe } from '../../../../shared/pipes/huf-currency.pipe';
import { gateLabel } from '../../../../shared/utils/gate';
import { coverLabel } from '../../../../shared/utils/sector-cover';

interface Group {
  readonly key: StadiumArc | 'other';
  readonly label: string;
  readonly sectors: readonly SectorSummary[];
}

/**
 * The map's fallback: one dropdown listing every sector with its free seats and
 * price, so a seat can be bought without the map (keyboard and screen-reader
 * users, or a map that is too small to tap). A native `<select>`, on purpose: it
 * is the control every assistive technology already knows how to drive.
 *
 * Sectors are grouped by arc and in stadium order (west to east); order and names
 * come from the server. The away section is listed so it is visible that it
 * exists, but it is disabled: it cannot be chosen.
 */
@Component({
  selector: 'kte-sector-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HufCurrencyPipe],
  template: `
    @if (groups().length > 0) {
      <section class="kte-sector-select" aria-labelledby="kte-sector-select-label">
        <label id="kte-sector-select-label" class="kte-sector-select__label" for="kte-sector-select">
          Szektor kiválasztása a térkép nélkül
        </label>
        <select
          id="kte-sector-select"
          class="kte-sector-select__control"
          data-testid="sector-select"
          [value]="selectedSection ?? ''"
          (change)="onChange($any($event.target).value)"
        >
          <option value="" [selected]="!selectedSection" disabled>Válassz szektort…</option>
          @for (group of groups(); track group.key) {
            <optgroup [label]="group.label" data-testid="sector-group">
              @for (summary of group.sectors; track summary.section) {
                <option
                  [value]="summary.section"
                  [selected]="summary.section === selectedSection"
                  [disabled]="summary.isAway"
                  [attr.data-section]="summary.section"
                >
                  {{ optionText(summary) }}
                </option>
              }
            </optgroup>
          }
        </select>
        <p class="kte-sector-select__hint">
          A szektor kiválasztása után lent a székek közül választhatsz.
        </p>
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-sector-select {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px 16px;
        background: var(--kte-surface);
        border-radius: var(--kte-radius);
        box-shadow: var(--kte-shadow-sm);
      }

      .kte-sector-select__label {
        font-weight: 600;
        color: var(--kte-brand-deep);
      }

      .kte-sector-select__control {
        width: 100%;
        max-width: 560px;
        min-height: 44px;
        padding: 8px 12px;
        font: inherit;
        color: var(--ink);
        background: var(--kte-surface);
        border: 1px solid var(--border);
        border-radius: var(--kte-radius);
      }

      .kte-sector-select__control:focus-visible {
        outline: 2px solid var(--brand-mid);
        outline-offset: 2px;
      }

      .kte-sector-select__hint {
        margin: 0;
        font-size: 12px;
        color: var(--kte-muted);
      }
    `,
  ],
})
export class SectorSummaryComponent {
  private readonly all = signal<readonly SectorSummary[]>([]);
  private readonly huf = new HufCurrencyPipe();

  @Input() set summaries(value: readonly SectorSummary[]) {
    this.all.set(value ?? []);
  }
  @Input() selectedSection: string | null = null;
  @Output() sectorSelected = new EventEmitter<string>();

  /** Upper arc, then the lower arc, each west to east; sectors with no arc data come last. */
  protected readonly groups = computed<readonly Group[]>(() => {
    const all = this.all();
    const onArc = (arc: StadiumArc): SectorSummary[] =>
      all
        .filter((s) => s.arc === arc)
        .sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER));
    const groups: Group[] = (['upper', 'lower'] as const)
      .map((arc) => ({ key: arc, label: ARC_LABEL[arc], sectors: onArc(arc) }))
      .filter((g) => g.sectors.length > 0);
    const rest = all.filter((s) => s.arc === null);
    if (rest.length > 0) {
      groups.push({ key: 'other', label: 'További szektorok', sectors: rest });
    }
    return groups;
  });

  protected onChange(section: string): void {
    const summary = this.all().find((s) => s.section === section);
    // The away section is not for sale through the portal.
    if (!summary || summary.isAway) {
      return;
    }
    this.sectorSelected.emit(section);
  }

  /** "D/1 szektor · Felső ív · fedett · 150 szabad · 2 800 Ft": all a choice needs, in one line. */
  protected optionText(summary: SectorSummary): string {
    if (summary.isAway) {
      return `${summary.name} · vendégszektor, a portálon nem vásárolható`;
    }
    const parts: Array<string | null> = [
      summary.name,
      summary.priceCategory ? PRICE_CATEGORY_LABEL[summary.priceCategory] : null,
      coverLabel(summary.covered)?.toLowerCase() ?? null,
      gateLabel(summary.gate),
      summary.available > 0 ? `${summary.available} szabad` : 'elfogyott',
      this.priceText(summary),
    ];
    return parts.filter((p): p is string => !!p).join(' · ');
  }

  private priceText(summary: SectorSummary): string {
    if (summary.available <= 0) {
      return '';
    }
    return summary.minPrice === summary.maxPrice
      ? this.huf.transform(summary.minPrice)
      : `${this.huf.transform(summary.minPrice)}-tól`;
  }
}
