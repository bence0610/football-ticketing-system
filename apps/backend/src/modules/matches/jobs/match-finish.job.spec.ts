import { MatchStatus } from '../../../database/entities';
import { MatchFinishJob, PRE_MATCH_STATUSES } from './match-finish.job';

describe('MatchFinishJob', () => {
  const NOW = new Date('2026-11-17T12:00:00Z');

  function job(delayHours = 6, affected = 2) {
    const update = jest.fn().mockResolvedValue({ affected });
    const repo = { update } as never;
    const config = { getOrThrow: () => ({ matchFinishDelayHours: delayHours }) } as never;
    return { job: new MatchFinishJob(repo, config), update };
  }

  it('marks matches whose kickoff is more than the delay ago, and only those not yet played', async () => {
    const { job: j, update } = job();
    expect(await j.run(NOW)).toBe(2);

    const [where, set] = update.mock.calls[0];
    // 6 hours before NOW: a match that kicked off at 06:00 or earlier is over
    const bound = (where.kickoffAt as { value: Date }).value;
    expect(bound.toISOString()).toBe('2026-11-17T06:00:00.000Z');
    expect(set).toEqual({ status: MatchStatus.FINISHED });
    // scheduled, on_sale and sold_out only: a cancelled or postponed match keeps its status
    expect((where.status as { value: MatchStatus[] }).value).toEqual([...PRE_MATCH_STATUSES]);
    expect(PRE_MATCH_STATUSES).not.toContain(MatchStatus.CANCELLED);
    expect(PRE_MATCH_STATUSES).not.toContain(MatchStatus.POSTPONED);
  });

  it('uses the configured delay', async () => {
    const { job: j, update } = job(3);
    await j.run(NOW);
    const bound = (update.mock.calls[0][0].kickoffAt as { value: Date }).value;
    expect(bound.toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });

  it('reports 0 when nothing was due', async () => {
    const { job: j } = job(6, 0);
    expect(await j.run(NOW)).toBe(0);
  });

  it('a failing run is logged, not thrown out of the cron callback', async () => {
    const { job: j, update } = job();
    update.mockRejectedValue(new Error('db down'));
    await expect(j.handle()).resolves.toBeUndefined();
  });
});
