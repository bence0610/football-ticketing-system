import { LoyaltyTransactionSource, LoyaltyTransactionType } from '../../database/entities';
import { SeasonPassesService } from './season-passes.service';

/**
 * The season-pass points go to the pass HOLDER's account, not to whoever paid. A buyer who could
 * collect them could buy any number of passes for holders without an account (the one-pass-per-
 * holder rule only binds holders with one) and mint a tier: five passes are 2,500 points.
 */
describe('SeasonPassesService: who earns the season-pass points', () => {
  // The ledger's unique (source, reference) key and a balance per user, as the database has them.
  function setup() {
    const rows: Array<{ userId: string; points: number; referenceId: string; source: string }> = [];
    const award = jest.fn(
      async (o: { userId: string; points: number; referenceId: string; source: string }) => {
        rows.push({ ...o });
        return { duplicate: false };
      },
    );
    const service = Object.assign(Object.create(SeasonPassesService.prototype), {
      loyaltyService: { award },
      loyaltyConfig: { seasonPassPoints: 500 },
      logger: { error: jest.fn() },
    }) as SeasonPassesService;
    const give = (pass: Record<string, unknown>): Promise<void> =>
      (
        service as unknown as { awardSeasonPassLoyalty(p: unknown): Promise<void> }
      ).awardSeasonPassLoyalty(pass);
    const pointsOf = (userId: string): number =>
      rows.filter((r) => r.userId === userId).reduce((sum, r) => sum + r.points, 0);
    return { give, award, rows, pointsOf };
  }

  it('a pass bought for an account holder credits the holder, not the buyer', async () => {
    const { give, award, pointsOf } = setup();
    await give({ id: 'pass-1', userId: 'buyer', holderUserId: 'holder' });
    expect(award).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'holder',
        type: LoyaltyTransactionType.EARN,
        source: LoyaltyTransactionSource.SEASON_PASS_PURCHASE,
        points: 500,
        referenceId: 'season_pass:pass-1',
      }),
    );
    expect(pointsOf('holder')).toBe(500);
    expect(pointsOf('buyer')).toBe(0);
  });

  it('a pass for a name-only holder credits nobody', async () => {
    const { give, award } = setup();
    await give({ id: 'pass-2', userId: 'buyer', holderUserId: null, holderName: 'Kovács Bence' });
    expect(award).not.toHaveBeenCalled();
  });

  it('five passes for name-only holders leave the buyer’s points unchanged', async () => {
    const { give, award, pointsOf, rows } = setup();
    for (let i = 0; i < 5; i += 1) {
      await give({
        id: `pass-${i}`,
        userId: 'buyer',
        holderUserId: null,
        holderName: `Vendég ${i}`,
      });
    }
    expect(award).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(pointsOf('buyer')).toBe(0);
  });

  it('a pass the buyer holds themself credits them (they are the holder)', async () => {
    const { give, pointsOf } = setup();
    await give({ id: 'pass-own', userId: 'buyer', holderUserId: 'buyer' });
    expect(pointsOf('buyer')).toBe(500);
  });
});
