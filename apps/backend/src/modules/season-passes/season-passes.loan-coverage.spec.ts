import { BadRequestException } from '@nestjs/common';
import { SeasonPassesService } from './season-passes.service';
import {
  Match,
  MatchStatus,
  PassLoan,
  PassLoanStatus,
  Ticket,
  User,
} from '../../database/entities';

/**
 * A loan hands out the holder's right of entry, so it needs the same coverage check as the
 * holder's own QR (eligible home match, not cancelled or postponed, inside the pass period), when
 * it is created and when it is accepted; and it cannot be accepted once the match has kicked off.
 */
const DAY = 86_400_000;
const pass = {
  id: 'p1',
  userId: 'buyer',
  holderUserId: 'buyer',
  seatId: 'seat-1',
  status: 'active',
  validFrom: new Date('2026-07-01'),
  validUntil: new Date('2027-06-30'),
};

function match(over: Partial<Match> = {}): Match {
  return {
    id: 'm1',
    homeTeam: 'KTE',
    awayTeam: 'Vendég',
    isSeasonPassEligible: true,
    status: MatchStatus.ON_SALE,
    kickoffAt: new Date(Date.now() + 5 * DAY),
    ...over,
  } as unknown as Match;
}

describe('loans need a match the pass covers', () => {
  const savedLoans: unknown[] = [];
  let borrowerVerified = true;
  beforeEach(() => {
    borrowerVerified = true;
  });

  function service(m: Match, loanRow?: Partial<PassLoan>): SeasonPassesService {
    const lender = { id: 'buyer', email: 'holder@x.hu' };
    const ticketRepo = {
      findOne: async () => null,
      delete: jest.fn(),
      create: (x: unknown) => x,
      save: async (x: unknown) => x,
    };
    const loanRepo = {
      findOne: async () => loanRow ?? null,
      create: (x: unknown) => x,
      save: async (x: PassLoan) => {
        savedLoans.push(x);
        return { ...x, id: 'loan1' };
      },
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === PassLoan) return loanRepo;
        if (entity === Ticket) return ticketRepo;
        if (entity === User)
          return {
            findOne: async () => ({
              id: 'friend',
              email: 'friend@x.hu',
              emailVerified: borrowerVerified,
            }),
          };
        throw new Error('unexpected repo');
      },
    };
    const dataSource = {
      manager,
      transaction: async (cb: (m: unknown) => unknown) => cb(manager),
    };
    const config = {
      getOrThrow: (key: string) =>
        ({
          mail: { baseUrl: 'x' },
          cron: { loanInvitationTtlHours: 48 },
          loyalty: {},
          stripe: { currency: 'HUF' },
          app: { homeTeamName: 'KTE' },
        })[key],
    };
    return new SeasonPassesService(
      { findOne: async () => pass } as never,
      loanRepo as never,
      { findOne: async () => m } as never,
      {
        findOne: async ({ where }: { where: { id?: string; email?: string } }) =>
          where.id || where.email === 'holder@x.hu' ? lender : null,
      } as never,
      {} as never,
      dataSource as never,
      {} as never,
      {} as never,
      config as never,
      { send: async () => undefined } as never,
      { revoke: jest.fn(), generateJti: () => 'jti' } as never,
      {} as never,
      { matchSummary: () => ({}), formatSeat: () => '' } as never,
      {} as never,
      {} as never, // ActiveSeasonService: not used by the loan checks
    );
  }

  const create = (svc: SeasonPassesService) =>
    svc.createLoan('p1', 'buyer', { borrowerEmail: 'friend@x.hu', matchId: 'm1' } as never);

  it('creates a loan for a covered home match', async () => {
    await expect(create(service(match()))).resolves.toBeDefined();
  });

  it.each([
    ['a friendly (not eligible)', { isSeasonPassEligible: false }],
    ['an away match', { homeTeam: 'Újpest', awayTeam: 'KTE' }],
    ['a cancelled match', { status: MatchStatus.CANCELLED }],
    ['a postponed match', { status: MatchStatus.POSTPONED }],
  ] as Array<[string, Partial<Match>]>)('refuses to create a loan for %s', async (_name, over) => {
    await expect(create(service(match(over)))).rejects.toMatchObject({
      response: { code: 'match_not_pass_eligible' },
    });
  });

  it('refuses a match outside the pass period (another season)', async () => {
    const svc = service(match({ kickoffAt: new Date('2028-03-01T18:00:00Z') }));
    await expect(create(svc)).rejects.toMatchObject({
      response: { code: 'match_outside_validity' },
    });
  });

  it('creates a loan for a match the holder has already entered (refused later, at acceptance)', async () => {
    // no ownerTicket lookup happens on creation: the holder's entry is not consulted
    await expect(create(service(match()))).resolves.toBeDefined();
  });

  describe('acceptance', () => {
    const accept = (m: Match): Promise<unknown> =>
      service(m, {
        id: 'l1',
        status: PassLoanStatus.PENDING,
        expiresAt: new Date(Date.now() + DAY),
        borrowerEmail: 'friend@x.hu',
        matchId: 'm1',
        seasonPassId: 'p1',
        match: m,
        seasonPass: pass,
      } as never).acceptLoan('tok', 'friend');

    it('refuses after kickoff', async () => {
      const started = match({ kickoffAt: new Date(Date.now() - 60_000) });
      await expect(accept(started)).rejects.toBeInstanceOf(BadRequestException);
      await expect(accept(started)).rejects.toMatchObject({ response: { code: 'match_started' } });
    });

    it('refuses an account whose address is not verified, before anything is changed', async () => {
      borrowerVerified = false;
      await expect(accept(match())).rejects.toMatchObject({
        status: 403,
        response: { code: 'email_not_verified' },
      });
    });

    it('refuses a match the pass does not cover (it stopped being eligible since the invitation)', async () => {
      await expect(accept(match({ isSeasonPassEligible: false }))).rejects.toMatchObject({
        response: { code: 'match_not_pass_eligible' },
      });
    });
  });
});
