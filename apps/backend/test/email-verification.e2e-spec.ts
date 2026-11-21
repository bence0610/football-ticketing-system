import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import {
  EmailVerificationToken,
  PassLoan,
  PassLoanStatus,
  SeasonPassPrice,
  User,
} from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedMinimalFixture, seedSeasonPass, truncateAll } from './helpers/db.helper';

/**
 * E-mail verification at registration (F9), end to end: the emailed one-time link verifies the
 * address; until then the account sees no incoming loan invitations, cannot accept one and cannot
 * be named as a pass holder.
 */
describe('E-mail verification (E2E)', () => {
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
  });

  interface Fan {
    userId: string;
    email: string;
    token: string;
    emailVerified: boolean;
  }

  async function register(prefix = 'verify'): Promise<Fan> {
    const email = `${prefix}-${randomUUID().slice(0, 8)}@kte.hu`;
    const res = await request(server)
      .post('/api/auth/register')
      .send({ email, password: 'Teszt1234!', firstName: 'Teszt', lastName: 'Elek' });
    expect(res.status).toBe(201);
    return {
      userId: res.body.user.id as string,
      email,
      token: res.body.accessToken as string,
      emailVerified: res.body.user.emailVerified as boolean,
    };
  }

  /** The newest verification link mailed to the address: the very token a person would click. */
  async function linkTokenFor(email: string): Promise<string> {
    // The registration mail is sent in the background.
    for (let i = 0; i < 40; i++) {
      const mails = ctx.sentEmails.filter(
        (m) => m.template === 'email-verification' && m.to === email,
      );
      if (mails.length > 0) {
        const url = (mails[mails.length - 1].context as { verifyUrl: string }).verifyUrl;
        return decodeURIComponent(url.split('/verify-email/')[1]);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no verification mail for ${email}`);
  }

  const confirm = (token: string) =>
    request(server).post('/api/auth/verify-email/confirm').send({ token });
  const verifiedInDb = async (userId: string): Promise<boolean> =>
    (await ctx.dataSource.getRepository(User).findOneOrFail({ where: { id: userId } }))
      .emailVerified;
  const markVerified = (userId: string) =>
    ctx.dataSource.getRepository(User).update({ id: userId }, { emailVerified: true });

  describe('the link', () => {
    it('registration starts unverified and mails one link; opening it verifies the address', async () => {
      const fan = await register();
      expect(fan.emailVerified).toBe(false);
      expect(await verifiedInDb(fan.userId)).toBe(false);

      const token = await linkTokenFor(fan.email);
      expect(token.length).toBeGreaterThanOrEqual(40);
      // Only the hash is stored, never the token.
      const rows = await ctx.dataSource.getRepository(EmailVerificationToken).find();
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toContain(token);

      const res = await confirm(token);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(fan.email);
      expect(await verifiedInDb(fan.userId)).toBe(true);

      // The next sign-in says so too.
      const login = await request(server)
        .post('/api/auth/login')
        .send({ email: fan.email, password: 'Teszt1234!' });
      expect(login.body.user.emailVerified).toBe(true);
    });

    it('is single use, and an unknown or garbled link is refused', async () => {
      const fan = await register();
      const token = await linkTokenFor(fan.email);
      expect((await confirm(token)).status).toBe(200);

      const again = await confirm(token);
      expect(again.status).toBe(400);
      expect(again.body.code).toBe('verification_token_used');

      const unknown = await confirm('x'.repeat(48));
      expect(unknown.status).toBe(400);
      expect(unknown.body.code).toBe('verification_token_invalid');
    });

    it('expires', async () => {
      const fan = await register();
      const token = await linkTokenFor(fan.email);
      await ctx.dataSource
        .getRepository(EmailVerificationToken)
        .update({ userId: fan.userId }, { expiresAt: new Date(Date.now() - 1000) });
      const res = await confirm(token);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('verification_token_expired');
      expect(await verifiedInDb(fan.userId)).toBe(false);
    });

    it('does not verify an address the account no longer has', async () => {
      const fan = await register();
      const token = await linkTokenFor(fan.email);
      await ctx.dataSource
        .getRepository(User)
        .update({ id: fan.userId }, { email: `moved-${randomUUID().slice(0, 6)}@kte.hu` });
      const res = await confirm(token);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('verification_token_invalid');
      expect(await verifiedInDb(fan.userId)).toBe(false);
    });

    it('a new link retires the old one, and a verified account is not mailed again', async () => {
      const fan = await register();
      const first = await linkTokenFor(fan.email);

      const resend = await request(server)
        .post('/api/auth/verify-email/resend')
        .set('Authorization', `Bearer ${fan.token}`);
      expect(resend.status).toBe(200);
      expect(resend.body.alreadyVerified).toBe(false);
      const second = await linkTokenFor(fan.email);
      expect(second).not.toBe(first);

      const stale = await confirm(first);
      expect(stale.status).toBe(400);
      expect(stale.body.code).toBe('verification_token_used');
      expect((await confirm(second)).status).toBe(200);

      const mails = ctx.sentEmails.length;
      const again = await request(server)
        .post('/api/auth/verify-email/resend')
        .set('Authorization', `Bearer ${fan.token}`);
      expect(again.status).toBe(200);
      expect(again.body.alreadyVerified).toBe(true);
      expect(ctx.sentEmails.length).toBe(mails);
    });

    it('limits how many links an account can ask for in an hour', async () => {
      const fan = await register();
      await linkTokenFor(fan.email);
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await request(server)
          .post('/api/auth/verify-email/resend')
          .set('Authorization', `Bearer ${fan.token}`);
        statuses.push(res.status);
      }
      expect(statuses).toContain(429);
      expect(statuses[0]).toBe(200);
    });

    it('resending needs a signed-in account', async () => {
      expect((await request(server).post('/api/auth/verify-email/resend')).status).toBe(401);
    });
  });

  describe('what an unverified address may not do', () => {
    async function loanFixture(): Promise<{
      owner: Fan;
      borrower: Fan;
      loanId: string;
      invitationToken: string;
    }> {
      const { match, seatA } = await seedMinimalFixture(ctx.dataSource, {
        seasonPassEligible: true,
      });
      const owner = await register('owner');
      await markVerified(owner.userId);
      const borrower = await register('borrower');
      const pass = await seedSeasonPass(ctx.dataSource, {
        userId: owner.userId,
        seatId: seatA.id,
      });
      const created = await request(server)
        .post(`/api/season-passes/${pass.id}/loans`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ matchId: match.id, borrowerEmail: borrower.email });
      expect(created.status).toBe(201);
      const loan = await ctx.dataSource
        .getRepository(PassLoan)
        .findOneOrFail({ where: { id: created.body.id } });
      return {
        owner,
        borrower,
        loanId: loan.id,
        invitationToken: loan.invitationToken,
      };
    }

    const incoming = (token: string) =>
      request(server)
        .get('/api/season-passes/loans/incoming')
        .set('Authorization', `Bearer ${token}`);
    const accept = (token: string, invitation: string) =>
      request(server)
        .post(`/api/season-passes/loans/accept/${invitation}`)
        .set('Authorization', `Bearer ${token}`);

    it('sees no incoming invitation and cannot accept one, until the address is verified', async () => {
      const { borrower, loanId, invitationToken } = await loanFixture();

      const list = await incoming(borrower.token);
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);

      const refused = await accept(borrower.token, invitationToken);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('email_not_verified');
      const loan = await ctx.dataSource
        .getRepository(PassLoan)
        .findOneOrFail({ where: { id: loanId } });
      expect(loan.status).toBe(PassLoanStatus.PENDING);

      // The link in the registration mail unlocks both.
      expect((await confirm(await linkTokenFor(borrower.email))).status).toBe(200);
      const after = await incoming(borrower.token);
      expect(after.body).toHaveLength(1);
      expect((await accept(borrower.token, invitationToken)).status).toBe(200);
    });

    it('cannot be named as a pass holder, but a verified address can', async () => {
      await ctx.dataSource.getRepository(SeasonPassPrice).save(
        ctx.dataSource.getRepository(SeasonPassPrice).create({
          section: 'upper',
          sectionLabel: 'Felső ív',
          seasonLabel: '2026/2027',
          price: 30000,
          currency: 'HUF',
          validFrom: new Date('2026-07-01'),
          validUntil: new Date('2027-06-30'),
          isActive: true,
        }),
      );
      const buyer = await register('buyer');
      const holder = await register('holder');
      const purchase = () =>
        request(server)
          .post('/api/season-passes/purchase')
          .set('Authorization', `Bearer ${buyer.token}`)
          .send({
            sectionId: 'upper',
            seatId: randomUUID(),
            holdToken: 'x',
            holderEmail: holder.email,
          });

      const refused = await purchase();
      expect(refused.status).toBe(400);
      expect(refused.body.code).toBe('holder_email_not_verified');

      await markVerified(holder.userId);
      const next = await purchase();
      // No longer refused for the address (it fails later, on the made-up seat).
      expect(next.body.code).not.toBe('holder_email_not_verified');
    });

    it('can still buy and hold single tickets: only loans and holders need the verified address', async () => {
      const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
      const fan = await register();
      const lock = await request(server)
        .post(`/api/matches/${match.id}/seats/${seatA.id}/lock`)
        .set('Authorization', `Bearer ${fan.token}`);
      expect(lock.status).toBe(201);
    });
  });
});
