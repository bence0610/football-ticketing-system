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
 * Floating chatbot launcher (orange FAB, bottom-right). Pressing it toggles
 * a CDK overlay that hosts {@link ChatbotPanelComponent}. The widget is
 * a singleton — mounted once at the app shell level — so that opening
 * state survives route changes.
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
      .kte-chatbot-fab {
        position: fixed;
        bottom: 28px;
        right: 28px;
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--kte-brand-mid);
        color: var(--kte-surface);
        border: none;
        cursor: pointer;
        box-shadow: 0 6px 18px rgba(20, 18, 26, 0.32);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        z-index: 1100;
        transition: transform 0.18s ease, background 0.18s ease;
      }
      .kte-chatbot-fab:hover {
        transform: translateY(-2px);
        background: var(--kte-brand-deep);
      }
      .kte-chatbot-fab--open {
        background: var(--kte-ink);
      }
      .kte-chatbot-fab mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
      @media (max-width: 640px) {
        .kte-chatbot-fab {
          bottom: 16px;
          right: 16px;
        }
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
    const positionStrategy = this.overlay
      .position()
      .global()
      .right('28px')
      .bottom('100px');
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
