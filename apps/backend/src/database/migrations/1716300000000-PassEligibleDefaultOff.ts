import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `is_season_pass_eligible` defaulted to 1, so a match inserted without the Match entity (raw SQL)
 * was covered by every pass even when it was a friendly or an away match. The default is now 0:
 * the safe failure is "not covered". Matches created through the application get the right value
 * from the entity's insert hook (isPassEligibleMatch). Existing rows keep their value.
 */
export class PassEligibleDefaultOff1716300000000 implements MigrationInterface {
  name = 'PassEligibleDefaultOff1716300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `matches` MODIFY COLUMN `is_season_pass_eligible` tinyint NOT NULL DEFAULT 0',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `matches` MODIFY COLUMN `is_season_pass_eligible` tinyint NOT NULL DEFAULT 1',
    );
  }
}
