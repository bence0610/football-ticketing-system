import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * One labelled input of the auth forms: 52px tall, a 1.5px --border, a
 * 10px radius and a leading icon. Focus turns the border to 2px --brand-mid and
 * the label to --brand-mid (done without changing the box size, so nothing
 * shifts). The input itself, the show/hide button and the message under the
 * field are projected by the page, which keeps all form logic there:
 *
 *   <kte-auth-field label="E-mail" icon="mail" inputId="login-email" [invalid]="...">
 *     <input id="login-email" formControlName="email" />
 *     <p msg>...</p>
 *   </kte-auth-field>
 *
 * Its styles (and the other `kte-auth-*` ones) live in styles/_auth.scss: the projected
 * <input> belongs to the page, so the rules that style it must be global.
 */
@Component({
  selector: 'kte-auth-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="kte-field" [class.kte-field--invalid]="invalid">
      <label class="kte-field__label" [attr.for]="inputId">{{ label }}</label>
      <div class="kte-field__box">
        @if (icon) {
          <mat-icon class="kte-field__icon" aria-hidden="true">{{ icon }}</mat-icon>
        }
        <ng-content />
        <ng-content select="[trailing]" />
      </div>
      <div class="kte-field__msg">
        <ng-content select="[msg]" />
      </div>
    </div>
  `,
})
export class AuthFieldComponent {
  @Input({ required: true }) label = '';
  /** Leading icon; the two name fields go without one to keep side-by-side usable at 360px. */
  @Input() icon = '';
  @Input({ required: true }) inputId = '';
  @Input() invalid = false;
}
