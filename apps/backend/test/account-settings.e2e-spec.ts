import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import {
  Competition,
  EmailChangeToken,
  LoyaltyTransaction,
  LoyaltyTransactionSource,
  Match,
  MatchStatus,
  PassLoan,
  PassLoanStatus,
  SeasonPass,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
} from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedMinimalFixture, seedSeasonPass, truncateAll } from './helpers/db.helper';

const PASSWORD = 'RegiJelszo1';
const NEW_PASSWORD = 'UjJelszo2024';

/**
 * Account settings against the real app, database and Redis: changing the
 * password while signed in, editing the profile, and changing the e-mail
 * address (confirm before effect). Mail is captured by the harness
 * (ctx.sentEmails), so the tests read the very link a person would be sent.
 */
describe('Account settings', () => {
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
    accessToken: string;
    refreshToken: string;
  }

  let counter = 0;
  const uniqueEmail = (tag: string): string => {
    counter += 1;
    return `${tag}-${Date.now()}-${counter}@kte.hu`;
  };

  async function registerFan(tag = 'acct', email = uniqueEmail(tag)): Promise<Fan> {
    const res = await request(server).post('/api/auth/register').send({
      email,
      password: PASSWORD,
      firstName: 'Béla',
      lastName: 'Kovács',
    });
    expect(res.status).toBe(201);
    return {
      id: res.body.user.id,
      email,
      accessToken: res.body.accessToken,
      refreshToken: res.body.refreshToken,
    };
  }

  const login = (email: string, password: string) =>
    request(server).post('/api/auth/login').send({ email, password });
  const refresh = (refreshToken: string) =>
    request(server).post('/api/auth/refresh').send({ refreshToken });
  const bearer = (fan: Fan) => ({ Authorization: `Bearer ${fan.accessToken}` });

  const changePassword = (fan: Fan, currentPassword: string, newPassword: string) =>
    request(server)
      .post('/api/auth/change-password')
      .set(bearer(fan))
      .send({ currentPassword, newPassword });

  const patchMe = (fan: Fan, body: Record<string, unknown>) =>
    request(server).patch('/api/users/me').set(bearer(fan)).send(body);
  const getMe = (fan: Fan) => request(server).get('/api/users/me').set(bearer(fan));

  const requestEmailChange = (fan: Fan, newEmail: string, currentPassword = PASSWORD) =>
    request(server)
      .post('/api/users/me/email-change')
      .set(bearer(fan))
      .send({ newEmail, currentPassword });
  const confirmEmail = (token: string) =>
    request(server).post('/api/auth/confirm-email-change').send({ token });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** The n-th mail of a template to an address (waits for the background send). */
  async function mailTo(template: string, to: string, nth = 1) {
    const deadline = Date.now() + 4000;
    for (;;) {
      const mails = ctx.sentEmails.filter((m) => m.template === template && m.to === to);
      if (mails.length >= nth) return mails[nth - 1];
      if (Date.now() > deadline) throw new Error(`no ${template} mail for ${to}`);
      await sleep(25);
    }
  }
  /** Gives background sends time to (not) happen, then counts. */
  async function countMails(template: string, to: string): Promise<number> {
    await sleep(300);
    return ctx.sentEmails.filter((m) => m.template === template && m.to === to).length;
  }

  async function emailChangeToken(fan: Fan, newEmail: string, nth = 1): Promise<string> {
    const mail = await mailTo('email-change-confirm', newEmail, nth);
    const url = (mail.context as { confirmUrl: string }).confirmUrl;
    expect(url).toContain('/confirm-email/');
    expect(fan.id).toBeTruthy();
    return decodeURIComponent(url.split('/confirm-email/')[1]);
  }

  /** Requests a change and returns the token from the mail to the new address. */
  async function startEmailChange(fan: Fan, newEmail: string): Promise<string> {
    const res = await requestEmailChange(fan, newEmail);
    expect(res.status).toBe(202);
    return emailChangeToken(fan, newEmail);
  }

  // ---------------------------------------------------------------------------
  describe('changing the password while signed in', () => {
    it('changes the password: the new one signs in, the old one no longer does', async () => {
      const fan = await registerFan();
      const res = await changePassword(fan, PASSWORD, NEW_PASSWORD);
      expect(res.status).toBe(200);

      expect((await login(fan.email, NEW_PASSWORD)).status).toBe(200);
      expect((await login(fan.email, PASSWORD)).status).toBe(401);
    });

    it('answers like a login: a fresh token pair, the user, and the refresh cookie', async () => {
      const fan = await registerFan();
      const res = await changePassword(fan, PASSWORD, NEW_PASSWORD);

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).not.toBe(fan.refreshToken);
      expect(res.body.user).toMatchObject({ id: fan.id, email: fan.email });
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      const cookie = cookies.find((c) => c.startsWith('kte_refresh_token='));
      expect(cookie).toBeDefined();
      expect(cookie).toContain(res.body.refreshToken);
      expect(cookie).toContain('HttpOnly');
    });

    it('keeps the calling session alive: its returned refresh token works afterwards', async () => {
      const fan = await registerFan();
      const res = await changePassword(fan, PASSWORD, NEW_PASSWORD);
      expect(res.status).toBe(200);

      const next = await refresh(res.body.refreshToken);
      expect(next.status).toBe(200);
      // the new access token works on a protected route
      const me = await request(server)
        .get('/api/users/me')
        .set({ Authorization: `Bearer ${res.body.accessToken}` });
      expect(me.status).toBe(200);
    });

    it('signs every other session out: the refresh token of the first login and of a second device are dead', async () => {
      const fan = await registerFan();
      const second = await login(fan.email, PASSWORD);
      expect(second.status).toBe(200);
      expect((await refresh(second.body.refreshToken)).status).toBe(200); // alive before (rotated; this copy is spent)
      const secondLive = (await login(fan.email, PASSWORD)).body.refreshToken as string;

      const res = await changePassword(fan, PASSWORD, NEW_PASSWORD);
      expect(res.status).toBe(200);

      for (const refreshToken of [fan.refreshToken, secondLive]) {
        expect((await refresh(refreshToken)).status).toBe(401);
      }
    });

    it('mails the account address once, with when and where from, and no password', async () => {
      const fan = await registerFan();
      const res = await changePassword(fan, PASSWORD, NEW_PASSWORD).set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      );
      expect(res.status).toBe(200);

      const mail = await mailTo('password-changed', fan.email);
      expect(mail.subject).toContain('A jelszavad megváltozott');
      expect(JSON.stringify(mail)).not.toContain(NEW_PASSWORD);
      expect(JSON.stringify(mail)).not.toContain(PASSWORD);
      expect(await countMails('password-changed', fan.email)).toBe(1);
    });

    it('retires outstanding password-reset links', async () => {
      const fan = await registerFan();
      await request(server).post('/api/auth/password-reset/request').send({ email: fan.email });
      const resetMail = await mailTo('password-reset', fan.email);
      const token = decodeURIComponent(
        (resetMail.context as { resetUrl: string }).resetUrl.split('/reset-password/')[1],
      );

      expect((await changePassword(fan, PASSWORD, NEW_PASSWORD)).status).toBe(200);

      const res = await request(server)
        .post('/api/auth/password-reset/confirm')
        .send({ token, password: 'Harmadik3Jelszo' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('reset_token_used');
      expect((await login(fan.email, NEW_PASSWORD)).status).toBe(200);
    });

    it('requires a signed-in caller', async () => {
      const res = await request(server)
        .post('/api/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(res.status).toBe(401);
    });

    it('a mail that cannot be sent does not undo the change', async () => {
      const fan = await registerFan();
      ctx.failingTemplates.add('password-changed');
      const res = await changePassword(fan, PASSWORD, NEW_PASSWORD);
      expect(res.status).toBe(200);
      expect((await login(fan.email, NEW_PASSWORD)).status).toBe(200);
    });

    it('refuses a wrong current password with 400 (never 401) and changes nothing', async () => {
      const fan = await registerFan();
      const res = await changePassword(fan, 'NemEz1Jelszo', NEW_PASSWORD);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('current_password_incorrect');
      expect((await login(fan.email, PASSWORD)).status).toBe(200);
      expect((await login(fan.email, NEW_PASSWORD)).status).toBe(401);
      // the session was not touched either
      expect((await refresh(fan.refreshToken)).status).toBe(200);
      expect(await countMails('password-changed', fan.email)).toBe(0);
    });

    it('refuses a new password equal to the current one', async () => {
      const fan = await registerFan();
      const res = await changePassword(fan, PASSWORD, PASSWORD);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('password_unchanged');
      expect((await refresh(fan.refreshToken)).status).toBe(200);
    });

    it('refuses a missing current password with a field error', async () => {
      const fan = await registerFan();
      const res = await request(server)
        .post('/api/auth/change-password')
        .set(bearer(fan))
        .send({ newPassword: NEW_PASSWORD });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------
  describe('the password rule is one rule', () => {
    const CASES: Array<[label: string, password: string, accepted: boolean]> = [
      ['digits only', '12345678', false],
      ['letters only', 'abcdefgh', false],
      ['seven characters', 'abc1234', false],
      ['empty', '', false],
      ['no ASCII letter (accented only)', 'ÁÉÍÓÖŐÚÜŰ1', false],
      ['73 characters', `${'a1'.repeat(36)}a`, false],
      ['eight, letter and digit', 'abcdefg1', true],
      ['72 characters', 'a1'.repeat(36), true],
      ['spaces and symbols', 'jelszo 1 !?', true],
      ['accented letters with ASCII letter and digit', 'jelszó12345', true],
      ['leading spaces', '      1a', true],
      // The limit is 72 BYTES: bcrypt ignores the rest, so a longer password is refused, not truncated.
      ['accented, 37 characters = exactly 72 bytes', `a1${'é'.repeat(35)}`, true],
      ['accented, 38 characters = 74 bytes', `a1${'é'.repeat(36)}`, false],
      ['72 characters but 73 bytes', `é${'a1'.repeat(35)}1`, false],
      ['71 characters = exactly 72 bytes', `é${'a1'.repeat(35)}`, true],
      ['emoji, 70 bytes', `a1${'😀'.repeat(17)}`, true],
      ['emoji, 74 bytes', `a1${'😀'.repeat(18)}`, false],
      ['a NUL character (bcrypt would stop there)', 'abcdefg1 tail', false],
    ];

    // Validation answers 400 with message: string[]; every other outcome means
    // the password passed the rule.
    const isRuleRejection = (res: request.Response): boolean =>
      res.status === 400 && Array.isArray(res.body.message);

    it.each(CASES)(
      'registration, reset and change agree on %s',
      async (_label, password, accepted) => {
        await ctx.redis.flushdb();
        const fan = await registerFan();
        await ctx.redis.flushdb();

        const reg = await request(server)
          .post('/api/auth/register')
          .send({ email: uniqueEmail('rule'), password, firstName: 'Béla', lastName: 'Kovács' });
        const regRejected = isRuleRejection(reg);

        // a bogus token: an accepted password then fails on the token (code), not on the rule
        const reset = await request(server)
          .post('/api/auth/password-reset/confirm')
          .send({ token: 'x'.repeat(48), password });
        const resetRejected = isRuleRejection(reset);

        // wrong current password: an accepted new password then fails on the current one
        const change = await changePassword(fan, 'NemEz1Jelszo', password);
        const changeRejected = isRuleRejection(change);

        expect({ regRejected, resetRejected, changeRejected }).toEqual({
          regRejected: !accepted,
          resetRejected: !accepted,
          changeRejected: !accepted,
        });
        if (accepted) {
          expect(reg.status).toBe(201);
          expect(reset.body.code).toBe('reset_token_invalid');
          expect(change.body.code).toBe('current_password_incorrect');
        }
      },
    );

    it('an over-long accented password is refused everywhere with a message that says bytes, and no account takes its prefix', async () => {
      const exact = `a1${'é'.repeat(35)}`; // 72 bytes
      const over = `${exact}x`; // 73 bytes: bcrypt would hash the same 72 as `exact`

      const reg = await request(server)
        .post('/api/auth/register')
        .send({ email: uniqueEmail('bytes'), password: over, firstName: 'Béla', lastName: 'Kovács' });
      expect(reg.status).toBe(400);
      expect((reg.body.message as string[]).join(' ')).toContain('72 bájt');

      // an account whose password is exactly 72 bytes works, and is NOT unlocked by the same text plus a tail
      const email = uniqueEmail('bytes-ok');
      const ok = await request(server)
        .post('/api/auth/register')
        .send({ email, password: exact, firstName: 'Béla', lastName: 'Kovács' });
      expect(ok.status).toBe(201);
      expect((await login(email, exact)).status).toBe(200);
      const tail = await login(email, over);
      expect(tail.status).toBe(400);
      expect((tail.body.message as string[]).join(' ')).toContain('Elfelejtett jelszó');

      // the signed-in change refuses an over-long NEW password, and an over-long CURRENT one, changing nothing
      const fan = await registerFan();
      const tooLongNew = await changePassword(fan, PASSWORD, over);
      expect(tooLongNew.status).toBe(400);
      expect((tooLongNew.body.message as string[]).join(' ')).toContain('72 bájt');
      const tooLongCurrent = await changePassword(fan, over, NEW_PASSWORD);
      expect(tooLongCurrent.status).toBe(400);
      expect((await login(fan.email, PASSWORD)).status).toBe(200);

      // and a 72-byte accented password set through the change page works end to end
      const changed = await changePassword(fan, PASSWORD, exact);
      expect(changed.status).toBe(200);
      expect((await login(fan.email, exact)).status).toBe(200);
      expect((await login(fan.email, over)).status).toBe(400);
    });

    it('a weak new password changes nothing', async () => {
      const fan = await registerFan();
      const res = await changePassword(fan, PASSWORD, '12345678');
      expect(res.status).toBe(400);
      expect((await login(fan.email, PASSWORD)).status).toBe(200);
      expect((await refresh(fan.refreshToken)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------
  describe('profile', () => {
    it('returns the profile with dateOfBirth as YYYY-MM-DD and no pendingEmail', async () => {
      const fan = await registerFan();
      const res = await getMe(fan);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe(fan.email);
      expect(res.body.pendingEmail).toBeUndefined();
      expect(res.body.dateOfBirth).toBeUndefined();
    });

    it('clears the date of birth with null, in the database too, and leaves it alone when it is not sent', async () => {
      const fan = await registerFan();
      await patchMe(fan, { dateOfBirth: '1990-01-15' });
      const untouched = await patchMe(fan, { firstName: 'Bence' });
      expect(untouched.body.dateOfBirth).toBe('1990-01-15');

      const cleared = await patchMe(fan, { dateOfBirth: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.dateOfBirth).toBeUndefined();
      expect((await getMe(fan)).body.dateOfBirth).toBeUndefined();
      const [row] = await ctx.dataSource.query('SELECT date_of_birth AS d FROM users WHERE id = ?', [fan.id]);
      expect(row.d).toBeNull();

      // an empty string is not "clear": that is null; and a date can be entered again
      expect((await patchMe(fan, { dateOfBirth: '' })).status).toBe(400);
      expect((await patchMe(fan, { dateOfBirth: '1991-02-02' })).body.dateOfBirth).toBe('1991-02-02');
    });

    it('round-trips dateOfBirth exactly, with no timezone shift', async () => {
      const fan = await registerFan();
      for (const day of ['1990-01-15', '2000-02-29', '1985-12-31', '1999-01-01']) {
        const res = await patchMe(fan, { dateOfBirth: day });
        expect(res.status).toBe(200);
        expect(res.body.dateOfBirth).toBe(day);
        expect((await getMe(fan)).body.dateOfBirth).toBe(day);
      }
      // the stored calendar day itself (DATE_FORMAT: the driver would hand back a Date)
      const row = await ctx.dataSource.query(
        "SELECT DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS d FROM users WHERE id = ?",
        [fan.id],
      );
      expect(row[0].d).toBe('1999-01-01');
    });

    it('updates names and phone number, trimming them', async () => {
      const fan = await registerFan();
      const res = await patchMe(fan, {
        firstName: '  Géza ',
        lastName: 'Nagy',
        phoneNumber: ' +36 30 123 4567 ',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        firstName: 'Géza',
        lastName: 'Nagy',
        phoneNumber: '+36 30 123 4567',
      });
    });

    it('clears the phone number to NULL in the database when sent as an empty string', async () => {
      const fan = await registerFan();
      expect((await patchMe(fan, { phoneNumber: '+36301234567' })).status).toBe(200);
      const before = await ctx.dataSource.getRepository(User).findOneByOrFail({ id: fan.id });
      expect(before.phoneNumber).toBe('+36301234567');

      const res = await patchMe(fan, { phoneNumber: '' });
      expect(res.status).toBe(200);
      expect(res.body.phoneNumber).toBeUndefined();

      const raw = await ctx.dataSource.query('SELECT phone_number AS p FROM users WHERE id = ?', [
        fan.id,
      ]);
      expect(raw[0].p).toBeNull();
      expect((await getMe(fan)).body.phoneNumber).toBeUndefined();
    });

    it('leaves the phone number alone when the field is absent', async () => {
      const fan = await registerFan();
      await patchMe(fan, { phoneNumber: '+36301234567' });
      const res = await patchMe(fan, { firstName: 'Zoltán' });
      expect(res.status).toBe(200);
      expect(res.body.phoneNumber).toBe('+36301234567');
    });

    it('refuses a malformed phone number and a short name', async () => {
      const fan = await registerFan();
      expect((await patchMe(fan, { phoneNumber: 'abc' })).status).toBe(400);
      expect((await patchMe(fan, { firstName: 'B' })).status).toBe(400);
      expect((await patchMe(fan, { dateOfBirth: 'nem-datum' })).status).toBe(400);
    });

    it('refuses to change the e-mail address here and changes nothing', async () => {
      const fan = await registerFan();
      const res = await patchMe(fan, { email: uniqueEmail('sneaky'), firstName: 'Zoltán' });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('property email should not exist');
      const row = await ctx.dataSource.getRepository(User).findOneByOrFail({ id: fan.id });
      expect(row.email).toBe(fan.email);
      expect(row.firstName).toBe('Béla');
    });

    it('does not let the role or loyalty fields be set through the profile', async () => {
      const fan = await registerFan();
      expect((await patchMe(fan, { role: 'admin' })).status).toBe(400);
      expect((await patchMe(fan, { loyaltyPoints: 99999 })).status).toBe(400);
    });

    it('awards the profile-completion bonus once, when phone and birth date are both present', async () => {
      const fan = await registerFan();
      const bonuses = () =>
        ctx.dataSource.getRepository(LoyaltyTransaction).find({
          where: { userId: fan.id, source: LoyaltyTransactionSource.PROFILE_COMPLETION },
        });

      const pointsBefore = (await getMe(fan)).body.loyaltyPoints as number;
      expect((await patchMe(fan, { phoneNumber: '+36301234567' })).status).toBe(200);
      expect(await bonuses()).toHaveLength(0); // incomplete: no bonus yet

      const done = await patchMe(fan, { dateOfBirth: '1990-01-15' });
      expect(done.status).toBe(200);
      expect(await bonuses()).toHaveLength(1);
      expect(done.body.loyaltyPoints).toBeGreaterThan(pointsBefore);
      const pointsAfter = done.body.loyaltyPoints as number;

      // clearing and re-adding the phone does not pay twice
      await patchMe(fan, { phoneNumber: '' });
      await patchMe(fan, { phoneNumber: '+36309999999' });
      await patchMe(fan, { dateOfBirth: '1991-02-02' });
      expect(await bonuses()).toHaveLength(1);
      expect((await getMe(fan)).body.loyaltyPoints).toBe(pointsAfter);
    });

    it('requires a signed-in caller', async () => {
      expect(
        (await request(server).patch('/api/users/me').send({ firstName: 'Zoli' })).status,
      ).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  describe('changing the e-mail address', () => {
    it('answers 202, changes nothing yet, and mails the link to the NEW address and a notice to the old', async () => {
      const fan = await registerFan();
      const newEmail = uniqueEmail('uj');

      const res = await requestEmailChange(fan, newEmail.toUpperCase());
      expect(res.status).toBe(202);
      expect(res.body.pendingEmail).toBe(newEmail);

      const confirm = await mailTo('email-change-confirm', newEmail);
      expect((confirm.context as { confirmUrl: string }).confirmUrl).toContain('/confirm-email/');
      const notice = await mailTo('email-change-requested', fan.email);
      // no link to confirm in the notice, and the new address is only masked
      expect(JSON.stringify(notice)).not.toContain('/confirm-email/');
      expect(JSON.stringify(notice)).not.toContain(newEmail);
      // the old address got no link, the new address got no notice
      expect(
        ctx.sentEmails.filter((m) => m.template === 'email-change-confirm' && m.to === fan.email),
      ).toHaveLength(0);
      expect(await countMails('email-change-requested', newEmail)).toBe(0);

      const row = await ctx.dataSource.getRepository(User).findOneByOrFail({ id: fan.id });
      expect(row.email).toBe(fan.email);
      expect((await login(fan.email, PASSWORD)).status).toBe(200);
      expect((await login(newEmail, PASSWORD)).status).toBe(401);

      const me = await getMe(fan);
      expect(me.body.email).toBe(fan.email);
      expect(me.body.pendingEmail).toBe(newEmail);
    });

    it('stores only a hash of the token', async () => {
      const fan = await registerFan();
      const newEmail = uniqueEmail('uj');
      const token = await startEmailChange(fan, newEmail);
      const rows = await ctx.dataSource.getRepository(EmailChangeToken).find();
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0])).not.toContain(token);
    });

    it('refuses a wrong password with 400 current_password_incorrect and sends nothing', async () => {
      const fan = await registerFan();
      const newEmail = uniqueEmail('uj');
      const res = await requestEmailChange(fan, newEmail, 'NemEz1Jelszo');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('current_password_incorrect');
      expect(await ctx.dataSource.getRepository(EmailChangeToken).count()).toBe(0);
      expect(await countMails('email-change-confirm', newEmail)).toBe(0);
      expect(await countMails('email-change-requested', fan.email)).toBe(0);
    });

    it('refuses an address that already belongs to an account with 409 email_taken', async () => {
      const fan = await registerFan();
      const other = await registerFan('other');
      const res = await requestEmailChange(fan, other.email.toUpperCase());
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('email_taken');
      expect(await ctx.dataSource.getRepository(EmailChangeToken).count()).toBe(0);
    });

    it('refuses the address the account already has, however it is written', async () => {
      const fan = await registerFan();
      const res = await requestEmailChange(fan, `  ${fan.email.toUpperCase()} `);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('email_unchanged');
    });

    it('refuses a malformed address', async () => {
      const fan = await registerFan();
      expect((await requestEmailChange(fan, 'nem-email')).status).toBe(400);
    });

    it('requires a signed-in caller', async () => {
      const res = await request(server)
        .post('/api/users/me/email-change')
        .send({ newEmail: uniqueEmail('x'), currentPassword: PASSWORD });
      expect(res.status).toBe(401);
    });

    it('asking again retires the earlier link: only the newest works', async () => {
      const fan = await registerFan();
      const a = uniqueEmail('a');
      const b = uniqueEmail('b');
      const first = await startEmailChange(fan, a);
      const second = await startEmailChange(fan, b);

      const old = await confirmEmail(first);
      expect(old.status).toBe(400);
      expect(old.body.code).toBe('email_change_token_used');
      const ok = await confirmEmail(second);
      expect(ok.status).toBe(200);
      expect(ok.body.email).toBe(b);
    });

    describe('confirming', () => {
      it('moves the account to the new address: new logs in, old does not; the old address is told', async () => {
        const fan = await registerFan();
        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(fan, newEmail);

        const res = await confirmEmail(token); // public: no Authorization header
        expect(res.status).toBe(200);
        expect(res.body.email).toBe(newEmail);
        expect(res.body.message).toEqual(expect.any(String));

        expect((await login(newEmail, PASSWORD)).status).toBe(200);
        expect((await login(fan.email, PASSWORD)).status).toBe(401);
        const row = await ctx.dataSource.getRepository(User).findOneByOrFail({ id: fan.id });
        expect(row.email).toBe(newEmail);
        expect(row.emailVerified).toBe(true);

        const changed = await mailTo('email-changed', fan.email);
        expect(changed.subject).toContain('megváltozott');
        expect(JSON.stringify(changed)).not.toContain(newEmail); // masked only
        expect(JSON.stringify(changed)).not.toContain(token);
        expect(await countMails('email-changed', newEmail)).toBe(0);
        // and the request notice went to the old address earlier
        expect(await countMails('email-change-requested', fan.email)).toBe(1);
      });

      it('does not sign anyone out: the refresh tokens still work', async () => {
        const fan = await registerFan();
        const second = await login(fan.email, PASSWORD);
        const token = await startEmailChange(fan, uniqueEmail('uj'));
        expect((await confirmEmail(token)).status).toBe(200);
        expect((await refresh(fan.refreshToken)).status).toBe(200);
        expect((await refresh(second.body.refreshToken)).status).toBe(200);
      });

      it('clears pendingEmail from the profile', async () => {
        const fan = await registerFan();
        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(fan, newEmail);
        await confirmEmail(token);
        const me = await getMe(fan);
        expect(me.body.email).toBe(newEmail);
        expect(me.body.pendingEmail).toBeUndefined();
      });

      it('is single use: the second try says the link was used and changes nothing more', async () => {
        const fan = await registerFan();
        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(fan, newEmail);
        expect((await confirmEmail(token)).status).toBe(200);

        const again = await confirmEmail(token);
        expect(again.status).toBe(400);
        expect(again.body.code).toBe('email_change_token_used');
        expect(await countMails('email-changed', fan.email)).toBe(1);
      });

      it('refuses an unknown token', async () => {
        const res = await confirmEmail('x'.repeat(48));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('email_change_token_invalid');
      });

      it('refuses an expired token and changes nothing', async () => {
        const fan = await registerFan();
        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(fan, newEmail);
        await ctx.dataSource
          .getRepository(EmailChangeToken)
          .update({ userId: fan.id }, { expiresAt: new Date(Date.now() - 60_000) });

        const res = await confirmEmail(token);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('email_change_token_expired');
        expect((await login(fan.email, PASSWORD)).status).toBe(200);
        expect((await login(newEmail, PASSWORD)).status).toBe(401);
        expect((await getMe(fan)).body.pendingEmail).toBeUndefined();
      });

      it('is voided by a password change in between, on both the confirm and the profile', async () => {
        const fan = await registerFan();
        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(fan, newEmail);
        const changed = await changePassword(fan, PASSWORD, NEW_PASSWORD);
        expect(changed.status).toBe(200);

        const me = await request(server)
          .get('/api/users/me')
          .set({ Authorization: `Bearer ${changed.body.accessToken}` });
        expect(me.body.pendingEmail).toBeUndefined();

        const res = await confirmEmail(token);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('email_change_token_password_changed');
        expect((await login(fan.email, NEW_PASSWORD)).status).toBe(200);
        expect((await login(newEmail, NEW_PASSWORD)).status).toBe(401);
      });

      it('answers email_taken when the address got an account after the request', async () => {
        const fan = await registerFan();
        const wanted = uniqueEmail('wanted');
        const token = await startEmailChange(fan, wanted);
        await registerFan('late', wanted); // someone registers it meanwhile

        const res = await confirmEmail(token);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('email_taken');
        expect((await login(fan.email, PASSWORD)).status).toBe(200);
      });

      it('two accounts racing for one new address: exactly one wins, the other gets email_taken', async () => {
        const a = await registerFan('racea');
        const b = await registerFan('raceb');
        const wanted = uniqueEmail('prize');
        // both requests pass the "is it free" check: nobody owns it yet
        expect((await requestEmailChange(a, wanted)).status).toBe(202);
        expect((await requestEmailChange(b, wanted)).status).toBe(202);
        const tokenA = await emailChangeToken(a, wanted, 1);
        const tokenB = await emailChangeToken(b, wanted, 2);

        const results = await Promise.all([confirmEmail(tokenA), confirmEmail(tokenB)]);
        const statuses = results.map((r) => r.status).sort();
        expect(statuses).toEqual([200, 409]);
        expect(results.find((r) => r.status === 409)!.body.code).toBe('email_taken');

        const owners = await ctx.dataSource.getRepository(User).find({ where: { email: wanted } });
        expect(owners).toHaveLength(1);
        // the loser still has their old address and can still sign in with it
        const loser = owners[0].id === a.id ? b : a;
        expect((await login(loser.email, PASSWORD)).status).toBe(200);
      });

      it('the same link opened twice at once changes the address once and mails the old address once', async () => {
        const fan = await registerFan();
        const token = await startEmailChange(fan, uniqueEmail('uj'));
        const results = await Promise.all([confirmEmail(token), confirmEmail(token)]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
        expect(await countMails('email-changed', fan.email)).toBe(1);
      });

      it('retires outstanding password-reset links of the old address', async () => {
        const fan = await registerFan();
        await request(server).post('/api/auth/password-reset/request').send({ email: fan.email });
        const resetMail = await mailTo('password-reset', fan.email);
        const resetToken = decodeURIComponent(
          (resetMail.context as { resetUrl: string }).resetUrl.split('/reset-password/')[1],
        );
        const token = await startEmailChange(fan, uniqueEmail('uj'));
        expect((await confirmEmail(token)).status).toBe(200);

        const res = await request(server)
          .post('/api/auth/password-reset/confirm')
          .send({ token: resetToken, password: NEW_PASSWORD });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('reset_token_used');
      });

      it('a mail that cannot be sent does not undo the change', async () => {
        const fan = await registerFan();
        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(fan, newEmail);
        ctx.failingTemplates.add('email-changed');
        const res = await confirmEmail(token);
        expect(res.status).toBe(200);
        expect((await login(newEmail, PASSWORD)).status).toBe(200);
      });
    });

    describe('what the change touches', () => {
      async function seedLoan(
        fan: Fan,
        borrowerEmail: string,
        status: PassLoanStatus,
        matchId: string,
        seasonPassId: string,
        borrowerUserId?: string,
      ): Promise<PassLoan> {
        const repo = ctx.dataSource.getRepository(PassLoan);
        return repo.save(
          repo.create({
            seasonPassId,
            lenderUserId: fan.id,
            borrowerUserId,
            matchId,
            borrowerEmail,
            status,
            invitationToken: randomUUID().replace(/-/g, ''),
            expiresAt: new Date(Date.now() + 86_400_000),
          }),
        );
      }

      it('moves live pass-loan invitations to the new address, but not finished ones', async () => {
        const lender = await registerFan('lender');
        const invitee = await registerFan('invitee');
        const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
        const pass = await seedSeasonPass(ctx.dataSource, {
          userId: lender.id,
          seatId: seatA.id,
        });
        const matches = [match, ...(await extraMatches(3))];
        const pending = await seedLoan(
          lender,
          invitee.email,
          PassLoanStatus.PENDING,
          matches[0].id,
          pass.id,
        );
        const accepted = await seedLoan(
          lender,
          invitee.email,
          PassLoanStatus.ACCEPTED,
          matches[1].id,
          pass.id,
          invitee.id,
        );
        const completed = await seedLoan(
          lender,
          invitee.email,
          PassLoanStatus.COMPLETED,
          matches[2].id,
          pass.id,
          invitee.id,
        );
        const used = await seedLoan(
          lender,
          invitee.email,
          PassLoanStatus.USED,
          matches[3].id,
          pass.id,
          invitee.id,
        );
        // someone else's invitation is not touched
        const bystander = await seedLoan(
          lender,
          'masvalaki@kte.hu',
          PassLoanStatus.PENDING,
          matches[1].id,
          pass.id,
        );

        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(invitee, newEmail);
        expect((await confirmEmail(token)).status).toBe(200);

        const repo = ctx.dataSource.getRepository(PassLoan);
        const emailOf = async (loan: PassLoan) =>
          (await repo.findOneByOrFail({ id: loan.id })).borrowerEmail;
        expect(await emailOf(pending)).toBe(newEmail);
        expect(await emailOf(accepted)).toBe(newEmail);
        expect(await emailOf(completed)).toBe(invitee.email);
        expect(await emailOf(used)).toBe(invitee.email);
        expect(await emailOf(bystander)).toBe('masvalaki@kte.hu');
        // statuses are untouched
        expect((await repo.findOneByOrFail({ id: pending.id })).status).toBe(
          PassLoanStatus.PENDING,
        );
      });

      it('leaves tickets, loyalty points and the season pass of the user untouched', async () => {
        const fan = await registerFan();
        const { match, seatA, seatB } = await seedMinimalFixture(ctx.dataSource);
        const pass = await seedSeasonPass(ctx.dataSource, { userId: fan.id, seatId: seatA.id });
        const ticketRepo = ctx.dataSource.getRepository(Ticket);
        const ticket = await ticketRepo.save(
          ticketRepo.create({
            matchId: match.id,
            seatId: seatB.id,
            userId: fan.id,
            status: TicketStatus.PAID,
            source: TicketSource.SINGLE,
            pricePaid: '5000.00',
            currency: 'HUF',
            qrCode: `KTE-${randomUUID()}`,
            qrJti: randomUUID(),
          }),
        );
        const pointsBefore = (await getMe(fan)).body.loyaltyPoints as number;
        const ledgerBefore = await ctx.dataSource
          .getRepository(LoyaltyTransaction)
          .count({ where: { userId: fan.id } });

        const newEmail = uniqueEmail('uj');
        const token = await startEmailChange(fan, newEmail);
        expect((await confirmEmail(token)).status).toBe(200);

        const ticketAfter = await ticketRepo.findOneByOrFail({ id: ticket.id });
        expect(ticketAfter.userId).toBe(fan.id);
        expect(ticketAfter.status).toBe(TicketStatus.PAID);
        const passAfter = await ctx.dataSource
          .getRepository(SeasonPass)
          .findOneByOrFail({ id: pass.id });
        expect(passAfter.userId).toBe(fan.id);
        expect(passAfter.holderUserId).toBe(fan.id);

        const signedIn = await login(newEmail, PASSWORD);
        expect(signedIn.body.user.id).toBe(fan.id);
        expect(signedIn.body.user.loyaltyPoints).toBe(pointsBefore);
        expect(
          await ctx.dataSource
            .getRepository(LoyaltyTransaction)
            .count({ where: { userId: fan.id } }),
        ).toBe(ledgerBefore);

        const mine = await request(server)
          .get('/api/users/me/tickets')
          .set({ Authorization: `Bearer ${signedIn.body.accessToken}` });
        expect(mine.status).toBe(200);
        expect(mine.body.items.map((t: { id: string }) => t.id)).toContain(ticket.id);
      });

      /** More on-sale matches (the minimal fixture has one). */
      async function extraMatches(n: number) {
        const repo = ctx.dataSource.getRepository(Match);
        const out = [];
        for (let i = 0; i < n; i += 1) {
          out.push(
            await repo.save(
              repo.create({
                homeTeam: 'Kecskeméti TE',
                awayTeam: `E2E Rivals ${i}`,
                competition: Competition.NB1,
                venue: 'Széktói Stadion',
                kickoffAt: new Date(Date.now() + (8 + i) * 86_400_000),
                status: MatchStatus.ON_SALE,
                capacity: 2,
                basePrice: '5000.00',
                isSeasonPassEligible: true,
              }),
            ),
          );
        }
        return out;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Last: these exhaust per-account budgets (Redis is flushed before every test anyway).
  describe('throttling', () => {
    it('answers 429 on the 11th password attempt of an account in the hour, wrong or right', async () => {
      const fan = await registerFan();
      for (let i = 0; i < 10; i += 1) {
        const res = await changePassword(fan, 'NemEz1Jelszo', NEW_PASSWORD);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('current_password_incorrect');
      }
      // even the correct password is refused now - and nothing changed
      const res = await changePassword(fan, PASSWORD, NEW_PASSWORD);
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('rate_limited');
      expect((await login(fan.email, PASSWORD)).status).toBe(200);
    });

    it('is per account: another account is unaffected', async () => {
      const fan = await registerFan();
      const other = await registerFan('other');
      for (let i = 0; i < 10; i += 1) {
        await changePassword(fan, 'NemEz1Jelszo', NEW_PASSWORD);
      }
      expect((await changePassword(fan, PASSWORD, NEW_PASSWORD)).status).toBe(429);
      expect((await changePassword(other, PASSWORD, NEW_PASSWORD)).status).toBe(200);
    });

    it('limits e-mail change password guesses too: the 6th attempt is 429', async () => {
      const fan = await registerFan();
      for (let i = 0; i < 5; i += 1) {
        const res = await requestEmailChange(fan, uniqueEmail('uj'), 'NemEz1Jelszo');
        expect(res.status).toBe(400);
      }
      const res = await requestEmailChange(fan, uniqueEmail('uj'));
      expect(res.status).toBe(429);
    });
  });
});
