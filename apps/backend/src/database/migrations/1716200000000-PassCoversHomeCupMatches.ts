import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A season pass now covers every home match of the season in the league AND the Magyar Kupa
 * (friendlies stay out). Existing home cup matches carry `is_season_pass_eligible = 0` from the
 * old rule, so they are switched on here. (New matches decide the flag themselves: see
 * `isPassEligibleMatch` and the Match entity's insert hook.)
 *
 * One case is left alone on purpose: a cup match where a single ticket (pending, paid or used)
 * already sits on a seat that has a season pass. Covering that match would put two valid entries
 * on one seat, and which of the two holders keeps it is a decision for a person, not a script. Those
 * matches are listed in the log and stay uncovered until someone has settled the tickets.
 *
 * The club is `HOME_TEAM_NAME` (default 'Kecskeméti TE'), the same setting the application uses.
 */
export class PassCoversHomeCupMatches1716200000000 implements MigrationInterface {
  name = 'PassCoversHomeCupMatches1716200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const home = process.env.HOME_TEAM_NAME ?? 'Kecskeméti TE';

    const conflicts: Array<{ id: string }> = await queryRunner.query(
      `SELECT DISTINCT m.id AS id
         FROM matches m
         JOIN tickets t ON t.match_id = m.id
          AND t.status IN ('pending_payment', 'paid', 'used')
          AND t.source = 'single'
         JOIN season_passes sp ON sp.seat_id = t.seat_id
        WHERE m.competition = 'magyar_kupa'
          AND m.home_team = ?
          AND m.is_season_pass_eligible = 0
          AND m.status <> 'cancelled'
          AND m.kickoff_at >= sp.valid_from
          AND m.kickoff_at < DATE_ADD(sp.valid_until, INTERVAL 1 DAY)`,
      [home],
    );
    const skip = conflicts.map((c) => c.id);

    await queryRunner.query(
      `UPDATE matches
          SET is_season_pass_eligible = 1
        WHERE competition = 'magyar_kupa'
          AND home_team = ?
          AND is_season_pass_eligible = 0
          ${skip.length > 0 ? `AND id NOT IN (${skip.map(() => '?').join(', ')})` : ''}`,
      [home, ...skip],
    );

    if (skip.length > 0) {
      console.warn(
        `PassCoversHomeCupMatches: ${skip.length} home cup match(es) NOT switched on because a ` +
          `single ticket already sits on a season-pass seat: ${skip.join(', ')}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const home = process.env.HOME_TEAM_NAME ?? 'Kecskeméti TE';
    await queryRunner.query(
      `UPDATE matches SET is_season_pass_eligible = 0 WHERE competition = 'magyar_kupa' AND home_team = ?`,
      [home],
    );
  }
}
