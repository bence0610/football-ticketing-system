import { SeasonPassesService } from './season-passes.service';
import {
  PassLoan,
  PassLoanStatus,
  Ticket,
  TicketSource,
  TicketStatus,
} from '../../database/entities';

/**
 * What a finished loan honestly says. COMPLETED means "lent, accepted, but the
 * borrowed entry was never scanned"; USED means "lent and used". The sweeper
 * must not turn the second into the first.
 */
describe('SeasonPassesService.completeLoan', () => {
  const save = jest.fn(async (x: unknown) => x);
  const revoke = jest.fn();
  const award = jest.fn();
  let service: SeasonPassesService;

  function loan(status: PassLoanStatus, extra: Partial<PassLoan> = {}): PassLoan {
    return {
      id: 'loan-1',
      status,
      lenderUserId: 'lender-1',
      matchId: 'm1',
      seasonPassId: 'p1',
      qrJti: 'jti-1',
      ...extra,
    } as PassLoan;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === PassLoan) return { save };
        if (entity === Ticket)
          return {
            findOne: async () => ({
              source: TicketSource.LOAN,
              status: TicketStatus.PAID,
              qrJti: 'ticket-jti',
            }),
          };
        throw new Error('unexpected repo');
      },
    };
    const config = {
      getOrThrow: (key: string) =>
        ({
          mail: {},
          cron: {},
          loyalty: {},
          stripe: { currency: 'HUF' },
          app: { homeTeamName: 'KTE' },
        })[key],
    };
    service = new SeasonPassesService(
      {} as never,
      { save } as never,
      {} as never,
      {} as never,
      {} as never,
      { transaction: async (cb: (m: unknown) => unknown) => cb(manager) } as never,
      {} as never,
      {} as never,
      config as never,
      {} as never,
      { revoke } as never,
      { award, getConfig: () => ({ passLoanPoints: 25 }) } as never,
      {} as never,
    );
  });

  it('an accepted loan whose entry was never scanned becomes COMPLETED and is rewarded', async () => {
    const l = loan(PassLoanStatus.ACCEPTED);
    await service.completeLoan(l);
    expect(l.status).toBe(PassLoanStatus.COMPLETED);
    expect(l.completedAt).toBeInstanceOf(Date);
    expect(revoke).toHaveBeenCalledWith('ticket-jti');
    expect(award).toHaveBeenCalledTimes(1);
  });

  it('a loan whose entry was scanned stays USED - never rewritten to COMPLETED', async () => {
    const l = loan(PassLoanStatus.USED);
    await service.completeLoan(l);
    expect(l.status).toBe(PassLoanStatus.USED);
    expect(l.completedAt).toBeInstanceOf(Date);
    expect(award).toHaveBeenCalledTimes(1);
  });

  it('a USED loan is rewarded only once', async () => {
    const l = loan(PassLoanStatus.USED, { completedAt: new Date() });
    await service.completeLoan(l);
    expect(award).not.toHaveBeenCalled();
  });

  it('ignores loans in any other state', async () => {
    const l = loan(PassLoanStatus.CANCELLED);
    await service.completeLoan(l);
    expect(l.status).toBe(PassLoanStatus.CANCELLED);
    expect(award).not.toHaveBeenCalled();
  });
});
