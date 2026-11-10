import { ConflictException } from '@nestjs/common';
import { SeasonPassesService } from './season-passes.service';
import { PassLoan, PassLoanStatus, Ticket, TicketStatus } from '../../database/entities';

/** Once the borrowed entry has been used there is nothing left to withdraw. */
describe('SeasonPassesService.cancelLoan after entry', () => {
  const save = jest.fn(async (x: unknown) => x);
  const revoke = jest.fn();
  let loanTicketStatus: TicketStatus | null;

  function loan(status: PassLoanStatus): PassLoan {
    return {
      id: 'l1',
      status,
      lenderUserId: 'owner',
      matchId: 'm1',
      seasonPassId: 'p1',
      qrJti: 'jti',
      borrowerEmail: 'b@x.hu',
      seasonPass: { userId: 'owner', seatId: 's1' },
    } as unknown as PassLoan;
  }

  function service(l: PassLoan): SeasonPassesService {
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === PassLoan) return { findOne: async () => l, save };
        if (entity === Ticket)
          return {
            findOne: async ({ where }: { where: { status?: TicketStatus } }) =>
              loanTicketStatus && (!where.status || where.status === loanTicketStatus)
                ? { status: loanTicketStatus, qrJti: 't-jti' }
                : null,
            delete: jest.fn(),
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
    const email = { send: jest.fn() };
    const svc = new SeasonPassesService(
      {} as never,
      {} as never,
      { findOne: async () => null } as never,
      { findOne: async () => null } as never,
      {} as never,
      { transaction: async (cb: (m: unknown) => unknown) => cb(manager) } as never,
      {} as never,
      {} as never,
      config as never,
      email as never,
      { revoke } as never,
      {} as never,
      { matchSummary: () => ({ title: 't', kickoffLabel: 'k' }) } as never,
    );
    return svc;
  }

  const attempt = (l: PassLoan) => service(l).cancelLoan('p1', 'l1', 'owner', { reason: 'x' });

  beforeEach(() => {
    jest.clearAllMocks();
    loanTicketStatus = null;
  });

  async function refusal(l: PassLoan): Promise<ConflictException> {
    const err = await attempt(l).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConflictException);
    return err as ConflictException;
  }

  it('a USED loan is refused with a code and a Hungarian reason, and nothing is written', async () => {
    const err = await refusal(loan(PassLoanStatus.USED));
    expect(err.getResponse()).toMatchObject({ statusCode: 409, code: 'loan_already_used' });
    expect((err.getResponse() as { message: string }).message).toContain('már belépett');
    expect(save).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('an ACCEPTED loan whose borrowed ticket was already scanned (older data) is refused the same way', async () => {
    loanTicketStatus = TicketStatus.USED;
    const err = await refusal(loan(PassLoanStatus.ACCEPTED));
    expect(err.getResponse()).toMatchObject({ code: 'loan_already_used' });
    expect(save).not.toHaveBeenCalled();
  });

  it('an ACCEPTED loan whose borrower has not entered can still be withdrawn', async () => {
    loanTicketStatus = TicketStatus.PAID;
    const l = loan(PassLoanStatus.ACCEPTED);
    await attempt(l);
    expect(l.status).toBe(PassLoanStatus.CANCELLED);
    expect(save).toHaveBeenCalled();
  });

  it('other finished loans get a Hungarian refusal with their own code', async () => {
    await expect(attempt(loan(PassLoanStatus.COMPLETED))).rejects.toMatchObject({
      response: { code: 'loan_not_cancellable' },
    });
  });
});
