import express from 'express';
import request from 'supertest';
import { envValidationSchema } from './env.validation';
import { parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it('is off by default and for the explicit "no proxy" spellings (local development)', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });

  it('reads a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('reads a list of proxy addresses, names and ranges', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback,10.0.0.0/8');
  });

  it('refuses bare true, which would let callers choose their own IP', () => {
    expect(() => parseTrustProxy('true')).toThrow(/not accepted/);
    expect(() => parseTrustProxy('TRUE')).toThrow(/not accepted/);
  });

  it('refuses nonsense', () => {
    expect(() => parseTrustProxy('1,,2')).toThrow();
    expect(() => parseTrustProxy('a b')).toThrow();
  });

  it('is validated at startup: the schema accepts the good values and rejects true', () => {
    const base = {
      APP_URL: 'http://x.test',
      FRONTEND_URL: 'http://x.test',
      CORS_ORIGINS: 'http://x.test',
    };
    const check = (value?: string) =>
      envValidationSchema.validate(
        { ...base, ...(value === undefined ? {} : { TRUST_PROXY: value }) },
        { allowUnknown: true, abortEarly: false },
      );
    const errorsOf = (value?: string) =>
      (check(value).error?.details ?? []).filter((d) => d.path[0] === 'TRUST_PROXY');
    expect(errorsOf()).toEqual([]);
    expect(errorsOf('1')).toEqual([]);
    expect(errorsOf('loopback')).toEqual([]);
    expect(errorsOf('true').length).toBe(1);
    expect(errorsOf('true')[0].message).toContain('not accepted');
  });
});

/**
 * What the setting does to `req.ip`, the value every IP-based rate limit keys on,
 * on a real Express app and real requests.
 */
describe('trust proxy and req.ip', () => {
  function app(setting: boolean | number | string) {
    const a = express();
    a.set('trust proxy', setting);
    a.get('/ip', (req, res) => res.json({ ip: req.ip }));
    return a;
  }
  const spoofed = '203.0.113.7';

  it('without a proxy configured, X-Forwarded-For is ignored: a caller cannot pick their own address', async () => {
    const res = await request(app(parseTrustProxy('false')))
      .get('/ip')
      .set('X-Forwarded-For', spoofed);
    expect(res.body.ip).not.toBe(spoofed);
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(res.body.ip);
  });

  it('behind one proxy it takes the address that proxy saw, not what the caller prepended', async () => {
    // the caller sent "spoofed"; the (single, trusted) proxy appended the real client address
    const res = await request(app(parseTrustProxy('1')))
      .get('/ip')
      .set('X-Forwarded-For', `${spoofed}, 198.51.100.20`);
    expect(res.body.ip).toBe('198.51.100.20');
  });

  it('trusting nothing but a named range ignores the header from any other peer', async () => {
    const res = await request(app(parseTrustProxy('10.0.0.0/8')))
      .get('/ip')
      .set('X-Forwarded-For', spoofed);
    expect(res.body.ip).not.toBe(spoofed);
  });
});
