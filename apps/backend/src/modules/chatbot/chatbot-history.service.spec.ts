import { ConfigService } from '@nestjs/config';
import { ChatbotHistoryService } from './chatbot-history.service';

describe('ChatbotHistoryService', () => {
  let redis: Record<string, jest.Mock>;
  let pipe: Record<string, jest.Mock>;
  let service: ChatbotHistoryService;

  beforeEach(() => {
    pipe = {
      lpush: jest.fn(() => pipe),
      ltrim: jest.fn(() => pipe),
      expire: jest.fn(() => pipe),
      exec: jest.fn(async () => []),
    };
    redis = {
      lrange: jest.fn(),
      get: jest.fn(),
      set: jest.fn(async () => 'OK'),
      expire: jest.fn(async () => 1),
      del: jest.fn(async () => 1),
      pipeline: jest.fn(() => pipe),
    };
    const config = {
      getOrThrow: () => ({ historyTtlSeconds: 100, historyMaxMessages: 4 }),
    } as unknown as ConfigService;
    service = new ChatbotHistoryService(redis as never, config);
  });

  it('returns messages oldest-first and skips corrupt entries', async () => {
    redis.lrange.mockResolvedValue([
      JSON.stringify({ role: 'assistant', content: 'b', createdAt: 't' }),
      'not json',
      JSON.stringify({ role: 'system', content: 'x', createdAt: 't' }),
      JSON.stringify({ role: 'user', content: 'a', createdAt: 't' }),
    ]);
    const out = await service.load('c1');
    expect(out.map((m) => m.content)).toEqual(['a', 'b']);
    expect(redis.lrange).toHaveBeenCalledWith(expect.stringContaining('c1'), 0, 3);
  });

  it('load degrades to an empty history on Redis errors', async () => {
    redis.lrange.mockRejectedValue(new Error('down'));
    await expect(service.load('c1')).resolves.toEqual([]);
  });

  it('append caps the list and refreshes the TTL', async () => {
    await service.append('c1', { role: 'user', content: 'hi', createdAt: 't' });
    expect(pipe.ltrim).toHaveBeenCalledWith(expect.any(String), 0, 3);
    expect(pipe.expire).toHaveBeenCalledWith(expect.any(String), 100);
  });

  it('claim only sets the owner when none exists (NX) with the history TTL', async () => {
    await service.claim('c1', 'user:u1');
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('c1'),
      'user:u1',
      'EX',
      100,
      'NX',
    );
  });

  it('getOwner returns null for an unknown id and propagates Redis errors', async () => {
    redis.get.mockResolvedValueOnce(null);
    await expect(service.getOwner('nope')).resolves.toBeNull();
    redis.get.mockRejectedValueOnce(new Error('down'));
    await expect(service.getOwner('c1')).rejects.toThrow('down');
  });

  it('clear removes both the history and the owner record', async () => {
    await service.clear('c1');
    expect(redis.del).toHaveBeenCalledWith(
      expect.stringContaining('c1'),
      expect.stringContaining('c1'),
    );
  });
});
