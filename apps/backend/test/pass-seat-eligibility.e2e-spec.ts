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
  Ticket,
  TicketSource,
  TicketStatus,
  User,
  UserRole,
} from '../src/database/entities';
import { MatchFinishJob } from '../src/modules/matches/jobs/match-finish.job';
import { ExpireTicketsJob } from '../src/modules/tickets/jobs/expire-tickets.job';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { seedSeasonPass, truncateAll } from './helpers/db.helper';

/**
 * A season pass is an entry to the matches it is valid for: the season-pass eligible league home
 * matches. On a friendly or a cup tie the holder has no entry, so the pass seat is empty, is sold
 * like any other seat and is not counted as occupied; on a league match it is held and counted.
 * Also: the pass figure of the admin match list (valid passes ahead, entered passes once played),
 * the job that marks matches finished, and the ticket expiry that must not wait for that status.
 */
const PASSWORD = 'AdminPass123';
const DAY = 86_400_000;

describe('Pass seats and the matches a pass covers (E2E)', () => {
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

  async function createUser(role: UserRole): Promise<{ id: string; token: string }> {
    const repo = ctx.dataSource.getRepository(User);
    const email = `${role}-${randomUUID().slice(0, 8)}@kte.hu`;
    const user = await repo.save(
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
    return { id: user.id, token: login.body.accessToken as string };
  }

  async function seedMatch(
    over: Partial<Match> & { eligible: boolean; kickoffInDays: number },
  ): Promise<Match> {
    const repo = ctx.dataSource.getRepository(Match);
    return repo.save(
      repo.create({
        homeTeam: 'Kecskeméti TE',
        awayTeam: 'Teszt FC',
        competition: over.eligible ? Competition.NB2 : Competition.FRIENDLY,
        venue: 'Széktói Stadion',
        kickoffAt: new Date(Date.now() + over.kickoffInDays * DAY),
        status: over.status ?? MatchStatus.ON_SALE,
        capacity: 10,
        basePrice: '3000.00',
        isSeasonPassEligible: over.eligible,
      }),
    );
  }

  /** Two seats in a real, non-away sector; the first one carries a season pass. */
  async function seedPassSeat(): Promise<{ passSeat: Seat; user: { id: string; token: string } }> {
    const repo = ctx.dataSource.getRepository(Seat);
    const make = (number: number): Promise<Seat> =>
      repo.save(
        repo.create({
          section: 'D/1',
          row: '1',
          number,
          category: SeatCategory.STANDARD,
          priceModifier: '1.00',
          isAccessible: false,
          isActive: true,
        }),
      );
    const passSeat = await make(1);
    await make(2);
    const user = await createUser(UserRole.FAN);
    await seedSeasonPass(ctx.dataSource, { userId: user.id, seatId: passSeat.id });
    return { passSeat, user };
  }

  const seatStatus = async (matchId: string, seatId: string): Promise<string> => {
    const res = await request(server).get(`/api/matches/${matchId}/seats`);
    expect(res.status).toBe(200);
    return (res.body.seats as Array<{ id: string; status: string }>).find((s) => s.id === seatId)!
      .status;
  };

  it('seat map and lock: a pass seat is held on a league match, sold like any other on a friendly', async () => {
    const { passSeat, user } = await seedPassSeat();
    const league = await seedMatch({ eligible: true, kickoffInDays: 7 });
    const friendly = await seedMatch({ eligible: false, kickoffInDays: 8 });
    const auth = { Authorization: `Bearer ${user.token}` };

    expect(await seatStatus(league.id, passSeat.id)).toBe('season_pass');
    expect(await seatStatus(friendly.id, passSeat.id)).toBe('available');

    const heldLock = await request(server)
      .post(`/api/matches/${league.id}/seats/${passSeat.id}/lock`)
      .set(auth);
    expect(heldLock.status).toBe(409);
    const openLock = await request(server)
      .post(`/api/matches/${friendly.id}/seats/${passSeat.id}/lock`)
      .set(auth);
    expect(openLock.status).toBe(201);
  });

  it('best-seats finder: counts the pass seat as free on a friendly only', async () => {
    const { user } = await seedPassSeat();
    const league = await seedMatch({ eligible: true, kickoffInDays: 7 });
    const friendly = await seedMatch({ eligible: false, kickoffInDays: 8 });
    const auth = { Authorization: `Bearer ${user.token}` };

    // two seats in the sector, one of them a pass seat: two together only where the pass is not valid
    const onLeague = await request(server)
      .post(`/api/matches/${league.id}/seats/best`)
      .set(auth)
      .send({ section: 'D/1', count: 2 });
    expect(onLeague.status).toBe(409);
    const onFriendly = await request(server)
      .post(`/api/matches/${friendly.id}/seats/best`)
      .set(auth)
      .send({ section: 'D/1', count: 2 });
    expect(onFriendly.status).toBe(201);
  });

  it('admin: occupancy report, overview and heatmap count the pass seat only where the pass is valid', async () => {
    const { passSeat } = await seedPassSeat();
    const league = await seedMatch({ eligible: true, kickoffInDays: 7 });
    const friendly = await seedMatch({ eligible: false, kickoffInDays: 8 });
    const admin = await createUser(UserRole.ADMIN);
    const auth = { Authorization: `Bearer ${admin.token}` };

    const occ = async (m: Match) =>
      (await request(server).get(`/api/admin/matches/${m.id}/occupancy`).set(auth)).body;
    expect((await occ(league)).totalSold).toBe(1);
    expect((await occ(friendly)).totalSold).toBe(0);

    const overview = await request(server).get('/api/admin/overview?period=30d').set(auth);
    expect(overview.status).toBe(200);
    const rowOf = (m: Match) =>
      (overview.body.matches as Array<Record<string, unknown>>).find((r) => r.matchId === m.id)!;
    expect(rowOf(league).occupiedSeats).toBe(1);
    expect(rowOf(friendly).occupiedSeats).toBe(0);
    expect(rowOf(friendly).occupancyPercent).toBe(0);

    // heatmap: a played league match takes the pass seat, a played friendly does not
    const playedLeague = await seedMatch({
      eligible: true,
      kickoffInDays: -3,
      status: MatchStatus.FINISHED,
    });
    await seedMatch({ eligible: false, kickoffInDays: -2, status: MatchStatus.FINISHED });
    const sales = await request(server).get('/api/admin/seat-sales').set(auth);
    expect(sales.status).toBe(200);
    expect(sales.body.matchCount).toBe(2);
    const taken = (sales.body.seats as Array<{ number: number; taken: number }>).find(
      (s) => s.number === passSeat.number,
    )!;
    expect(taken.taken).toBe(1);
    expect(playedLeague.id).toBeDefined();
  });

  it('admin match list: valid passes ahead of a match, entered pass holders once it is played', async () => {
    const { passSeat, user } = await seedPassSeat();
    const upcoming = await seedMatch({ eligible: true, kickoffInDays: 7 });
    const friendly = await seedMatch({ eligible: false, kickoffInDays: 8 });
    const played = await seedMatch({
      eligible: true,
      kickoffInDays: -3,
      status: MatchStatus.FINISHED,
    });
    const admin = await createUser(UserRole.ADMIN);
    const auth = { Authorization: `Bearer ${admin.token}` };
    const repo = ctx.dataSource.getRepository(Ticket);
    const entry = (status: TicketStatus): Ticket =>
      repo.create({
        matchId: played.id,
        seatId: passSeat.id,
        userId: user.id,
        status,
        source: TicketSource.SEASON_PASS,
        pricePaid: '0.00',
        currency: 'HUF',
        qrCode: `KTE-SP-${randomUUID()}`,
        qrJti: randomUUID(),
      });
    await repo.save(entry(TicketStatus.USED));

    const res = await request(server).get('/api/admin/overview?period=30d').set(auth);
    const row = (m: Match) =>
      (res.body.matches as Array<Record<string, unknown>>).find((r) => r.matchId === m.id)!;

    // ahead: the passes valid for it, no ticket needed (none was issued)
    expect(row(upcoming)).toMatchObject({ passesValid: 1, passEntered: null });
    expect(row(friendly)).toMatchObject({ passesValid: 0, passEntered: null });
    // played: the holders who entered
    expect(row(played)).toMatchObject({ passesValid: null, passEntered: 1 });
    expect(res.body.metrics.passEntries).toBe(1);
  });

  it('a holder cannot open the entry QR of a match the pass does not cover', async () => {
    const { user } = await seedPassSeat();
    const friendly = await seedMatch({ eligible: false, kickoffInDays: 8 });
    const league = await seedMatch({ eligible: true, kickoffInDays: 7 });
    const pass = (await ctx.dataSource.query('SELECT id FROM season_passes LIMIT 1'))[0]
      .id as string;
    const auth = { Authorization: `Bearer ${user.token}` };

    const refused = await request(server)
      .get(`/api/season-passes/${pass}/qr/${friendly.id}`)
      .set(auth);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('match_not_pass_eligible');
    const ok = await request(server).get(`/api/season-passes/${pass}/qr/${league.id}`).set(auth);
    expect(ok.status).toBe(200);
  });

  it('MatchFinishJob marks a played match finished some hours after kickoff, and leaves the rest alone', async () => {
    const longAgo = await seedMatch({ eligible: true, kickoffInDays: -1 }); // on_sale, 24 h ago
    const justNow = await seedMatch({ eligible: true, kickoffInDays: -(1 / 24) }); // 1 h ago
    const ahead = await seedMatch({ eligible: true, kickoffInDays: 3 });
    const cancelled = await seedMatch({
      eligible: true,
      kickoffInDays: -2,
      status: MatchStatus.CANCELLED,
    });
    const soldOut = await seedMatch({
      eligible: true,
      kickoffInDays: -2,
      status: MatchStatus.SOLD_OUT,
    });

    const marked = await ctx.app.get(MatchFinishJob).run();
    expect(marked).toBe(2);

    const statusOf = async (m: Match): Promise<MatchStatus> =>
      (await ctx.dataSource.getRepository(Match).findOneByOrFail({ id: m.id })).status;
    expect(await statusOf(longAgo)).toBe(MatchStatus.FINISHED);
    expect(await statusOf(soldOut)).toBe(MatchStatus.FINISHED);
    expect(await statusOf(justNow)).toBe(MatchStatus.ON_SALE);
    expect(await statusOf(ahead)).toBe(MatchStatus.ON_SALE);
    expect(await statusOf(cancelled)).toBe(MatchStatus.CANCELLED);
  });

  it('ticket expiry goes by the kickoff, not by a match status that nothing ever set', async () => {
    const { passSeat, user } = await seedPassSeat();
    // still on_sale (the job has not run), but kicked off two days ago
    const old = await seedMatch({ eligible: true, kickoffInDays: -2 });
    const repo = ctx.dataSource.getRepository(Ticket);
    const ticket = await repo.save(
      repo.create({
        matchId: old.id,
        seatId: passSeat.id,
        userId: user.id,
        status: TicketStatus.PAID,
        source: TicketSource.SINGLE,
        pricePaid: '3000.00',
        currency: 'HUF',
        qrCode: `KTE-${randomUUID()}`,
        qrJti: randomUUID(),
      }),
    );

    await ctx.app.get(ExpireTicketsJob).run();
    expect((await repo.findOneByOrFail({ id: ticket.id })).status).toBe(TicketStatus.EXPIRED);
  });
});
