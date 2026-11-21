import { BadRequestException } from '@nestjs/common';
import { Match, MatchStatus } from '../../database/entities';
import { WaitlistService } from './waitlist.service';

/**
 * "Sold out" for the waitlist is the same figure the match list shows: occupying tickets PLUS the
 * seats of the passes valid for the match. Counting tickets alone never reached the capacity (the
 * pass seats are not for sale), so nobody could join the waitlist of a match that is full.
 */
describe('waitlist: when is a match sold out (F6)', () => {
  const kickoffAt = new Date(Date.now() + 5 * 86_400_000);
  const match = {
    id: 'm1',
    homeTeam: 'KTE',
    capacity: 10,
    isSeasonPassEligible: true,
    status: MatchStatus.ON_SALE,
    kickoffAt,
  } as unknown as Match;

  function service(tickets: number, passSeats: string[]): WaitlistService {
    const qb = {
      select: () => qb,
      addSelect: () => qb,
      where: () => qb,
      andWhere: () => qb,
      groupBy: () => qb,
      getRawMany: async () => [{ matchId: 'm1', soldCount: String(tickets) }],
    };
    const ticketRepo = {
      createQueryBuilder: () => qb,
      find: async () => [],
      manager: {
        getRepository: () => ({
          find: async () =>
            passSeats.map((seatId) => ({
              seatId,
              validFrom: new Date('2020-01-01'),
              validUntil: new Date('2099-12-31'),
            })),
        }),
      },
    };
    const waitlistRepo = {
      findOne: async () => null,
      create: (x: unknown) => x,
      save: async (x: object) => ({ ...x, id: 'w1', createdAt: new Date() }),
      count: async () => 0,
    };
    return new WaitlistService(
      waitlistRepo as never,
      { findOne: async () => match } as never,
      ticketRepo as never,
      {} as never,
      { getOrThrow: () => ({ homeTeamName: 'KTE' }) } as never,
    );
  }

  const join = (svc: WaitlistService) =>
    svc.joinWaitlist('u1', { matchId: 'm1', requestedQuantity: 1 } as never);

  it('lets a user join when tickets and pass seats together fill the capacity', async () => {
    // 7 tickets + 3 pass seats = 10 = capacity: sold out, though tickets alone are only 7
    await expect(join(service(7, ['p1', 'p2', 'p3']))).resolves.toBeDefined();
  });

  it('refuses while a seat is really left', async () => {
    await expect(join(service(6, ['p1', 'p2', 'p3']))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hasAvailability says the same', async () => {
    expect(await service(7, ['p1', 'p2', 'p3']).hasAvailability('m1')).toBe(false);
    expect(await service(6, ['p1', 'p2', 'p3']).hasAvailability('m1')).toBe(true);
  });
});
