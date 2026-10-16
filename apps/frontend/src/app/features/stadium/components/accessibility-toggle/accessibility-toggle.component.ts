import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
} from '@angular/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'kte-accessibility-toggle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatSlideToggleModule, MatIconModule],
  template: `
    <label class="kte-a11y-toggle" for="kte-a11y-toggle">
      <mat-icon class="kte-a11y-toggle__icon">accessible</mat-icon>
      <span class="kte-a11y-toggle__label">Csak akadálymentes ülések</span>
      <mat-slide-toggle
        id="kte-a11y-toggle"
        color="accent"
        [checked]="checked"
        (change)="changed.emit($event.checked)"
        aria-label="Csak akadálymentes ülések szűrése"
      ></mat-slide-toggle>
    </label>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .kte-a11y-toggle {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: var(--kte-radius-pill);
        background: var(--kte-surface);
        box-shadow: var(--kte-shadow-sm);
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        color: var(--kte-brand-deep);
      }

      .kte-a11y-toggle__icon {
        color: var(--kte-brand-deep);
      }
    `,
  ],
})
export class AccessibilityToggleComponent {
  @Input() checked = false;
  @Output() changed = new EventEmitter<boolean>();
}
