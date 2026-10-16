import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'kte-heatmap-legend',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="kte-heatmap-legend" role="list">
      @for (entry of entries; track entry.label) {
        <div class="kte-heatmap-legend__entry" role="listitem">
          <span class="kte-heatmap-legend__swatch" [style.background-color]="entry.color"></span>
          <span class="kte-heatmap-legend__label">{{ entry.label }}</span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .kte-heatmap-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        background: var(--kte-surface);
        padding: 12px 16px;
        border-radius: var(--kte-radius-sm);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      }
      .kte-heatmap-legend__entry {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--kte-ink);
      }
      .kte-heatmap-legend__swatch {
        display: inline-block;
        width: 16px;
        height: 16px;
        border-radius: 4px;
        border: 1px solid rgba(0, 0, 0, 0.08);
      }
    `,
  ],
})
export class HeatmapLegendComponent {
  protected readonly entries: ReadonlyArray<{ label: string; color: string }> = [
    { label: '0–19%', color: '#1E3A2F' },
    { label: '20–39%', color: '#2D5A40' },
    { label: '40–59%', color: '#C97A1E' },
    { label: '60–79%', color: '#C94B1E' },
    { label: '80–100%', color: '#8B0000' },
  ];
}
