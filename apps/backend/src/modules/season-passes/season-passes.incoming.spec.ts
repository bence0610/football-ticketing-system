import { NotFoundException } from '@nestjs/common';
import { MoreThan } from 'typeorm';
import { SeasonPassesService } from './season-passes.service';
import { PassLoanStatus } from '../../database/entities';

/** The in-app banner reads this: invitations must be findable without the email. */
describe('SeasonPassesService.listIncomingLoans', () => {
  const find = jest.fn();
  const findUser = jest.fn();

  function service(): SeasonPassesService {
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
    return new SeasonPassesService(
      {} as never,
      { find } as never,
      {} as never,
      { findOne: findUser } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }

  const loan = (token: string) => ({
    id: `id-${token}`,
    invitationToken: token,
    expiresAt: new Date('2026-11-12T10:00:00Z'),
    match: { homeTeam: 'KTE', awayTeam: 'Újpest', kickoffAt: new Date('2026-11-15T17:00:00Z') },
    seasonPass: { seat: { section: 'B', row: '3', number: 12 } },
    lender: { firstName: 'Béla', lastName: 'Kovács' },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findUser.mockResolvedValue({ id: 'u1', email: 'Friend@Test.hu' });
  });

  it('asks for pending, unexpired invitations by email (lower-cased) or by account', async () => {
    find.mockResolvedValue([]);
    await service().listIncomingLoans('u1');
    const where = find.mock.calls[0][0].where as Array<Record<string, unknown>>;
    expect(where).toHaveLength(2);
    for (const w of where) {
      expect(w['status']).toBe(PassLoanStatus.PENDING);
      expect(w['expiresAt']).toEqual(expect.objectContaining({ _type: MoreThan(new Date()).type }));
    }
    expect(where[0]['borrowerEmail']).toBe('friend@test.hu');
    expect(where[1]['borrowerUserId']).toBe('u1');
    expect(find.mock.calls[0][0].order).toEqual({ expiresAt: 'ASC' });
  });

  it('returns what the banner shows: lender, fixture, seat, deadline and the link token', async () => {
    find.mockResolvedValue([loan('tok-1')]);
    const [inv] = await service().listIncomingLoans('u1');
    expect(inv).toEqual({
      id: 'id-tok-1',
      invitationToken: 'tok-1',
      lenderName: 'Béla Kovács',
      matchTitle: 'KTE - Újpest',
      kickoffAt: '2026-11-15T17:00:00.000Z',
      seatSection: 'B',
      seatRow: '3',
      seatNumber: 12,
      expiresAt: '2026-11-12T10:00:00.000Z',
    });
  });

  it('unknown user is a 404', async () => {
    findUser.mockResolvedValue(null);
    await expect(service().listIncomingLoans('nobody')).rejects.toBeInstanceOf(NotFoundException);
  });
});
