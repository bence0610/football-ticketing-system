import './setup/test-env';

import { randomUUID } from 'crypto';
import { hash } from 'bcrypt';
import request from 'supertest';
import { Server } from 'http';
import {
  Competition,
  LoyaltyTier,
  Match,
  MatchStatus,
  Seat,
  SeatCategory,
  SeasonPassPrice,
  Sector,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
  UserRole,
} from '../src/database/entities';
import { runInitialSeed } from '../src/database/seeds/initial.seed';
import { STADIUM_LAYOUT, sectorSeatCount } from '../src/database/stadium-layout';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { truncateAll } from './helpers/db.helper';

/**
 * The Széktói Stadion layout, end to end: what the migration wrote, what the
 * seed generates, and that the away section, the gate and the row order behave
 * through the real HTTP API.
 */
const PASSWORD = 'FanPass123';

describe('Stadium layout (E2E)', () => {
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

  async function user(role: UserRole): Promise<{ id: string; token: string }> {
    const repo = ctx.dataSource.getRepository(User);
    const email = `${role}-${randomUUID().slice(0, 8)}@kte.hu`;
    const saved = await repo.save(
      repo.create({
        email,
        passwordHash: await hash(PASSWORD, 10),
        firstName: 'Teszt',
        lastName: role,
        role,
        loyaltyTier: LoyaltyTier.BRONZE,
        loyaltyPoints: 0,
        emailVerified: true,
        twoFactorEnabled: false,
        isActive: true,
      }),
    );
    const login = await request(server).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    return { id: saved.id, token: login.body.accessToken as string };
  }

  async function seat(section: string, row: string, number: number): Promise<Seat> {
    const repo = ctx.dataSource.getRepository(Seat);
    return repo.save(
      repo.create({
        section,
        row,
        number,
        category: SeatCategory.STANDARD,
        priceModifier: '1.00',
        isAccessible: false,
        isActive: true,
      }),
    );
  }

  async function match(): Promise<Match> {
    const repo = ctx.dataSource.getRepository(Match);
    return repo.save(
      repo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Layout FC',
        competition: Competition.NB1,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + 7 * 86_400_000),
        status: MatchStatus.ON_SALE,
        capacity: 100,
        basePrice: '3000.00',
        isSeasonPassEligible: true,
      }),
    );
  }

  async function priceRow(section: string, price = 25000): Promise<SeasonPassPrice> {
    const repo = ctx.dataSource.getRepository(SeasonPassPrice);
    return repo.save(
      repo.create({
        section,
        sectionLabel: `${section} szektor`,
        seasonLabel: '2026/2027',
        price,
        currency: 'HUF',
        validFrom: new Date('2026-07-01'),
        validUntil: new Date('2027-06-30'),
        isActive: true,
      }),
    );
  }

  it('the migration left exactly the 19 sectors of the layout in the database', async () => {
    const rows = await ctx.dataSource.getRepository(Sector).find();
    expect(rows.length).toBe(19);
    for (const layout of STADIUM_LAYOUT) {
      const row = rows.find((r) => r.code === layout.code);
      expect(row).toMatchObject({
        name: layout.name,
        isCovered: layout.isCovered,
        arc: layout.arc,
        position: layout.position,
        gate: layout.gate,
        priceCategory: layout.priceCategory,
        isAway: layout.isAway,
      });
    }
  });

  it('the database itself rejects a gate outside 1-4', async () => {
    await expect(
      ctx.dataSource.query("UPDATE sectors SET gate = 5 WHERE code = 'VIP'"),
    ).rejects.toThrow();
  });

  it('the seed generates 5,468 seats and three pass prices (one per tier) from the layout, none for VENDÉG', async () => {
    await runInitialSeed(ctx.dataSource);

    expect(await ctx.dataSource.getRepository(Seat).count()).toBe(5468);
    for (const layout of STADIUM_LAYOUT) {
      expect(
        await ctx.dataSource.getRepository(Seat).count({ where: { section: layout.code } }),
      ).toBe(sectorSeatCount(layout));
    }

    // tier -> modifier, by sampling a seat of each tier
    const modifierOf = async (code: string): Promise<string> =>
      (await ctx.dataSource.getRepository(Seat).findOneOrFail({ where: { section: code } }))
        .priceModifier;
    expect(await modifierOf('VIP')).toBe('2.50');
    expect(await modifierOf('J')).toBe('1.40');
    expect(await modifierOf('K')).toBe('1.40');
    expect(await modifierOf('M')).toBe('1.40');
    expect(await modifierOf('D/1')).toBe('1.00');
    expect(await modifierOf('C/2')).toBe('1.00');
    // the away section has no price: the neutral modifier, and it is never sold
    expect(await modifierOf('VENDÉG')).toBe('1.00');

    // the accessible placeholder: row 1 of E, F and A/2 only
    const accessible = await ctx.dataSource
      .getRepository(Seat)
      .find({ where: { isAccessible: true } });
    expect(new Set(accessible.map((s) => s.section))).toEqual(new Set(['E', 'F', 'A/2']));
    expect(accessible.every((s) => s.row === '1')).toBe(true);
    expect(accessible.length).toBe(24 + 26 + 18);

    const prices = await ctx.dataSource.getRepository(SeasonPassPrice).find();
    expect(prices.length).toBe(3);
    expect(prices.map((p) => p.section).sort()).toEqual(['lower', 'upper', 'vip']);
    expect(prices.find((p) => p.section === 'vip')?.price).toBe(45000);
    expect(prices.find((p) => p.section === 'lower')?.price).toBe(30000);
    expect(prices.find((p) => p.section === 'upper')?.price).toBe(22000);

    // a second run changes nothing, and matches carry the new capacity
    await runInitialSeed(ctx.dataSource);
    expect(await ctx.dataSource.getRepository(Seat).count()).toBe(5468);
    const matches = await ctx.dataSource.getRepository(Match).find();
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.capacity === 5468)).toBe(true);
  }, 120_000);

  it('the seed refuses a database that still holds the old layout', async () => {
    await seat('A', '1', 1); // an old-layout seat
    await expect(runInitialSeed(ctx.dataSource)).rejects.toThrow(/stadium layout/);
  }, 60_000);

  describe('VENDÉG, the away section', () => {
    it('shows as away on the seat map, with nothing available in it', async () => {
      const m = await match();
      const away = await seat('VENDÉG', '1', 1);
      await seat('K', '1', 1);

      const res = await request(server).get(`/api/matches/${m.id}/seats`);
      expect(res.status).toBe(200);
      const status = (id: string): string =>
        (res.body.seats as Array<{ id: string; status: string }>).find((s) => s.id === id)!.status;
      expect(status(away.id)).toBe('away');

      const summary = res.body.sectorSummary as Array<Record<string, unknown>>;
      const vendeg = summary.find((s) => s.section === 'VENDÉG')!;
      expect(vendeg).toMatchObject({ isAway: true, available: 0, gate: 3, name: 'Vendég szektor' });
      expect(summary.find((s) => s.section === 'K')).toMatchObject({ isAway: false, available: 1 });
    });

    it('cannot be locked or paid for', async () => {
      const m = await match();
      const away = await seat('VENDÉG', '1', 1);
      const fan = await user(UserRole.FAN);

      const lock = await request(server)
        .post(`/api/matches/${m.id}/seats/${away.id}/lock`)
        .set('Authorization', `Bearer ${fan.token}`)
        .send();
      expect(lock.status).toBe(403);

      const intent = await request(server)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${fan.token}`)
        .send({ matchId: m.id, seats: [{ seatId: away.id, ownerToken: 'forged' }] });
      expect(intent.status).toBe(403);
      expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
    });

    it('cannot be bought as a season pass, even if a price row exists for it', async () => {
      await seat('VENDÉG', '1', 1);
      await priceRow('VENDÉG');
      await priceRow('K'); // an old per-sector row is not a tier either
      await priceRow('upper', 22000);
      const fan = await user(UserRole.FAN);

      const list = await request(server).get('/api/season-passes/prices');
      expect(list.status).toBe(200);
      expect((list.body as Array<{ sectionId: string }>).map((p) => p.sectionId)).toEqual(['upper']);

      const buy = await request(server)
        .post('/api/season-passes/purchase')
        .set('Authorization', `Bearer ${fan.token}`)
        .send({ sectionId: 'VENDÉG' });
      expect(buy.status).toBe(403);
      expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('a match that has kicked off', () => {
    it('cannot be locked or paid for, whatever the client shows', async () => {
      const m = await match();
      await ctx.dataSource
        .getRepository(Match)
        .update({ id: m.id }, { kickoffAt: new Date(Date.now() - 60_000) });
      const free = await seat('K', '1', 1);
      const fan = await user(UserRole.FAN);

      const lock = await request(server)
        .post(`/api/matches/${m.id}/seats/${free.id}/lock`)
        .set('Authorization', `Bearer ${fan.token}`)
        .send();
      expect(lock.status).toBe(409);
      expect(lock.body.code).toBe('match_started');

      const intent = await request(server)
        .post('/api/payments/create-intent')
        .set('Authorization', `Bearer ${fan.token}`)
        .send({ matchId: m.id, seats: [{ seatId: free.id, ownerToken: 'forged' }] });
      expect(intent.status).toBe(409);
      expect(intent.body.code).toBe('match_started');
      expect(ctx.stripeStub.paymentIntentsCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('row order', () => {
    it('lists seats in stadium order with rows 1, 2, 3, 10, not 1, 10, 2, 3', async () => {
      const m = await match();
      // Inserted out of order on purpose; sector K is mid-arc, D/1 is first.
      for (const [section, row] of [
        ['K', '10'],
        ['K', '2'],
        ['K', '3'],
        ['D/1', '12'],
        ['K', '1'],
        ['D/1', '2'],
      ] as const) {
        await seat(section, row, 1);
      }

      const res = await request(server).get(`/api/matches/${m.id}/seats`);
      expect(res.status).toBe(200);
      const order = (res.body.seats as Array<{ section: string; row: string }>).map(
        (s) => `${s.section}/${s.row}`,
      );
      expect(order).toEqual(['D/1/2', 'D/1/12', 'K/1', 'K/2', 'K/3', 'K/10']);

      const sectors = (res.body.sectorSummary as Array<{ section: string }>).map((s) => s.section);
      expect(sectors).toEqual(['D/1', 'K']);
    });

    it('gives a season pass the first free seat by row number (row 2, not row 10)', async () => {
      await seat('K', '10', 1);
      const two = await seat('K', '2', 1);
      const row = await priceRow('lower', 30000);
      const fan = await user(UserRole.FAN);

      const buy = await request(server)
        .post('/api/season-passes/purchase')
        .set('Authorization', `Bearer ${fan.token}`)
        .send({ sectionId: 'lower' });
      expect(buy.status).toBe(201);
      const stored = ctx.stripeStub.getStoredIntent(buy.body.paymentIntentId as string)!;
      expect(stored.metadata.priceRowId).toBe(row.id);

      const payload = JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: 'event',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: stored.id,
            object: 'payment_intent',
            amount: stored.amount,
            currency: 'huf',
            status: 'succeeded',
            metadata: stored.metadata,
          },
        },
      });
      const { buildStripeWebhookHeader } = await import('./helpers/stripe-stub');
      const hook = await request(server)
        .post('/api/webhooks/stripe')
        .set('stripe-signature', buildStripeWebhookHeader(payload))
        .set('content-type', 'application/json')
        .send(payload);
      expect(hook.status).toBe(200);
      await new Promise((r) => setTimeout(r, 100));

      const mine = await request(server)
        .get('/api/season-passes/me')
        .set('Authorization', `Bearer ${fan.token}`);
      expect(mine.status).toBe(200);
      expect(mine.body.length).toBe(1);
      expect(mine.body[0].seatLabel).toBe('K szektor / 2. sor / 1. szék');
      const pass = await ctx.dataSource.query('SELECT seat_id AS seatId FROM season_passes');
      expect(pass[0].seatId).toBe(two.id);
    });
  });

  describe('the gate', () => {
    async function ticketIn(
      section: string,
    ): Promise<{ fan: { id: string; token: string }; ticket: Ticket }> {
      const m = await match();
      const s = await seat(section, '1', 1);
      const fan = await user(UserRole.FAN);
      const ticket = await ctx.dataSource.getRepository(Ticket).save(
        ctx.dataSource.getRepository(Ticket).create({
          matchId: m.id,
          seatId: s.id,
          userId: fan.id,
          status: TicketStatus.PAID,
          source: TicketSource.SINGLE,
          pricePaid: '3000.00',
          currency: 'HUF',
          qrCode: `KTE-${randomUUID()}`,
          qrJti: randomUUID(),
        }),
      );
      return { fan, ticket };
    }

    it.each([
      ['VIP', 1, 'VIP'],
      ['F', 1, 'F szektor'],
      ['K', 2, 'K szektor'],
      ['D/1', 2, 'D/1 szektor'],
      ['VENDÉG', 3, 'Vendég szektor'],
      ['A/2', 4, 'A/2 szektor'],
    ])('a ticket in %s tells the holder gate %i (%s)', async (section, gate, name) => {
      const { fan } = await ticketIn(section);
      const res = await request(server)
        .get('/api/tickets/me')
        .set('Authorization', `Bearer ${fan.token}`);
      expect(res.status).toBe(200);
      expect(res.body[0].seat).toMatchObject({ section, sectorName: name, gate });
    });

    it("the scan response carries the ticket's gate and still admits the holder", async () => {
      const { fan, ticket } = await ticketIn('E');
      const gate = await user(UserRole.GATE);
      const qr = await request(server)
        .get(`/api/tickets/${ticket.id}/qr`)
        .set('Authorization', `Bearer ${fan.token}`);
      expect(qr.status).toBe(200);

      const scan = await request(server)
        .patch(`/api/tickets/${ticket.id}/scan`)
        .set('Authorization', `Bearer ${gate.token}`)
        .send({ token: qr.body.token });
      expect(scan.status).toBe(200);
      // The gate is information for the steward, never a reason to refuse.
      expect(scan.body).toMatchObject({ success: true, result: 'ok' });
      expect(scan.body.seat).toMatchObject({ section: 'E', sectorName: 'E szektor', gate: 1 });
    });
  });
});
