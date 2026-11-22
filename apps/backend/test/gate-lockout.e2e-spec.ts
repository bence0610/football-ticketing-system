import './setup/test-env';

import { randomUUID } from 'crypto';
import request from 'supertest';
import { Server } from 'http';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { createGateUser, seedMinimalFixture, truncateAll } from './helpers/db.helper';

/**
 * The steward account (role gate) against the real application: refused (403) on the fan
 * endpoints, still able to scan, log out and change its password; a fan still cannot scan.
 */
describe('Gate role lockout (E2E)', () => {
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
  });

  async function gateToken(): Promise<string> {
    const gate = await createGateUser(ctx.dataSource, {
      email: `gate-${randomUUID().slice(0, 6)}@kte.hu`,
    });
    const login = await request(server)
      .post('/api/auth/login')
      .send({ email: gate.user.email, password: gate.plainPassword });
    expect(login.status).toBe(200);
    return login.body.accessToken as string;
  }

  async function fanToken(): Promise<string> {
    const res = await request(server)
      .post('/api/auth/register')
      .send({
        email: `fan-${randomUUID().slice(0, 8)}@kte.hu`,
        password: 'Teszt1234!',
        firstName: 'Teszt',
        lastName: 'Elek',
      });
    expect(res.status).toBe(201);
    return res.body.accessToken as string;
  }

  it('refuses a gate user on seat lock, best seats, payment intent and season-pass purchase (403)', async () => {
    const token = await gateToken();
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource);
    const auth = { Authorization: `Bearer ${token}` };

    const lock = await request(server)
      .post(`/api/matches/${match.id}/seats/${seatA.id}/lock`)
      .set(auth);
    expect(lock.status).toBe(403);
    const best = await request(server)
      .post(`/api/matches/${match.id}/seats/best`)
      .set(auth)
      .send({ section: 'A', count: 1 });
    expect(best.status).toBe(403);
    const intent = await request(server).post('/api/payments/create-intent').set(auth).send({});
    expect(intent.status).toBe(403);
    const purchase = await request(server).post('/api/season-passes/purchase').set(auth).send({});
    expect(purchase.status).toBe(403);
    for (const [method, path] of [
      ['get', '/api/loyalty/me'],
      ['get', '/api/season-passes/me'],
      ['get', '/api/waitlist/me'],
      ['get', '/api/users/me'],
      ['patch', '/api/users/me'],
      ['get', '/api/tickets/me'],
    ] as const) {
      const res = await request(server)[method](path).set(auth);
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
    // nothing was held
    expect(await ctx.redis.keys('seat-lock*')).toEqual([]);
  });

  it('lets the gate user change the password and log out', async () => {
    const token = await gateToken();
    const change = await request(server)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'GatePass123', newPassword: 'UjJelszo4567!' });
    expect(change.status).toBe(200);
    const out = await request(server)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${change.body.accessToken as string}`)
      .send({});
    expect(out.status).toBe(204);
  });

  it('still refuses a fan on scan (403) and a guest (401)', async () => {
    const token = await fanToken();
    const id = randomUUID();
    const fan = await request(server)
      .patch(`/api/tickets/${id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'x' });
    expect(fan.status).toBe(403);
    const guest = await request(server).patch(`/api/tickets/${id}/scan`).send({ token: 'x' });
    expect(guest.status).toBe(401);
  });

  it('does not refuse the gate user on the scan route itself (it reaches the handler)', async () => {
    const token = await gateToken();
    const res = await request(server)
      .patch(`/api/tickets/${randomUUID()}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'not-a-token' });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
