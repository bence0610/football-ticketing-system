import { Ticket, TicketSource, TicketStatus, User, SeasonPass } from '../../database/entities';
import { TicketsService } from './tickets.service';

/**
 * Scan verdict payloads. The gate screen needs, for a refused already-used
 * ticket as much as for an admitted one, who the person is and which seat it
 * was — the steward sends them to the service desk.
 */
describe('TicketsService.scanTicket payloads', () => {
  const TICKET_ID = '0b5f3c1e-aaaa-4bbb-8ccc-1234567890ab';
  const scannedAt = new Date('2026-11-09T17:40:00Z');

  function ticket(status: TicketStatus, source = TicketSource.SINGLE): Ticket {
    return {
      id: TICKET_ID,
      status,
      source,
      userId: 'u1',
      seasonPassId: null,
      qrJti: null,
      scannedAt: status === TicketStatus.USED ? scannedAt : undefined,
      usedAt: status === TicketStatus.USED ? scannedAt : undefined,
      match: {
        id: 'm1',
        homeTeam: 'KTE',
        awayTeam: 'Újpest',
        venue: 'Széktói',
        kickoffAt: new Date('2026-11-09T18:00:00Z'),
      },
      seat: { id: 's1', section: 'B', row: '5', number: 12, category: 'standard' },
    } as unknown as Ticket;
  }

  function service(t: Ticket, verify: unknown = jest.fn()): TicketsService {
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Ticket) return { findOne: async () => t, save: async (x: Ticket) => x };
        if (entity === User)
          return { findOne: async () => ({ id: 'u1', firstName: 'Anna', lastName: 'Kiss' }) };
        if (entity === SeasonPass) return { findOne: async () => null };
        throw new Error('unexpected repo');
      },
    };
    const dataSource = { transaction: async (cb: (m: unknown) => unknown) => cb(manager) };
    const qr = { verify, revoke: jest.fn() };
    return new TicketsService({} as never, dataSource as never, qr as never);
  }

  it('an already-used ticket says when, who, which seat and which match', async () => {
    const res = await service(ticket(TicketStatus.USED)).scanTicket(TICKET_ID, {});
    expect(res).toMatchObject({
      success: false,
      result: 'already_used',
      scannedAt: scannedAt.toISOString(),
      holderName: 'Anna Kiss',
      source: TicketSource.SINGLE,
      seat: { section: 'B', row: '5', number: 12 },
      match: { homeTeam: 'KTE', awayTeam: 'Újpest' },
    });
  });

  it('an admitted ticket keeps its full payload', async () => {
    const res = await service(ticket(TicketStatus.PAID)).scanTicket(TICKET_ID, {});
    expect(res).toMatchObject({
      success: true,
      result: 'ok',
      holderName: 'Anna Kiss',
      seat: { section: 'B' },
      match: { awayTeam: 'Újpest' },
    });
  });

  it('an expired ticket is refused without exposing a seat', async () => {
    const res = await service(ticket(TicketStatus.EXPIRED)).scanTicket(TICKET_ID, {});
    expect(res).toMatchObject({ success: false, result: 'expired' });
  });

  describe('a revoked token (the code was used before)', () => {
    const revoked = () =>
      jest.fn().mockResolvedValue({ valid: false, reason: 'revoked', payload: { sub: TICKET_ID } });

    it('on a used ticket reports already_used, not a bad code', async () => {
      const res = await service(ticket(TicketStatus.USED), revoked()).scanTicket(TICKET_ID, {
        token: 'x'.repeat(30),
      });
      expect(res).toMatchObject({
        success: false,
        result: 'already_used',
        holderName: 'Anna Kiss',
      });
    });

    it('on a ticket that is still paid stays invalid and never admits', async () => {
      const paid = ticket(TicketStatus.PAID);
      const res = await service(paid, revoked()).scanTicket(TICKET_ID, { token: 'x'.repeat(30) });
      expect(res).toMatchObject({ success: false, result: 'invalid', message: 'revoked' });
      expect(paid.status).toBe(TicketStatus.PAID);
    });

    it('a revoked token for a different ticket is just invalid', async () => {
      const other = jest
        .fn()
        .mockResolvedValue({ valid: false, reason: 'revoked', payload: { sub: 'other' } });
      const res = await service(ticket(TicketStatus.USED), other).scanTicket(TICKET_ID, {
        token: 'x'.repeat(30),
      });
      expect(res).toMatchObject({ success: false, result: 'invalid', message: 'revoked' });
    });
  });
});
