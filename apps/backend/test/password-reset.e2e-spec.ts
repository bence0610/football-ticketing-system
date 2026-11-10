import './setup/test-env';

import { createHash } from 'crypto';
import { hash } from 'bcrypt';
import request from 'supertest';
import { Server } from 'http';
import { PasswordResetToken, User } from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

const OLD_PASSWORD = 'RegiJelszo1';
const NEW_PASSWORD = 'UjJelszo2024';
const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');

/**
 * Password reset against the real app, database and Redis. Mail is captured by
 * the test harness (ctx.sentEmails), so the tests read the very link a person
 * would be sent.
 */
describe('Password reset', () => {
  let ctx: TestContext;
  let server: Server;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.httpServer;
  });
  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });
  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
    await ctx.redis.flushdb();
    ctx.sentEmails.length = 0;
    ctx.failingTemplates.clear();
  });

  interface Fan {
    id: string;
    email: string;
    refreshToken: string;
  }

  let counter = 0;
  async function registerFan(tag = 'reset'): Promise<Fan> {
    counter += 1;
    const email = `${tag}-${Date.now()}-${counter}@kte.hu`;
    const res = await request(server).post('/api/auth/register').send({
      email,
      password: OLD_PASSWORD,
      firstName: 'Béla',
      lastName: 'Kovács',
    });
    expect(res.status).toBe(201);
    return { id: res.body.user.id, email, refreshToken: res.body.refreshToken };
  }

  const requestReset = (email: string) =>
    request(server).post('/api/auth/password-reset/request').send({ email });

  const confirm = (token: string, password = NEW_PASSWORD) =>
    request(server).post('/api/auth/password-reset/confirm').send({ token, password });

  const login = (email: string, password: string) =>
    request(server).post('/api/auth/login').send({ email, password });

  /** The token from the link in the mail sent to this address (waits for the background send). */
  async function emailedToken(email: string, nth = 1): Promise<string> {
    const deadline = Date.now() + 4000;
    for (;;) {
      const mails = ctx.sentEmails.filter((m) => m.template === 'password-reset' && m.to === email);
      if (mails.length >= nth) {
        const url = (mails[nth - 1].context as { resetUrl: string }).resetUrl;
        return decodeURIComponent(url.split('/reset-password/')[1]);
      }
      if (Date.now() > deadline) throw new Error(`no reset email for ${email}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  describe('requesting a link', () => {
    it('answers identically for a registered and an unknown address', async () => {
      const fan = await registerFan();
      const known = await requestReset(fan.email);
      const unknown = await requestReset('nincs-ilyen-fiok@kte.hu');

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(unknown.headers['content-length']).toBe(known.headers['content-length']);

      // ...but only the real account was mailed
      await emailedToken(fan.email);
      expect(ctx.sentEmails.filter((m) => m.to === 'nincs-ilyen-fiok@kte.hu')).toHaveLength(0);
    });

    it('answers the same for a deactivated account, and sends nothing to it', async () => {
      const fan = await registerFan();
      const other = await requestReset('x-nobody@kte.hu');
      await ctx.dataSource.getRepository(User).update({ id: fan.id }, { isActive: false });
      const res = await requestReset(fan.email);
      expect(res.status).toBe(other.status);
      expect(res.body).toEqual(other.body);
      await new Promise((r) => setTimeout(r, 200));
      expect(ctx.sentEmails).toHaveLength(0);
    });

    it('stores only a hash of the token, never the token', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);

      const rows = await ctx.dataSource.getRepository(PasswordResetToken).find();
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(sha256(token));
      expect(JSON.stringify(rows[0])).not.toContain(token);
      expect(rows[0].usedAt ?? null).toBeNull();
    });

    it('mails a link that expires, and says nothing happened if they did not ask', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      await emailedToken(fan.email);
      const mail = ctx.sentEmails.find((m) => m.template === 'password-reset')!;
      expect(mail.subject).toContain('Jelszó-visszaállítás');
      expect((mail.context as { validForLabel: string }).validForLabel).toBe('1 óra');

      const row = await ctx.dataSource.getRepository(PasswordResetToken).findOneByOrFail({});
      const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
      expect(minutes).toBeGreaterThan(55);
      expect(minutes).toBeLessThanOrEqual(61);
    });

    it('asking again retires the earlier link: only the newest works', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const first = await emailedToken(fan.email, 1);
      await requestReset(fan.email);
      const second = await emailedToken(fan.email, 2);

      const old = await confirm(first);
      expect(old.status).toBe(400);
      expect(old.body.code).toBe('reset_token_used');
      expect((await confirm(second)).status).toBe(200);
    });

    it('limits each address silently (same answer, no further mail) and each client with a 429', async () => {
      const fan = await registerFan();
      const bodies: unknown[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await requestReset(fan.email);
        expect(res.status).toBe(200);
        bodies.push(res.body);
      }
      expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
      await emailedToken(fan.email, 3);
      await new Promise((r) => setTimeout(r, 300));
      expect(ctx.sentEmails.filter((m) => m.to === fan.email)).toHaveLength(3);

      // per client address: the 11th request in the hour is refused
      await ctx.redis.flushdb();
      let last = 200;
      for (let i = 0; i < 11; i += 1) {
        last = (await requestReset(`flood-${i}@kte.hu`)).status;
      }
      expect(last).toBe(429);
    });

    it('rejects a malformed address with 400 (that says nothing about accounts)', async () => {
      const res = await requestReset('nem-email');
      expect(res.status).toBe(400);
    });
  });

  describe('setting the new password', () => {
    it('changes the password: the new one signs in, the old one no longer does', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);

      const res = await confirm(token);
      expect(res.status).toBe(200);
      expect(res.body.message).toContain('megváltozott');

      expect((await login(fan.email, NEW_PASSWORD)).status).toBe(200);
      expect((await login(fan.email, OLD_PASSWORD)).status).toBe(401);
    });

    it('refuses an expired link with a clear message and changes nothing', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);
      await ctx.dataSource
        .getRepository(PasswordResetToken)
        .update({ tokenHash: sha256(token) }, { expiresAt: new Date(Date.now() - 60_000) });

      const res = await confirm(token);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('reset_token_expired');
      expect(res.body.message).toContain('lejárt');

      const check = await request(server).get(`/api/auth/password-reset/${token}`);
      expect(check.status).toBe(400);
      expect(check.body.code).toBe('reset_token_expired');
      expect((await login(fan.email, OLD_PASSWORD)).status).toBe(200);
    });

    it('refuses a link that was already used', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);
      expect((await confirm(token)).status).toBe(200);

      const again = await confirm(token, 'MasikJelszo99');
      expect(again.status).toBe(400);
      expect(again.body.code).toBe('reset_token_used');
      expect(again.body.message).toContain('felhasználták');
      // the second attempt did not overwrite the password set by the first
      expect((await login(fan.email, NEW_PASSWORD)).status).toBe(200);
    });

    it('refuses a link whose account password changed in the meantime', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);

      // the password changes by some other route after the link was issued
      const other = await hash('Kozben1Valtozott', 4);
      await ctx.dataSource.getRepository(User).update({ id: fan.id }, { passwordHash: other });

      const res = await confirm(token);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('reset_token_used');
      expect(res.body.message).toContain('megváltozott');
      // and the password that was set meanwhile is intact
      expect((await login(fan.email, 'Kozben1Valtozott')).status).toBe(200);
    });

    it('refuses an unknown link', async () => {
      const res = await confirm('x'.repeat(48));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('reset_token_invalid');
    });

    it('applies the registration password rule, and a refused password does not burn the link', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);

      for (const weak of ['12345678', 'abcdefgh', 'abc1234']) {
        const res = await confirm(token, weak);
        expect(res.status).toBe(400);
      }
      expect((await confirm(token, NEW_PASSWORD)).status).toBe(200);
    });
  });

  describe('sessions', () => {
    it('refresh tokens stop working after a reset, on every device', async () => {
      const fan = await registerFan();
      const second = await login(fan.email, OLD_PASSWORD); // a second device
      expect(second.status).toBe(200);

      // both refresh tokens work before the reset (use a copy: refresh rotates)
      const before = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: second.body.refreshToken });
      expect(before.status).toBe(200);
      const stillValid = before.body.refreshToken as string;

      await requestReset(fan.email);
      const token = await emailedToken(fan.email);
      expect((await confirm(token)).status).toBe(200);

      for (const refreshToken of [fan.refreshToken, stillValid]) {
        const after = await request(server).post('/api/auth/refresh').send({ refreshToken });
        expect(after.status).toBe(401);
      }

      // signing in again with the new password gives a working session
      const fresh = await login(fan.email, NEW_PASSWORD);
      const ok = await request(server)
        .post('/api/auth/refresh')
        .send({ refreshToken: fresh.body.refreshToken });
      expect(ok.status).toBe(200);
    });
  });

  describe('telling the owner their password changed', () => {
    const CHROME_ON_WINDOWS =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

    const changedMails = (email: string) =>
      ctx.sentEmails.filter((m) => m.template === 'password-changed' && m.to === email);

    async function waitForChangedMail(email: string) {
      const deadline = Date.now() + 4000;
      while (changedMails(email).length === 0) {
        if (Date.now() > deadline) throw new Error(`no password-changed mail for ${email}`);
        await new Promise((r) => setTimeout(r, 25));
      }
      return changedMails(email)[0];
    }

    async function resetWith(fan: Fan, userAgent?: string) {
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);
      const req = request(server)
        .post('/api/auth/password-reset/confirm')
        .send({ token, password: NEW_PASSWORD });
      if (userAgent) req.set('User-Agent', userAgent);
      const res = await req;
      return { token, res };
    }

    it('mails the account owner after a reset: when, roughly from where, and who to write to', async () => {
      const fan = await registerFan();
      const { res } = await resetWith(fan, CHROME_ON_WINDOWS);
      expect(res.status).toBe(200);

      const mail = await waitForChangedMail(fan.email);
      const ctxt = mail.context as {
        recipientName: string;
        changedAtLabel: string;
        clientLabel?: string;
        supportEmail: string;
      };
      expect(mail.subject).toContain('A jelszavad megváltozott');
      expect(ctxt.recipientName).toBe('Béla');
      // "2026. november 10. 20:41", in the stadium's timezone
      expect(ctxt.changedAtLabel).toMatch(/^\d{4}\. \p{L}+ \d{1,2}\.,? \d{2}:\d{2}$/u);
      // browser and system, and an address with its last part hidden - never the full address
      expect(ctxt.clientLabel).toContain('Chrome, Windows');
      expect(ctxt.clientLabel).toMatch(/\.x$/);
      expect(ctxt.clientLabel).not.toContain('127.0.0.1');
      expect(ctxt.supportEmail).toBe('jegy@kte.hu');
    });

    it('carries neither the new password nor any token', async () => {
      const fan = await registerFan();
      const { token } = await resetWith(fan, CHROME_ON_WINDOWS);
      const mail = await waitForChangedMail(fan.email);

      const everything = JSON.stringify(mail);
      expect(everything).not.toContain(NEW_PASSWORD);
      expect(everything).not.toContain(OLD_PASSWORD);
      expect(everything).not.toContain(token);
      expect(everything).not.toContain(sha256(token));
      expect(everything).not.toContain('reset-password');
    });

    it('goes only to the account that changed', async () => {
      const fan = await registerFan('owner');
      const bystander = await registerFan('bystander');
      await resetWith(fan);
      await waitForChangedMail(fan.email);
      expect(changedMails(bystander.email)).toHaveLength(0);
    });

    it('says what it knows: with no User-Agent it still says when, and never prints "undefined"', async () => {
      const fan = await registerFan();
      await resetWith(fan);
      const mail = await waitForChangedMail(fan.email);
      const ctxt = mail.context as { changedAtLabel: string; clientLabel?: string };
      expect(ctxt.changedAtLabel.length).toBeGreaterThan(10);
      expect(String(ctxt.clientLabel ?? '')).not.toContain('undefined');
    });

    it('is not sent when the reset is refused (expired link, used link, weak password)', async () => {
      const fan = await registerFan();
      await requestReset(fan.email);
      const token = await emailedToken(fan.email);

      expect((await confirm(token, 'gyenge')).status).toBe(400); // weak: validation refuses it
      await ctx.dataSource
        .getRepository(PasswordResetToken)
        .update({ tokenHash: sha256(token) }, { expiresAt: new Date(Date.now() - 60_000) });
      expect((await confirm(token)).status).toBe(400); // expired

      await new Promise((r) => setTimeout(r, 300));
      expect(changedMails(fan.email)).toHaveLength(0);
    });

    it('is sent once per reset, not again when the same link is replayed', async () => {
      const fan = await registerFan();
      const { token } = await resetWith(fan);
      await waitForChangedMail(fan.email);
      expect((await confirm(token)).status).toBe(400); // replay refused
      await new Promise((r) => setTimeout(r, 300));
      expect(changedMails(fan.email)).toHaveLength(1);
    });

    it('a mail that cannot be sent does not undo the reset', async () => {
      const fan = await registerFan();
      ctx.failingTemplates.add('password-changed');
      try {
        const { res } = await resetWith(fan);
        expect(res.status).toBe(200);
        // the password did change and the old sessions are gone, mail or no mail
        expect((await login(fan.email, NEW_PASSWORD)).status).toBe(200);
        const refresh = await request(server)
          .post('/api/auth/refresh')
          .send({ refreshToken: fan.refreshToken });
        expect(refresh.status).toBe(401);
      } finally {
        ctx.failingTemplates.delete('password-changed');
      }
    });
  });
});
