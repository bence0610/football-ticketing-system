import './setup/test-env';

import { randomUUID } from 'crypto';
import { Ticket, TicketSource, TicketStatus } from '../src/database/entities';
import { closeTestApp, createTestApp, TestContext } from './helpers/app.helper';
import { createGateUser, seedMinimalFixture, truncateAll } from './helpers/db.helper';

/**
 * The unique index uq_tickets_match_seat and the application's idea of a free seat agree: only a
 * ticket that OCCUPIES the seat (pending_payment, paid, used) holds the (match, seat) slot. A
 * cancelled, refunded or expired row leaves the seat free to sell again.
 */
describe('Ticket slot: only an occupying ticket holds (match, seat) (E2E)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    if (ctx) await closeTestApp(ctx);
  });
  beforeEach(async () => {
    await truncateAll(ctx.dataSource);
  });

  const make = (matchId: string, seatId: string, userId: string, status: TicketStatus): Ticket =>
    ctx.dataSource.getRepository(Ticket).create({
      matchId,
      seatId,
      userId,
      status,
      source: TicketSource.SINGLE,
      pricePaid: '3000.00',
      currency: 'HUF',
      qrCode: `KTE-${randomUUID()}`,
      qrJti: randomUUID().slice(0, 21),
    });

  async function fixture(): Promise<{ matchId: string; seatId: string; userId: string }> {
    const { match, seatA } = await seedMinimalFixture(ctx.dataSource, {});
    const { user } = await createGateUser(ctx.dataSource, {
      email: `slot-${randomUUID().slice(0, 6)}@kte.hu`,
    });
    const userId = user.id;
    return { matchId: match.id, seatId: seatA.id, userId };
  }

  it('lets a new ticket take a seat whose earlier ticket was cancelled, refunded or expired', async () => {
    const { matchId, seatId, userId } = await fixture();
    const repo = ctx.dataSource.getRepository(Ticket);
    await repo.save(make(matchId, seatId, userId, TicketStatus.CANCELLED));
    await repo.save(make(matchId, seatId, userId, TicketStatus.REFUNDED));
    await repo.save(make(matchId, seatId, userId, TicketStatus.EXPIRED));
    await expect(
      repo.save(make(matchId, seatId, userId, TicketStatus.PAID)),
    ).resolves.toBeDefined();
  });

  it('still refuses a second occupying ticket for the same seat and match', async () => {
    const { matchId, seatId, userId } = await fixture();
    const repo = ctx.dataSource.getRepository(Ticket);
    await repo.save(make(matchId, seatId, userId, TicketStatus.PAID));
    await expect(repo.save(make(matchId, seatId, userId, TicketStatus.USED))).rejects.toMatchObject(
      {
        code: 'ER_DUP_ENTRY',
      },
    );
    await expect(
      repo.save(make(matchId, seatId, userId, TicketStatus.PENDING_PAYMENT)),
    ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });
});
