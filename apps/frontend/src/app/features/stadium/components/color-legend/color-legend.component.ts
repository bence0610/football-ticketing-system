import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'kte-color-legend',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="kte-legend" aria-label="Szín jelmagyarázat">
      <h4 class="kte-legend__title">Jelmagyarázat</h4>
      <ul>
        <li>
          <span class="kte-legend__swatch kte-legend__swatch--available"></span>
          Szabad
        </li>
        <li>
          <span class="kte-legend__swatch kte-legend__swatch--locked"></span>
          Foglalás folyamatban
        </li>
        <li>
          <span class="kte-legend__swatch kte-legend__swatch--sold"></span>
          Elkelt
        </li>
        <li>
          <span class="kte-legend__swatch kte-legend__swatch--season-pass"></span>
          Bérletes
        </li>
        <li>
          <span class="kte-legend__swatch kte-legend__swatch--disabled"></span>
          Inaktív
        </li>
      </ul>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-legend {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        border-radius: var(--kte-radius-md);
        padding: 12px 14px;
        box-shadow: var(--kte-shadow-sm);
        border: 1px solid var(--kte-color-border);
        font-size: 12px;
        min-width: 180px;
      }

      .kte-legend__title {
        margin: 0 0 8px;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--kte-color-primary);
      }

      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;

        li {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #4b5563;
        }
      }

      .kte-legend__swatch {
        width: 14px;
        height: 14px;
        border-radius: 4px;
        flex-shrink: 0;
      }

      .kte-legend__swatch--available {
        background: #34d399;
      }

      .kte-legend__swatch--locked {
        background: #fb923c;
      }

      .kte-legend__swatch--sold {
        background: #9ca3af;
      }

      .kte-legend__swatch--season-pass {
        background:
          repeating-linear-gradient(
            135deg,
            rgba(255, 255, 255, 0.6) 0,
            rgba(255, 255, 255, 0.6) 3px,
            transparent 3px,
            transparent 6px
          ),
          #7e22ce;
      }

      .kte-legend__swatch--disabled {
        background: #ffffff;
        border: 1px solid var(--kte-color-border);
      }
    `,
  ],
})
export class ColorLegendComponent {}
