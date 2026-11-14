import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { hash } from 'bcrypt';
import { createHash } from 'crypto';
import { FindOperator, QueryFailedError } from 'typeorm';
import {
  EmailChangeToken,
  PassLoan,
  PassLoanStatus,
  PasswordResetToken,
  User,
} from '../../database/entities';
import { CurrentPasswordVerifier } from './current-password.verifier';
import { EmailChangeService } from './email-change.service';

/*
 * EmailChangeService against small in-memory tables. The fake repositories
 * understand the find operators the service uses (IsNull, MoreThan, In), so
 * "unused and unexpired", "single use" and "only live loans" are really
 * evaluated, not just asserted as calls.
 */

type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected instanceof FindOperator) {
      const op = expected as FindOperator<unknown>;
      switch (op.type) {
        case 'isNull':
          return actual === null || actual === undefined;
        case 'moreThan':
          return (
            actual instanceof Date &&
            op.value instanceof Date &&
            actual.getTime() > op.value.getTime()
          );
        case 'in':
          return (op.value as unknown[]).includes(actual);
        default:
          throw new Error(`fake repo: unsupported operator ${op.type}`);
      }
    }
    return actual === expected;
  });
}

class FakeRepo<T extends Row> {
  rows: T[] = [];
  /** Optional hook to simulate a DB error on update (e.g. a unique index). */
  onUpdate?: (where: Row, patch: Partial<T>) => void;

  create(data: Partial<T>): T {
    return { ...data } as T;
  }

  async save(row: T): Promise<T> {
    if (!row.id) {
      (row as Row).id = `id-${this.rows.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
      (row as Row).createdAt = new Date(Date.now() + this.rows.length);
      this.rows.push(row);
    }
    return row;
  }

  async findOne(opts: { where: Row; order?: Row }): Promise<T | null> {
    let found = this.rows.filter((r) => matches(r, opts.where));
    if (opts.order?.createdAt === 'DESC') {
      found = [...found].sort(
        (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
      );
    }
    return found[0] ? ({ ...found[0] } as T) : null;
  }

  async update(where: Row, patch: Partial<T>): Promise<{ affected: number }> {
    this.onUpdate?.(where, patch);
    const hit = this.rows.filter((r) => matches(r, where));
    hit.forEach((r) => Object.assign(r, patch));
    return { affected: hit.length };
  }
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const PASSWORD = 'Jelszo123';

interface Harness {
  service: EmailChangeService;
  users: FakeRepo<User & Row>;
  tokens: FakeRepo<EmailChangeToken & Row>;
  resets: FakeRepo<PasswordResetToken & Row>;
  loans: FakeRepo<PassLoan & Row>;
  sent: Array<{ to: string; template: string; context: Record<string, unknown> }>;
  verifier: { verify: jest.Mock };
  user: User & Row;
  /** The raw token mailed in the last confirmation link. */
  lastToken: () => string;
}

async function setup(): Promise<Harness> {
  const users = new FakeRepo<User & Row>();
  const tokens = new FakeRepo<EmailChangeToken & Row>();
  const resets = new FakeRepo<PasswordResetToken & Row>();
  const loans = new FakeRepo<PassLoan & Row>();
  const user = {
    id: 'u1',
    email: 'regi@pelda.hu',
    firstName: 'Béla',
    passwordHash: await hash(PASSWORD, 4),
    isActive: true,
    emailVerified: false,
  } as unknown as User & Row;
  users.rows.push(user);
  users.rows.push({ id: 'u2', email: 'foglalt@pelda.hu', isActive: true } as unknown as User & Row);

  const repoFor = (entity: unknown): unknown => {
    if (entity === User) return users;
    if (entity === EmailChangeToken) return tokens;
    if (entity === PasswordResetToken) return resets;
    if (entity === PassLoan) return loans;
    throw new Error('unexpected entity');
  };
  const dataSource = {
    // No real rollback: tests that throw inside check what was (not) written.
    transaction: async <R>(cb: (m: unknown) => Promise<R>): Promise<R> =>
      cb({ getRepository: repoFor }),
  };
  const config = {
    getOrThrow: (key: string) =>
      ({
        jwt: { emailChangeTtlMinutes: 60 },
        mail: { baseUrl: 'https://jegy.kte.hu', supportEmail: 'jegy@kte.hu' },
        cron: { timezone: 'Europe/Budapest' },
      })[key],
  };
  const sent: Harness['sent'] = [];
  const emailService = {
    send: jest.fn(async (req: Harness['sent'][number]) => {
      sent.push(req);
    }),
  };
  // The real verifier, without Redis (its limiter is covered in its own spec).
  const verifier = {
    verify: jest.fn(async (id: string, password: string) => {
      const real = new CurrentPasswordVerifier(
        users as never,
        {
          hit: async () => true,
        } as never,
      );
      return real.verify(id, password, { scope: 't', limit: 1, windowSeconds: 1 });
    }),
  };
  const service = new EmailChangeService(
    users as never,
    tokens as never,
    dataSource as never,
    config as never,
    emailService as never,
    verifier as unknown as CurrentPasswordVerifier,
  );
  const lastToken = (): string => {
    const mail = [...sent].reverse().find((m) => m.template === 'email-change-confirm');
    const url = String(mail?.context.confirmUrl ?? '');
    return decodeURIComponent(url.split('/confirm-email/')[1] ?? '');
  };
  return { service, users, tokens, resets, loans, sent, verifier, user, lastToken };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

async function expectCode(p: Promise<unknown>, status: number, code: string): Promise<void> {
  await expect(p).rejects.toBeInstanceOf(HttpException);
  try {
    await p;
  } catch (e) {
    const err = e as HttpException;
    expect(err.getStatus()).toBe(status);
    expect((err.getResponse() as { code?: string }).code).toBe(code);
  }
}

describe('EmailChangeService.requestChange', () => {
  it('needs the current password (wrong one: 400 current_password_incorrect, no token, no mail)', async () => {
    const h = await setup();
    await expectCode(
      h.service.requestChange('u1', 'uj@pelda.hu', 'rossz-jelszo1'),
      400,
      'current_password_incorrect',
    );
    expect(h.tokens.rows).toHaveLength(0);
    await flush();
    expect(h.sent).toHaveLength(0);
  });

  it('uses its own per-account budget (emailchange:user, 5 per hour)', async () => {
    const h = await setup();
    await h.service.requestChange('u1', 'uj@pelda.hu', PASSWORD);
    expect(h.verifier.verify).toHaveBeenCalledWith('u1', PASSWORD, {
      scope: 'emailchange:user',
      limit: 5,
      windowSeconds: 3600,
    });
  });

  it('refuses the current address (email_unchanged), case and spaces ignored', async () => {
    const h = await setup();
    await expectCode(
      h.service.requestChange('u1', '  REGI@pelda.hu ', PASSWORD),
      400,
      'email_unchanged',
    );
  });

  it('refuses an address that belongs to another account (409 email_taken)', async () => {
    const h = await setup();
    await expectCode(
      h.service.requestChange('u1', 'Foglalt@pelda.hu', PASSWORD),
      409,
      'email_taken',
    );
    expect(h.tokens.rows).toHaveLength(0);
  });

  it('changes nothing on the account; stores only the hash; mails the link to the new address and a masked notice to the current one', async () => {
    const h = await setup();
    const res = await h.service.requestChange('u1', ' Uj.Cim@Pelda.hu ', PASSWORD, {
      ip: '84.2.51.77',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
    });
    expect(res.pendingEmail).toBe('uj.cim@pelda.hu');
    expect(res.message).toContain('1 óra');

    expect(h.user.email).toBe('regi@pelda.hu');
    expect(h.user.emailVerified).toBe(false);

    await flush();
    const token = h.lastToken();
    expect(token).toHaveLength(48);
    expect(h.tokens.rows).toHaveLength(1);
    expect(h.tokens.rows[0].tokenHash).toBe(sha256(token));
    expect(JSON.stringify(h.tokens.rows[0])).not.toContain(token);
    expect(h.tokens.rows[0].newEmail).toBe('uj.cim@pelda.hu');
    expect(h.tokens.rows[0].passwordFingerprint).toBe(sha256(h.user.passwordHash));

    const confirm = h.sent.find((m) => m.template === 'email-change-confirm')!;
    expect(confirm.to).toBe('uj.cim@pelda.hu');
    expect(confirm.context.confirmUrl).toBe(`https://jegy.kte.hu/confirm-email/${token}`);

    const notice = h.sent.find((m) => m.template === 'email-change-requested')!;
    expect(notice.to).toBe('regi@pelda.hu');
    expect(notice.context.maskedNewEmail).toBe('u***@p***.hu');
    expect(notice.context.clientLabel).toBe('Chrome, Windows · 84.2.51.x');
    expect(JSON.stringify(notice.context)).not.toContain(token);
  });

  it('a new request retires the earlier link', async () => {
    const h = await setup();
    await h.service.requestChange('u1', 'elso@pelda.hu', PASSWORD);
    await flush();
    const first = h.lastToken();
    await h.service.requestChange('u1', 'masodik@pelda.hu', PASSWORD);
    await expectCode(h.service.confirmChange(first), 400, 'email_change_token_used');
  });

  it('a mail that cannot be sent does not fail the request', async () => {
    const h = await setup();
    const svc = h.service as unknown as { emailService: { send: jest.Mock } };
    svc.emailService.send.mockRejectedValue(new Error('smtp down'));
    await expect(h.service.requestChange('u1', 'uj@pelda.hu', PASSWORD)).resolves.toMatchObject({
      pendingEmail: 'uj@pelda.hu',
    });
    await flush();
  });
});

describe('EmailChangeService.confirmChange', () => {
  async function requested(h: Harness, newEmail = 'uj@pelda.hu'): Promise<string> {
    await h.service.requestChange('u1', newEmail, PASSWORD);
    await flush();
    const token = h.lastToken();
    h.sent.length = 0;
    return token;
  }

  it('switches the address, marks it verified, and tells the OLD address (no token in that mail)', async () => {
    const h = await setup();
    const token = await requested(h);
    const res = await h.service.confirmChange(token, { ip: '10.1.2.3' });
    expect(res).toEqual({ message: expect.stringContaining('megváltozott'), email: 'uj@pelda.hu' });
    expect(h.user.email).toBe('uj@pelda.hu');
    expect(h.user.emailVerified).toBe(true);

    await flush();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe('regi@pelda.hu');
    expect(h.sent[0].template).toBe('email-changed');
    expect(h.sent[0].context.maskedNewEmail).toBe('u***@p***.hu');
    expect(h.sent[0].context.clientLabel).toBe('10.1.2.x');
    expect(JSON.stringify(h.sent[0].context)).not.toContain(token);
  });

  it('is single use', async () => {
    const h = await setup();
    const token = await requested(h);
    await h.service.confirmChange(token);
    await expectCode(h.service.confirmChange(token), 400, 'email_change_token_used');
  });

  it('loses a race on the same link atomically (consume affects 0 rows -> used)', async () => {
    const h = await setup();
    const token = await requested(h);
    // Someone else consumed it between the check and the transaction.
    const original = h.tokens.update.bind(h.tokens);
    let first = true;
    h.tokens.update = async (where, patch) => {
      if (first && 'id' in where) {
        first = false;
        h.tokens.rows[0].usedAt = new Date();
      }
      return original(where, patch);
    };
    await expectCode(h.service.confirmChange(token), 400, 'email_change_token_used');
    expect(h.user.email).toBe('regi@pelda.hu');
  });

  it('refuses an unknown token', async () => {
    const h = await setup();
    await expectCode(h.service.confirmChange('x'.repeat(48)), 400, 'email_change_token_invalid');
  });

  it('refuses an expired link and changes nothing', async () => {
    const h = await setup();
    const token = await requested(h);
    h.tokens.rows[0].expiresAt = new Date(Date.now() - 1000);
    await expectCode(h.service.confirmChange(token), 400, 'email_change_token_expired');
    expect(h.user.email).toBe('regi@pelda.hu');
  });

  it('a password change since the request voids the link', async () => {
    const h = await setup();
    const token = await requested(h);
    h.user.passwordHash = await hash('MasikJelszo9', 4);
    await expectCode(h.service.confirmChange(token), 400, 'email_change_token_password_changed');
    expect(h.user.email).toBe('regi@pelda.hu');
  });

  it('409 email_taken when the address got registered meanwhile', async () => {
    const h = await setup();
    const token = await requested(h);
    h.users.rows.push({ id: 'u3', email: 'uj@pelda.hu', isActive: true } as unknown as User & Row);
    await expectCode(h.service.confirmChange(token), 409, 'email_taken');
  });

  it('409 email_taken when the unique index refuses the update', async () => {
    const h = await setup();
    const token = await requested(h);
    h.users.onUpdate = (_where, patch) => {
      if ('email' in patch) {
        const err = new QueryFailedError('UPDATE users', [], new Error('dup'));
        (err as unknown as { driverError: { code: string } }).driverError = {
          code: 'ER_DUP_ENTRY',
        };
        throw err;
      }
    };
    await expectCode(h.service.confirmChange(token), 409, 'email_taken');
  });

  it('moves live loan invitations to the new address, leaves history alone', async () => {
    const h = await setup();
    const loan = (id: string, status: PassLoanStatus, extra: Partial<PassLoan> = {}) =>
      ({ id, status, borrowerEmail: 'regi@pelda.hu', ...extra }) as unknown as PassLoan & Row;
    h.loans.rows.push(
      loan('pending-no-account', PassLoanStatus.PENDING),
      loan('pending-mine', PassLoanStatus.PENDING, { borrowerUserId: 'u1' }),
      loan('accepted', PassLoanStatus.ACCEPTED, { borrowerUserId: 'u1' }),
      loan('used', PassLoanStatus.USED, { borrowerUserId: 'u1' }),
      loan('completed', PassLoanStatus.COMPLETED, { borrowerUserId: 'u1' }),
      loan('cancelled', PassLoanStatus.CANCELLED, { borrowerUserId: 'u1' }),
      loan('expired', PassLoanStatus.EXPIRED),
      loan('other-address', PassLoanStatus.PENDING, { borrowerEmail: 'mas@pelda.hu' }),
    );
    const token = await requested(h);
    await h.service.confirmChange(token);
    const email = (id: string) => h.loans.rows.find((l) => l.id === id)!.borrowerEmail;
    expect(email('pending-no-account')).toBe('uj@pelda.hu');
    expect(email('pending-mine')).toBe('uj@pelda.hu');
    expect(email('accepted')).toBe('uj@pelda.hu');
    expect(email('used')).toBe('regi@pelda.hu');
    expect(email('completed')).toBe('regi@pelda.hu');
    expect(email('cancelled')).toBe('regi@pelda.hu');
    expect(email('expired')).toBe('regi@pelda.hu');
    expect(email('other-address')).toBe('mas@pelda.hu');
  });

  it('retires outstanding password-reset links (they went to the old mailbox)', async () => {
    const h = await setup();
    h.resets.rows.push(
      { id: 'r1', userId: 'u1', usedAt: null } as unknown as PasswordResetToken & Row,
      { id: 'r2', userId: 'u2', usedAt: null } as unknown as PasswordResetToken & Row,
    );
    const token = await requested(h);
    await h.service.confirmChange(token);
    expect(h.resets.rows[0].usedAt).toBeInstanceOf(Date);
    expect(h.resets.rows[1].usedAt).toBeNull();
  });
});

describe('EmailChangeService.pendingEmailFor', () => {
  it('reports the newest usable request only', async () => {
    const h = await setup();
    expect(await h.service.pendingEmailFor(h.user)).toBeUndefined();
    await h.service.requestChange('u1', 'uj@pelda.hu', PASSWORD);
    expect(await h.service.pendingEmailFor(h.user)).toBe('uj@pelda.hu');

    h.tokens.rows[0].expiresAt = new Date(Date.now() - 1);
    expect(await h.service.pendingEmailFor(h.user)).toBeUndefined();
  });

  it('a password change hides the pending request (it is void)', async () => {
    const h = await setup();
    await h.service.requestChange('u1', 'uj@pelda.hu', PASSWORD);
    expect(
      await h.service.pendingEmailFor({ id: 'u1', passwordHash: 'something-else' }),
    ).toBeUndefined();
  });
});
