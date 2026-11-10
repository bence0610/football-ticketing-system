import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { ComponentPortal } from '@angular/cdk/portal';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  effect,
  inject,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { ChatbotPanelComponent } from './chatbot-panel.component';
import { ChatbotStore } from './state/chatbot.signals';

/**
 * Chatbot launcher: a round chat bubble in the shell's header toolbar. Pressing
 * it toggles a CDK overlay, anchored under the header, that hosts
 * {@link ChatbotPanelComponent}. The widget is a singleton - mounted once at the
 * app shell level - so that opening state survives route changes.
 *
 * It lives in the header on purpose. A launcher that floats over the page
 * (fixed, bottom-right) covers footers, card corners and, on a phone, the submit
 * button of whatever form is at the bottom - and no offset can make that safe,
 * because content scrolls underneath it. In the toolbar it can never be on top
 * of page content, at any width or scroll position.
 */
@Component({
  selector: 'kte-chatbot-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  template: `
    <button
      type="button"
      class="kte-chatbot-fab"
      [class.kte-chatbot-fab--open]="store.open()"
      aria-label="KTE AI Asszisztens megnyitása"
      (click)="store.toggle()"
    >
      @if (store.open()) {
        <mat-icon>close</mat-icon>
      } @else {
        <mat-icon>chat_bubble</mat-icon>
      }
    </button>
  `,
  styles: [
    `
      :host { display: inline-flex; flex-shrink: 0; }

      .kte-chatbot-fab {
        width: var(--min-target, 44px);
        height: var(--min-target, 44px);
        border-radius: 50%;
        background: var(--kte-brand-mid);
        color: #fff;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        transition: background 0.18s ease;
      }
      .kte-chatbot-fab:hover {
        background: var(--kte-brand-deep);
      }
      .kte-chatbot-fab:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }
      .kte-chatbot-fab--open {
        background: rgba(255, 255, 255, 0.16);
      }
      .kte-chatbot-fab mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
    `,
  ],
})
export class ChatbotWidgetComponent implements OnDestroy {
  protected readonly store = inject(ChatbotStore);
  private readonly overlay = inject(Overlay);
  private overlayRef: OverlayRef | null = null;

  constructor() {
    effect(() => {
      const open = this.store.open();
      if (open) {
        this.openOverlay();
      } else {
        this.closeOverlay();
      }
    });
  }

  ngOnDestroy(): void {
    this.closeOverlay();
  }

  private openOverlay(): void {
    if (this.overlayRef) {
      return;
    }
    // Under the header, in the right-hand gutter; the panel sizes itself to fit.
    const positionStrategy = this.overlay
      .position()
      .global()
      .top('calc(var(--header-h, 72px) + 8px)')
      .right('16px');
    const ref = this.overlay.create({
      positionStrategy,
      hasBackdrop: false,
      panelClass: 'kte-chatbot-overlay',
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
    });
    const portal = new ComponentPortal(ChatbotPanelComponent);
    const componentRef = ref.attach(portal);
    componentRef.instance.closed.subscribe(() => this.store.setOpen(false));
    this.overlayRef = ref;
  }

  private closeOverlay(): void {
    this.overlayRef?.dispose();
    this.overlayRef = null;
  }
}
