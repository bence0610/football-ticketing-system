import Anthropic from '@anthropic-ai/sdk';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AnthropicConfig } from '../../config';
import { ChatbotContextService, ChatbotMatchSnapshot } from './chatbot-context.service';
import { ChatbotHistoryService, ChatbotMessage } from './chatbot-history.service';

const SYSTEM_PROMPT_HEADER = `Te a "KTE AI Asszisztens" vagy, a Kecskeméti TE (KTE) hivatalos jegyportáljának chatbotja.
Magyar nyelven, segítőkészen és tömören válaszolj a szurkolóknak.

Felelősséged:
- Meccs információk (időpont, hely, ellenfél, jegyárak)
- Jegyvásárlási folyamat segítsége
- Hűségprogram és bérletek magyarázata
- Stadion információk (Széktói Stadion, Kecskemét)
- Általános KTE klubinformációk

Ha nem tudod a választ, irányítsd a felhasználót az ügyfélszolgálathoz: jegy@kte.hu.
A személyes adatokra (saját jegy, saját rendelés) vonatkozó kérdéseket utasítsd el — azokat a profil oldalon érheti el a felhasználó.

A jelenleg ismert következő mérkőzések:`;

export interface ChatbotReply {
  conversationId: string;
  reply: string;
  model: string;
}

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private readonly anthropicConfig: AnthropicConfig;
  private readonly client: Anthropic;

  constructor(
    private readonly configService: ConfigService,
    private readonly contextService: ChatbotContextService,
    private readonly historyService: ChatbotHistoryService,
  ) {
    this.anthropicConfig = this.configService.getOrThrow<AnthropicConfig>('anthropic');
    this.client = new Anthropic({ apiKey: this.anthropicConfig.apiKey });
  }

  describe(): { model: string; status: 'configured' } {
    return { model: this.anthropicConfig.model, status: 'configured' };
  }

  /**
   * Single-shot prompt to Claude with prompt caching enabled on the system
   * block (the upcoming-matches snapshot rarely changes within a 5 minute
   * window). Conversation history is loaded from Redis, the new user
   * message is prepended, and both turns are persisted after the response.
   *
   * Uses the beta `prompt-caching-2024-07-31` header so `cache_control`
   * markers are honored on system blocks.
   */
  async sendMessage(params: {
    message: string;
    conversationId?: string;
    userLabel?: string;
  }): Promise<ChatbotReply> {
    const conversationId = params.conversationId?.trim() || randomUUID();
    const trimmed = params.message.trim();
    if (!trimmed) {
      throw new InternalServerErrorException('Üres üzenet nem küldhető.');
    }

    const [history, context] = await Promise.all([
      this.historyService.load(conversationId),
      this.contextService.getUpcomingMatchesSnapshot(),
    ]);

    // System blocks: header (small, not cached) + matches snapshot (cached).
    // The snapshot is keyed by the Redis cache TTL (5 min) so the cache hit
    // rate stays high across the same window.
    const systemBlocks = [
      { type: 'text' as const, text: SYSTEM_PROMPT_HEADER },
      {
        type: 'text' as const,
        text: this.formatContextBlock(context.upcomingMatches),
        cache_control: { type: 'ephemeral' as const },
      },
    ];

    const messages = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: trimmed },
    ];

    let assistantText: string;
    try {
      const response = await this.client.beta.promptCaching.messages.create({
        model: this.anthropicConfig.model,
        max_tokens: this.anthropicConfig.maxTokens,
        system: systemBlocks,
        messages,
      });
      assistantText = this.extractText(response);
      this.logger.log(
        `Chatbot reply conv=${conversationId} user=${params.userLabel ?? 'anon'} in=${response.usage.input_tokens} out=${response.usage.output_tokens} cache_read=${response.usage.cache_read_input_tokens ?? 0} cache_create=${response.usage.cache_creation_input_tokens ?? 0}`,
      );
    } catch (error) {
      this.logger.error(`Anthropic call failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'A chatbot szolgáltatás jelenleg nem elérhető. Próbáld újra később.',
      );
    }

    const now = new Date().toISOString();
    const userTurn: ChatbotMessage = { role: 'user', content: trimmed, createdAt: now };
    const assistantTurn: ChatbotMessage = {
      role: 'assistant',
      content: assistantText,
      createdAt: now,
    };
    await this.historyService.append(conversationId, userTurn);
    await this.historyService.append(conversationId, assistantTurn);

    return {
      conversationId,
      reply: assistantText,
      model: this.anthropicConfig.model,
    };
  }

  private extractText(response: Anthropic.Beta.PromptCaching.PromptCachingBetaMessage): string {
    const parts: string[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        parts.push(block.text);
      }
    }
    const joined = parts.join('').trim();
    return joined || 'Sajnálom, jelenleg nem tudok választ adni.';
  }

  private formatContextBlock(matches: ChatbotMatchSnapshot[]): string {
    if (matches.length === 0) {
      return 'Jelenleg nincs közelgő mérkőzés a rendszerben.';
    }
    const lines: string[] = [];
    for (const match of matches) {
      const kickoff = new Date(match.kickoffAt);
      const dateLabel = new Intl.DateTimeFormat('hu-HU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Budapest',
      }).format(kickoff);
      lines.push(
        `- ${match.homeTeam} vs ${match.awayTeam} (${match.competition})
  Időpont: ${dateLabel}, helyszín: ${match.venue}
  Alapár: ${match.basePrice.toLocaleString('hu-HU')} Ft, kapacitás: ${match.capacity}
  Elkelt: ${match.soldSeats} (${match.occupancyPercent}%), szabad: ${match.availableSeats}
  Státusz: ${match.status}`,
      );
    }
    return lines.join('\n\n');
  }
}
