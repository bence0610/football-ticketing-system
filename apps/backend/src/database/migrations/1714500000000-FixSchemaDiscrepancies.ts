import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fix schema discrepancies surfaced by the database audit:
 *  - W1: drop redundant orphaned unique index `IDX_users_email_unique` on `users.email`
 *        (the entity-owned `idx_users_email` already enforces uniqueness).
 *  - I1: add the missing FK `fk_tickets_scanned_by` on `tickets.scanned_by_user_id`
 *        referencing `users.id` ON DELETE SET NULL.
 */
export class FixSchemaDiscrepancies1714500000000 implements MigrationInterface {
  name = 'FixSchemaDiscrepancies1714500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // W1: drop the orphaned duplicate unique index on users.email
    await queryRunner.query(`DROP INDEX \`IDX_users_email_unique\` ON \`users\``);

    // I1: add foreign key for tickets.scanned_by_user_id -> users.id
    await queryRunner.query(`
      ALTER TABLE \`tickets\`
      ADD CONSTRAINT \`fk_tickets_scanned_by\`
      FOREIGN KEY (\`scanned_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse I1: drop the FK
    await queryRunner.query(`ALTER TABLE \`tickets\` DROP FOREIGN KEY \`fk_tickets_scanned_by\``);

    // Reverse W1: re-create the orphaned unique index
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_users_email_unique\` ON \`users\` (\`email\`)`,
    );
  }
}
