import type { Request } from 'express';
import { extractClientIp, resolveChatbotOwner } from './chatbot-caller';

const req = (over: Partial<Request>): Request => ({ headers: {}, ...over }) as unknown as Request;

describe('chatbot caller identity', () => {
  it('uses req.ip and never the caller-controlled X-Forwarded-For header', () => {
    const r = req({ ip: '198.51.100.20', headers: { 'x-forwarded-for': '203.0.113.7' } });
    expect(extractClientIp(r)).toBe('198.51.100.20');
  });

  it('falls back to the socket address, then to "unknown"', () => {
    expect(
      extractClientIp(req({ socket: { remoteAddress: '192.0.2.1' } as Request['socket'] })),
    ).toBe('192.0.2.1');
    expect(extractClientIp(req({}))).toBe('unknown');
  });

  it('gives two anonymous callers who differ only in a forged header the SAME owner (no fresh identity per header)', () => {
    const a = resolveChatbotOwner(
      req({ ip: '198.51.100.20', headers: { 'x-forwarded-for': '1.1.1.1' } }),
      undefined,
    );
    const b = resolveChatbotOwner(
      req({ ip: '198.51.100.20', headers: { 'x-forwarded-for': '2.2.2.2' } }),
      undefined,
    );
    expect(a).toBe(b);
  });
});
