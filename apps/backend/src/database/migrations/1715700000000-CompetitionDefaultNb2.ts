import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kecskeméti TE plays in the NB II, so a match created without a competition now
 * defaults to `NB2` (it was `NB1`).
 *
 * Why a migration and not only the entity: TypeORM leaves an undefined property out of
 * the INSERT, so it is MySQL's column default that fills it in. Changing
 * `Match.competition`'s `default` alone would change nothing at runtime and would make
 * `migration:generate` see drift. The two defaults have to move together.
 *
 * Only the default changes. The enum keeps all four values (a match can still be
 * `NB1`, `magyar_kupa` or `friendly`) and no existing row is touched.
 */
export class CompetitionDefaultNb21715700000000 implements MigrationInterface {
  name = 'CompetitionDefaultNb21715700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `matches` MODIFY COLUMN `competition` enum('NB1','NB2','magyar_kupa','friendly') NOT NULL DEFAULT 'NB2'",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `matches` MODIFY COLUMN `competition` enum('NB1','NB2','magyar_kupa','friendly') NOT NULL DEFAULT 'NB1'",
    );
  }
}
