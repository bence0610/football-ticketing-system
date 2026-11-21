import { readFileSync } from 'fs';
import { join } from 'path';
import { ActiveSeasonService, pickActiveSeason } from './active-season.service';

const row = (seasonLabel: string, from: string, until: string) => ({
  seasonLabel,
  validFrom: new Date(from),
  validUntil: new Date(until),
});

describe('the active season (one source: the active season_pass_prices rows)', () => {
  const current = row('2026/2027', '2026-07-01', '2027-06-30');
  const next = row('2027/2028', '2027-07-01', '2028-06-30');

  it('is null when no price row is active', () => {
    expect(pickActiveSeason([])).toBeNull();
  });

  it('is the season of the active rows, with its period', () => {
    expect(pickActiveSeason([current, { ...current }])).toEqual({
      label: '2026/2027',
      validFrom: new Date('2026-07-01'),
      validUntil: new Date('2027-06-30'),
    });
  });

  it('takes the NEWER season when two seasons are active at once, whatever the row order', () => {
    expect(pickActiveSeason([current, next])?.label).toBe('2027/2028');
    expect(pickActiveSeason([next, current])?.label).toBe('2027/2028');
    expect(pickActiveSeason([current, next, { ...next }, { ...current }])?.label).toBe('2027/2028');
  });

  it('breaks a tie on the end date by the later start, then the later label', () => {
    expect(
      pickActiveSeason([row('A', '2026-07-01', '2027-06-30'), row('B', '2026-08-01', '2027-06-30')])
        ?.label,
    ).toBe('B');
    expect(
      pickActiveSeason([
        row('2026/2027', '2026-07-01', '2027-06-30'),
        row('2026/2027b', '2026-07-01', '2027-06-30'),
      ])?.label,
    ).toBe('2026/2027b');
  });

  it('does not carry a label in the code: a season that is not 2026/2027 is picked as it is', () => {
    expect(pickActiveSeason([row('2031/2032', '2031-07-01', '2032-06-30')])?.label).toBe(
      '2031/2032',
    );
  });

  it('the service reads only the active rows and returns the label', async () => {
    const find = jest.fn(async () => [current, next]);
    const service = new ActiveSeasonService({ find } as never);
    expect(await service.label()).toBe('2027/2028');
    expect(find).toHaveBeenCalledWith({ where: { isActive: true } });
    const none = new ActiveSeasonService({ find: async () => [] } as never);
    expect(await none.label()).toBeNull();
    expect(await none.current()).toBeNull();
  });
});

describe('no hard-coded active season label remains in the pass code', () => {
  it('the services do not define ACTIVE_SEASON_LABEL or a season literal', () => {
    const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
    expect(read('season-passes.service.ts')).not.toContain('ACTIVE_SEASON_LABEL');
    expect(read('../admin/admin-overview.service.ts')).not.toContain('ACTIVE_SEASON_LABEL');
    expect(read('season-passes.service.ts')).not.toMatch(/'2026\/2027'/);
  });
});
