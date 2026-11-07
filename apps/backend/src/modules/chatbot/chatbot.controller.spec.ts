import { resolveChatbotOwner } from './chatbot-caller';
import { ChatbotController } from './chatbot.controller';

describe('ChatbotController', () => {
  const sendMessage = jest.fn(async () => ({ conversationId: 'c', reply: 'r', model: 'm' }));
  const controller = new ChatbotController({ sendMessage } as never);
  const req = (ip: string) => ({ headers: {}, ip }) as never;
  const user = { id: 'u1', email: 'a@b.hu', role: 'fan' } as never;

  beforeEach(() => sendMessage.mockClear());

  it('binds the conversation to the authenticated user, not to the client IP', async () => {
    await controller.sendMessage({ message: 'hi', conversationId: 'c' }, user, req('1.1.1.1'));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'user:u1', conversationId: 'c' }),
    );
  });

  it('binds anonymous callers to a hash of their IP (stable per IP, different across IPs)', () => {
    const a1 = resolveChatbotOwner(req('1.1.1.1'), undefined);
    expect(a1).toMatch(/^anon:[0-9a-f]{32}$/);
    expect(a1).not.toContain('1.1.1.1');
    expect(resolveChatbotOwner(req('1.1.1.1'), undefined)).toBe(a1);
    expect(resolveChatbotOwner(req('2.2.2.2'), undefined)).not.toBe(a1);
  });

  it('returns the service reply unchanged', async () => {
    await expect(
      controller.sendMessage({ message: 'hi' }, undefined, req('1.1.1.1')),
    ).resolves.toEqual({ conversationId: 'c', reply: 'r', model: 'm' });
  });
});
