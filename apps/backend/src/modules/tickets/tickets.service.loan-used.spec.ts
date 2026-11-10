import {
  PassLoan,
  PassLoanStatus,
  SeasonPass,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
} from '../../database/entities';
import { TicketsService } from './tickets.service';

/** Scanning a borrowed entry is what makes the loan USED - and nothing else does. */
describe('TicketsService.scanTicket and the loan outcome', () => {
  const TICKET_ID = '0b5f3c1e-aaaa-4bbb-8ccc-1234567890ab';

  function ticket(source: TicketSource, status = TicketStatus.PAID): Ticket {
    return {
      id: TICKET_ID,
      status,
      source,
      userId: 'borrower',
      seasonPassId: 'pass-1',
      matchId: 'm1',
      qrJti: null,
      match: { id: 'm1', homeTeam: 'KTE', awayTeam: 'Újpest', venue: 'V', kickoffAt: new Date() },
      seat: { id: 's1', section: 'B', row: '5', number: 12, category: 'standard' },
    } as unknown as Ticket;
  }

  function setup(t: Ticket) {
    const loanUpdate = jest.fn();
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Ticket) return { findOne: async () => t, save: async (x: Ticket) => x };
        if (entity === PassLoan) return { update: loanUpdate };
        if (entity === User)
          return { findOne: async () => ({ id: 'borrower', firstName: 'Béla', lastName: 'Nagy' }) };
        if (entity === SeasonPass) return { findOne: async () => ({ holderName: 'Owner' }) };
        throw new Error('unexpected repo');
      },
    };
    const dataSource = { transaction: async (cb: (m: unknown) => unknown) => cb(manager) };
    const qr = { verify: jest.fn(), revoke: jest.fn() };
    return {
      loanUpdate,
      service: new TicketsService({} as never, dataSource as never, qr as never),
    };
  }

  it('scanning a borrowed entry marks the accepted loan USED', async () => {
    const { service, loanUpdate } = setup(ticket(TicketSource.LOAN));
    const res = await service.scanTicket(TICKET_ID, {});
    expect(res).toMatchObject({ success: true, result: 'ok', holderName: 'Béla Nagy' });
    expect(loanUpdate).toHaveBeenCalledWith(
      { seasonPassId: 'pass-1', matchId: 'm1', status: PassLoanStatus.ACCEPTED },
      { status: PassLoanStatus.USED },
    );
  });

  it("scanning the owner's own pass does not touch any loan", async () => {
    const { service, loanUpdate } = setup(ticket(TicketSource.SEASON_PASS));
    await service.scanTicket(TICKET_ID, {});
    expect(loanUpdate).not.toHaveBeenCalled();
  });

  it('a refused scan of a borrowed entry does not mark the loan USED', async () => {
    const { service, loanUpdate } = setup(ticket(TicketSource.LOAN, TicketStatus.EXPIRED));
    const res = await service.scanTicket(TICKET_ID, {});
    expect(res).toMatchObject({ success: false, result: 'expired' });
    expect(loanUpdate).not.toHaveBeenCalled();
  });

  it('the admit decision is the same for a borrowed and an own entry', async () => {
    const own = await setup(ticket(TicketSource.SEASON_PASS)).service.scanTicket(TICKET_ID, {});
    const lent = await setup(ticket(TicketSource.LOAN)).service.scanTicket(TICKET_ID, {});
    expect({ success: lent.success, result: lent.result }).toEqual({
      success: own.success,
      result: own.result,
    });
  });
});
