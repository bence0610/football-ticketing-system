import { ChangeDetectionStrategy, Component, HostBinding, Input, signal } from '@angular/core';

/**
 * The club crest, `src/assets/kte-cimer.png` (transparent background, 211 x 235).
 *
 * A second copy of this file lives in the backend, for the e-mail header:
 * `apps/backend/src/modules/email/templates/assets/kte-cimer.png`. If the crest changes, replace
 * BOTH, or the site and the e-mails will show different crests.
 */
export const CREST_SRC = 'assets/kte-cimer.png';

/**
 * The Kecskeméti TE crest, shown at the height the parent gives it through `--crest-h`.
 *
 * The file is 235px tall: enough for the 40px header crest on a 4x screen and the 84px
 * login-panel crest on a 2x one, so it is never scaled up. The width/height attributes only
 * reserve the box so nothing shifts while it loads.
 *
 * If the file cannot be loaded (missing from the build, blocked) the projected content is
 * shown instead, so a header or panel never ends up with a broken-image icon.
 */
@Component({
  selector: 'kte-crest',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (failed()) {
      <ng-content />
    } @else {
      <img
        class="crest"
        [src]="src"
        width="211"
        height="235"
        alt="Kecskeméti TE címer"
        decoding="async"
        draggable="false"
        (error)="failed.set(true)"
      />
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        flex-shrink: 0;
      }
      /* The crest is purple and white on a transparent background: on a dark or purple band it
         would vanish, so there it sits on a white plate. */
      :host(.crest--plated) {
        padding: calc(var(--crest-h, 56px) * 0.14);
        background: #fff;
        border-radius: calc(var(--crest-h, 56px) * 0.3);
      }
      .crest {
        display: block;
        height: var(--crest-h, 56px);
        width: auto;
      }
    `,
  ],
})
export class CrestComponent {
  /** Draw it on a white plate (for dark backgrounds). */
  @Input() plated = false;
  protected readonly src = CREST_SRC;
  readonly failed = signal(false);

  @HostBinding('class.crest--plated')
  protected get plate(): boolean {
    return this.plated && !this.failed();
  }
}
