import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the 'gate' value to the users.role enum so gate operators can be
 * seeded and assigned roles. The down migration reassigns gate users to 'fan'
 * before removing the enum value to satisfy MySQL's constraint.
 */
export class AddGateRole1714800000000 implements MigrationInterface {
  name = 'AddGateRole1714800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      MODIFY COLUMN \`role\` enum('fan','gate','admin','super_admin') NOT NULL DEFAULT 'fan'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE \`users\` SET \`role\` = 'fan' WHERE \`role\` = 'gate'
    `);
    await queryRunner.query(`
      ALTER TABLE \`users\`
      MODIFY COLUMN \`role\` enum('fan','admin','super_admin') NOT NULL DEFAULT 'fan'
    `);
  }
}
