import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A match's `capacity` is what it can sell: the active seats outside the away section.
 * The seed used to write every active seat (5,468), so the 280 away seats, which the portal
 * never sells, kept `capacity - sold` at 280 for a match that had sold everything it could.
 *
 * Only matches that carry the old whole-stadium count are corrected; a match with another
 * value (an away match at 0, a hand-set figure) is left alone.
 */
export class MatchCapacitySellable1715800000000 implements MigrationInterface {
  name = 'MatchCapacitySellable1715800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE \`matches\`
      SET \`capacity\` = (
        SELECT COUNT(*) FROM \`seats\` s JOIN \`sectors\` c ON c.\`code\` = s.\`section\`
        WHERE s.\`is_active\` = 1 AND c.\`is_away\` = 0
      )
      WHERE \`capacity\` = (SELECT COUNT(*) FROM \`seats\` WHERE \`is_active\` = 1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE \`matches\`
      SET \`capacity\` = (SELECT COUNT(*) FROM \`seats\` WHERE \`is_active\` = 1)
      WHERE \`capacity\` = (
        SELECT COUNT(*) FROM \`seats\` s JOIN \`sectors\` c ON c.\`code\` = s.\`section\`
        WHERE s.\`is_active\` = 1 AND c.\`is_away\` = 0
      )
    `);
  }
}
