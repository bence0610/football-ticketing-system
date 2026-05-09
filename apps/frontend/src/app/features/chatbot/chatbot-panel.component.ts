import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  ViewChild,
  computed,
  effect,
  inject,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ChatbotMessageComponent } from './chatbot-message.component';
import { ChatbotStore } from './state/chatbot.signals';

@Component({
  selector: 'kte-chatbot-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    ChatbotMessageComponent,
  ],
  template: `
    <div class="kte-chatbot-panel" role="dialog" aria-label="KTE AI Asszisztens">
      <header class="kte-chatbot-panel__header">
        <div class="kte-chatbot-panel__title">
          <mat-icon class="kte-chatbot-panel__pulse">smart_toy</mat-icon>
          <strong>KTE AI Asszisztens</strong>
        </div>
        <button
          mat-icon-button
          type="button"
          aria-label="Bezárás"
          (click)="closed.emit()"
        >
          <mat-icon>close</mat-icon>
        </button>
      </header>

      <div class="kte-chatbot-panel__messages" #messages>
        @if (store.isEmpty()) {
          <div class="kte-chatbot-panel__empty">
            <p>Szia! Miben segíthetek?</p>
            <div class="kte-chatbot-panel__suggestions">
              @for (suggestion of store.suggestions(); track suggestion) {
                <button
                  type="button"
                  class="kte-chatbot-panel__chip"
                  (click)="useSuggestion(suggestion)"
                  [disabled]="store.typing()"
                >
                  {{ suggestion }}
                </button>
              }
            </div>
          </div>
        }

        @for (message of store.messages(); track message.id) {
          <kte-chatbot-message [message]="message" />
        }

        @if (store.typing()) {
          <div class="kte-chatbot-panel__typing" aria-live="polite">
            <span class="kte-chatbot-panel__dot"></span>
            <span class="kte-chatbot-panel__dot"></span>
            <span class="kte-chatbot-panel__dot"></span>
          </div>
        }

        @if (store.error(); as err) {
          <div class="kte-chatbot-panel__error" role="alert">{{ err }}</div>
        }
      </div>

      <form
        class="kte-chatbot-panel__form"
        (ngSubmit)="onSubmit()"
      >
        <input
          #inputEl
          type="text"
          name="message"
          autocomplete="off"
          class="kte-chatbot-panel__input"
          placeholder="Írd be a kérdésed…"
          maxlength="1000"
          [(ngModel)]="draft"
          [disabled]="store.typing()"
        />
        <button
          mat-icon-button
          type="submit"
          color="primary"
          aria-label="Küldés"
          [disabled]="!canSend() || store.typing()"
        >
          <mat-icon>send</mat-icon>
        </button>
      </form>
    </div>
  `,
  styles: [
    `
      .kte-chatbot-panel {
        display: flex;
        flex-direction: column;
        width: 360px;
        height: 520px;
        max-height: calc(100vh - 32px);
        background: #1A1A1A;
        color: #F5F5F5;
        border-radius: 16px;
        box-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
        overflow: hidden;
      }
      .kte-chatbot-panel__header {
        background: #C94B1E;
        color: #FFFFFF;
        padding: 12px 12px 12px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .kte-chatbot-panel__title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 15px;
      }
      .kte-chatbot-panel__pulse {
        font-size: 22px;
        width: 22px;
        height: 22px;
      }
      .kte-chatbot-panel__messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
      }
      .kte-chatbot-panel__empty {
        display: flex;
        flex-direction: column;
        gap: 16px;
        color: #DDDDDD;
        text-align: center;
        padding: 16px 0;
      }
      .kte-chatbot-panel__suggestions {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .kte-chatbot-panel__chip {
        background: #2E2E2E;
        color: #F5F5F5;
        border: none;
        border-radius: 20px;
        padding: 10px 14px;
        font-size: 13px;
        cursor: pointer;
        text-align: left;
        transition: background 0.15s ease;
      }
      .kte-chatbot-panel__chip:hover:not(:disabled) {
        background: #3A3A3A;
      }
      .kte-chatbot-panel__chip:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .kte-chatbot-panel__typing {
        display: inline-flex;
        gap: 4px;
        padding: 8px 12px;
        align-self: flex-start;
        background: #2E2E2E;
        border-radius: 14px;
        margin-bottom: 8px;
      }
      .kte-chatbot-panel__dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #C94B1E;
        animation: kte-chatbot-pulse 1.2s infinite ease-in-out;
      }
      .kte-chatbot-panel__dot:nth-child(2) {
        animation-delay: 0.15s;
      }
      .kte-chatbot-panel__dot:nth-child(3) {
        animation-delay: 0.3s;
      }
      @keyframes kte-chatbot-pulse {
        0%, 60%, 100% { opacity: 0.3; transform: scale(0.85); }
        30% { opacity: 1; transform: scale(1); }
      }
      .kte-chatbot-panel__error {
        margin-top: 8px;
        padding: 8px 12px;
        background: rgba(244, 67, 54, 0.15);
        border-left: 3px solid #f44336;
        font-size: 13px;
        color: #ff8a80;
        border-radius: 6px;
      }
      .kte-chatbot-panel__form {
        display: flex;
        padding: 8px;
        border-top: 1px solid #2E2E2E;
        background: #1A1A1A;
        gap: 4px;
      }
      .kte-chatbot-panel__input {
        flex: 1;
        background: #0F0F0F;
        color: #F5F5F5;
        border: 1px solid #2E2E2E;
        border-radius: 20px;
        padding: 10px 14px;
        font-size: 14px;
        outline: none;
        transition: border-color 0.15s ease;
      }
      .kte-chatbot-panel__input:focus {
        border-color: #C94B1E;
      }
      .kte-chatbot-panel__input:disabled {
        opacity: 0.6;
      }
      @media (max-width: 640px) {
        .kte-chatbot-panel {
          width: 100vw;
          height: 100vh;
          max-height: 100vh;
          border-radius: 0;
        }
      }
    `,
  ],
})
export class ChatbotPanelComponent {
  protected readonly store = inject(ChatbotStore);

  @Output() readonly closed = new EventEmitter<void>();
  @ViewChild('messages') private messagesEl?: ElementRef<HTMLDivElement>;
  @ViewChild('inputEl') private inputEl?: ElementRef<HTMLInputElement>;

  protected draft = '';

  protected readonly canSend = computed(() => this.draft.trim().length > 0);

  constructor() {
    // Auto-scroll on every message addition.
    effect(() => {
      // touch the signals to register the dependency
      this.store.messages();
      this.store.typing();
      queueMicrotask(() => this.scrollToBottom());
    });
  }

  protected useSuggestion(text: string): void {
    this.draft = text;
    void this.onSubmit();
  }

  protected async onSubmit(): Promise<void> {
    const value = this.draft.trim();
    if (!value || this.store.typing()) {
      return;
    }
    this.draft = '';
    await this.store.send(value);
    this.inputEl?.nativeElement.focus();
  }

  private scrollToBottom(): void {
    const el = this.messagesEl?.nativeElement;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }
}
