import { MatchStatus } from '../../database/entities';
import { assertMatchOpenForSale } from './match-sale';

describe('assertMatchOpenForSale', () => {
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 60_000);

  it('lets an upcoming on-sale match through', () => {
    expect(() =>
      assertMatchOpenForSale({ kickoffAt: future, status: MatchStatus.ON_SALE }),
    ).not.toThrow();
  });

  it('refuses a cancelled match with 409 match_cancelled and a Hungarian message', () => {
    try {
      assertMatchOpenForSale({ kickoffAt: future, status: MatchStatus.CANCELLED });
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
      assertMatchOpenForSale({ kickoffAt: past, status: MatchStatus.CANCELLED }),
    ).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'match_cancelled' }) }),
    );
  });

  it('still refuses a match that has kicked off', () => {
    expect(() => assertMatchOpenForSale({ kickoffAt: past, status: MatchStatus.ON_SALE })).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'match_started' }) }),
    );
  });
});
