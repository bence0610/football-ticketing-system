import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { PASSWORD_MIN, passwordStrength } from '../../../shared/utils/password-rules';

/**
 * The four-segment strength meter and the one-line rule under a new-password
 * field. It reads the same rule the server enforces (shared/utils/password-rules),
 * so it never calls a password fine that the server would refuse. Used by the
 * registration page and the set-new-password page, so both say the same thing.
 */
@Component({
  selector: 'kte-password-meter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="meter" data-testid="strength" [attr.data-level]="strength.level">
      <div class="meter__bars" aria-hidden="true">
        @for (i of segmentIndexes; track i) {
          <span class="meter__seg" [class.meter__seg--on]="i < strength.segments"></span>
        }
      </div>
      <span class="meter__label" aria-live="polite">{{ strength.label }}</span>
    </div>
    <p class="rule" [id]="ruleId" data-testid="password-rule">
      Legalább {{ min }} karakter, benne legalább egy betű (a–z) és egy szám.
    </p>
  `,
  styles: [
    `
      :host { display: block; }
      .meter { margin-top: 10px; }
      .meter__bars { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
      .meter__seg { height: 5px; border-radius: 3px; background: var(--border); }
      .meter[data-level='rejected'] .meter__seg--on { background: var(--amber-icon); }
      .meter[data-level='accepted'] .meter__seg--on,
      .meter[data-level='long'] .meter__seg--on { background: var(--chip-paid); }
      .meter__label {
        display: block;
        min-height: 18px;
        margin-top: 6px;
        font-size: 13px;
        font-weight: 600;
        color: var(--muted);
      }
      .meter[data-level='rejected'] .meter__label { color: var(--amber-ink); }
      .meter[data-level='accepted'] .meter__label,
      .meter[data-level='long'] .meter__label { color: var(--chip-paid); }
      .rule { margin: 2px 0 0; font-size: 13px; line-height: 1.4; color: var(--muted); }
    `,
  ],
})
export class PasswordMeterComponent {
  @Input() set password(value: string) {
    this.strength = passwordStrength(value ?? '');
  }
  /** id of the rule line, so the input can point at it with aria-describedby. */
  @Input() ruleId = 'password-rule';

  protected strength = passwordStrength('');
  protected readonly min = PASSWORD_MIN;
  protected readonly segmentIndexes = [0, 1, 2, 3];
}
