import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ChatbotConfig } from '../../config';
import { REDIS_CLIENT, RedisKeys } from '../../redis/redis.constants';

export type ChatbotRole = 'user' | 'assistant';

export interface ChatbotMessage {
  role: ChatbotRole;
  content: string;
  createdAt: string;
}

/**
 * Persists short conversation histories in Redis as a capped list (LPUSH +
 * LTRIM ringbuffer). TTL is refreshed on each write so abandoned chats are
 * reaped automatically.
 */
@Injectable()
export class ChatbotHistoryService {
  private readonly logger = new Logger(ChatbotHistoryService.name);
  private readonly ttlSeconds: number;
  private readonly maxMessages: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    configService: ConfigService,
  ) {
    const config = configService.getOrThrow<ChatbotConfig>('chatbot');
    this.ttlSeconds = config.historyTtlSeconds;
    this.maxMessages = config.historyMaxMessages;
  }

  async load(conversationId: string): Promise<ChatbotMessage[]> {
    try {
      const key = RedisKeys.chatbotConversation(conversationId);
      const raw = await this.redis.lrange(key, 0, this.maxMessages - 1);
      // List is stored newest-first via LPUSH; reverse for chronological order.
      return raw
        .map((entry) => this.tryParse(entry))
        .filter((m): m is ChatbotMessage => m !== null)
        .reverse();
    } catch (error) {
      this.logger.warn(
        `Chatbot history load failed for ${conversationId}: ${(error as Error).message}`,
      );
      return [];
    }
  }

  async append(conversationId: string, message: ChatbotMessage): Promise<void> {
    try {
      const key = RedisKeys.chatbotConversation(conversationId);
      const pipeline = this.redis.pipeline();
      pipeline.lpush(key, JSON.stringify(message));
      pipeline.ltrim(key, 0, this.maxMessages - 1);
      pipeline.expire(key, this.ttlSeconds);
      await pipeline.exec();
    } catch (error) {
      this.logger.warn(
        `Chatbot history append failed for ${conversationId}: ${(error as Error).message}`,
      );
    }
  }

  async clear(conversationId: string): Promise<void> {
    try {
      await this.redis.del(RedisKeys.chatbotConversation(conversationId));
    } catch (error) {
      this.logger.warn(
        `Chatbot history clear failed for ${conversationId}: ${(error as Error).message}`,
      );
    }
  }

  private tryParse(entry: string): ChatbotMessage | null {
    try {
      const parsed = JSON.parse(entry) as ChatbotMessage;
      if (!parsed || (parsed.role !== 'user' && parsed.role !== 'assistant')) {
        return null;
      }
      if (typeof parsed.content !== 'string') {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
}
