import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChatbotMessage } from '../../../shared/models/chatbot.model';
import { ChatbotApiService } from '../../../shared/services/chatbot.api.service';
import { extractApiErrorMessage } from '../../../shared/utils/api-error';

const SUGGESTIONS_HU: readonly string[] = [
  'Mikor van a következő meccs?',
  'Mennyibe kerül egy jegy?',
  'Hogyan működik a hűségprogram?',
];

/**
 * Lightweight signal store for the floating chatbot widget. State (open
 * flag, message buffer, conversation id) is process-local and is reset on
 * page reload — by design.
 */
@Injectable({ providedIn: 'root' })
export class ChatbotStore {
  private readonly api = inject(ChatbotApiService);

  private readonly _open = signal(false);
  private readonly _messages = signal<readonly ChatbotMessage[]>([]);
  private readonly _typing = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _conversationId = signal<string | null>(null);

  readonly open = this._open.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly typing = this._typing.asReadonly();
  readonly error = this._error.asReadonly();
  readonly conversationId = this._conversationId.asReadonly();
  readonly suggestions = signal<readonly string[]>(SUGGESTIONS_HU).asReadonly();

  readonly isEmpty = computed(() => this._messages().length === 0);

  setOpen(open: boolean): void {
    this._open.set(open);
  }

  toggle(): void {
    this._open.update((value) => !value);
  }

  reset(): void {
    this._messages.set([]);
    this._conversationId.set(null);
    this._error.set(null);
  }

  async send(message: string): Promise<void> {
    const trimmed = message.trim();
    if (!trimmed || this._typing()) {
      return;
    }
    const userMessage: ChatbotMessage = {
      id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    this._messages.update((current) => [...current, userMessage]);
    this._typing.set(true);
    this._error.set(null);

    try {
      const response = await firstValueFrom(
        this.api.send({
          message: trimmed,
          conversationId: this._conversationId() ?? undefined,
        }),
      );
      this._conversationId.set(response.conversationId);
      const reply: ChatbotMessage = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: response.reply,
        createdAt: new Date().toISOString(),
      };
      this._messages.update((current) => [...current, reply]);
    } catch (error) {
      const message = this.normalizeError(error);
      this._error.set(message);
    } finally {
      this._typing.set(false);
    }
  }

  private normalizeError(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 429) {
      return 'Túl sok kérés a chatbothoz, próbáld újra később.';
    }
    return extractApiErrorMessage(error, 'A chatbot nem érhető el, próbáld újra később.');
  }
}
