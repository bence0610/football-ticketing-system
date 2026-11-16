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
 * Chatbot launcher: a round chat bubble fixed to the bottom-right corner. Pressing
 * it toggles a CDK overlay, opening upwards from the bubble, that hosts
 * {@link ChatbotPanelComponent}. The widget is a singleton - mounted once at the
 * app shell level - so that opening state survives route changes.
 *
 * A bubble that floats can cover things, so the page makes room for it instead of the
 * bubble dodging:
 *  - every page ends in the shell footer, whose bottom padding is `--chat-clearance`
 *    (bubble + gaps): scrolled to the end, the bubble sits on empty space, never on a
 *    button or on footer text; the auth pages, which have no footer, pad their form the same;
 *  - a bar docked to the bottom edge (the phone seat summary) publishes its height as
 *    `--dock-inset` and the bubble rides above it, so it never covers that bar's button.
 * Mid-scroll the bubble does pass over content, as any floating button does; it never
 * hides anything that cannot be scrolled out from under it.
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
      /* Floats bottom-right. A bar docked to the bottom edge (the phone seat summary) sets
         --dock-inset to its height and the bubble rides above it. */
      :host {
        position: fixed;
        right: var(--chat-offset, 16px);
        bottom: calc(var(--chat-offset, 16px) + var(--dock-inset, 0px));
        z-index: 30; /* over page content and the sticky header, under dialogs and menus */
        display: inline-flex;
        transition: bottom 0.15s ease;
      }

      .kte-chatbot-fab {
        width: var(--chat-size, 56px);
        height: var(--chat-size, 56px);
        border-radius: 50%;
        background: var(--kte-brand-deep);
        color: #fff;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        box-shadow: 0 6px 20px rgba(20, 18, 26, 0.3);
        transition: background 0.18s ease;
      }
      .kte-chatbot-fab:hover {
        background: var(--kte-brand-mid);
      }
      .kte-chatbot-fab:focus-visible {
        outline: 3px solid var(--kte-brand-mid);
        outline-offset: 3px;
      }
      .kte-chatbot-fab--open {
        background: var(--kte-ink);
      }
      .kte-chatbot-fab mat-icon {
        font-size: 26px;
        width: 26px;
        height: 26px;
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
    // Above the bubble, in the right-hand gutter; the panel sizes itself to fit.
    const positionStrategy = this.overlay
      .position()
      .global()
      .bottom('calc(var(--chat-clearance, 88px) + var(--dock-inset, 0px))')
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
