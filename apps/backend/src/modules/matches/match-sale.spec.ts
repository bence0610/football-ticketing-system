import { MatchStatus } from '../../database/entities';
import { assertMatchOpenForSale } from './match-sale';

describe('assertMatchOpenForSale', () => {
  const HOME = 'Kecskeméti TE';
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 60_000);

  it('lets an upcoming on-sale match through', () => {
    expect(() =>
      assertMatchOpenForSale(
        { homeTeam: HOME, kickoffAt: future, status: MatchStatus.ON_SALE },
        HOME,
      ),
    ).not.toThrow();
  });

  it('refuses a cancelled match with 409 match_cancelled and a Hungarian message', () => {
    try {
      assertMatchOpenForSale(
        { homeTeam: HOME, kickoffAt: future, status: MatchStatus.CANCELLED },
        HOME,
      );
      fail('expected the cancelled match to be refused');
    } catch (error) {
      expect(error).toMatchObject({
        status: 409,
        response: {
          code: 'match_cancelled',
          message: 'Ez a mérkőzés elmarad, ezért jegy nem vásárolható rá.',
        },
      });
    }
  });

  it('says cancelled, not started, when a cancelled match is also past kickoff', () => {
    expect(() =>
      assertMatchOpenForSale(
        { homeTeam: HOME, kickoffAt: past, status: MatchStatus.CANCELLED },
        HOME,
      ),
    ).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'match_cancelled' }) }),
    );
  });

  it('still refuses a match that has kicked off', () => {
    expect(() =>
      assertMatchOpenForSale(
        { homeTeam: HOME, kickoffAt: past, status: MatchStatus.ON_SALE },
        HOME,
      ),
    ).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'match_started' }) }),
    );
  });

  it('refuses an away match with 409 match_away, even when it is upcoming and on sale', () => {
    expect(() =>
      assertMatchOpenForSale(
        { homeTeam: 'Ferencváros', kickoffAt: future, status: MatchStatus.ON_SALE },
        HOME,
      ),
    ).toThrow(
      expect.objectContaining({
        status: 409,
        response: expect.objectContaining({ code: 'match_away' }),
      }),
    );
  });
});
