import { Competition, Match } from './match.entity';

function build(competition: Competition, homeTeam: string, flag?: boolean): Match {
  const m = new Match();
  m.competition = competition;
  m.homeTeam = homeTeam;
  m.awayTeam = homeTeam === 'Kecskeméti TE' ? 'Teszt FC' : 'Kecskeméti TE';
  if (flag !== undefined) m.isSeasonPassEligible = flag;
  m.decidePassEligibility();
  return m;
}

describe('Match insert hook: the pass cover is decided from the match', () => {
  const OLD = process.env.HOME_TEAM_NAME;
  beforeAll(() => delete process.env.HOME_TEAM_NAME);
  afterAll(() => {
    if (OLD !== undefined) process.env.HOME_TEAM_NAME = OLD;
  });

  it('covers a home cup tie and a home league match', () => {
    expect(build(Competition.MAGYAR_KUPA, 'Kecskeméti TE').isSeasonPassEligible).toBe(true);
    expect(build(Competition.NB2, 'Kecskeméti TE').isSeasonPassEligible).toBe(true);
  });

  it('leaves a friendly and an away match uncovered', () => {
    expect(build(Competition.FRIENDLY, 'Kecskeméti TE').isSeasonPassEligible).toBe(false);
    expect(build(Competition.MAGYAR_KUPA, 'Újpest FC').isSeasonPassEligible).toBe(false);
    expect(build(Competition.NB2, 'Újpest FC').isSeasonPassEligible).toBe(false);
  });

  it('keeps an explicit value', () => {
    expect(build(Competition.FRIENDLY, 'Kecskeméti TE', true).isSeasonPassEligible).toBe(true);
    expect(build(Competition.NB2, 'Kecskeméti TE', false).isSeasonPassEligible).toBe(false);
  });
});
