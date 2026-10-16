import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ChatbotMessage } from '../../shared/models/chatbot.model';

@Component({
  selector: 'kte-chatbot-message',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="kte-chatbot-msg" [class.kte-chatbot-msg--user]="message.role === 'user'">
      <div class="kte-chatbot-msg__bubble">
        {{ message.content }}
      </div>
    </div>
  `,
  styles: [
    `
      .kte-chatbot-msg {
        display: flex;
        margin-bottom: 8px;
      }
      .kte-chatbot-msg__bubble {
        max-width: 80%;
        padding: 10px 14px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--kte-surface);
        border-radius: 14px 14px 14px 4px;
        font-size: 14px;
        line-height: 1.45;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .kte-chatbot-msg--user {
        justify-content: flex-end;
      }
      .kte-chatbot-msg--user .kte-chatbot-msg__bubble {
        background: var(--kte-brand-mid);
        color: var(--kte-surface);
        border-radius: 14px 14px 4px 14px;
      }
    `,
  ],
})
export class ChatbotMessageComponent {
  @Input({ required: true }) message!: ChatbotMessage;
}
