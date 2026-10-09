import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Iteration 5 schema additions:
 *  - waitlist: composite index (match_id, status, created_at) for FIFO queue selection,
 *              plus an index on notified_at for cron-based reaping.
 */
export class Iteration5Schema1714600000000 implements MigrationInterface {
  name = 'Iteration5Schema1714600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX \`idx_waitlist_match_status_created\` ON \`waitlist\` (\`match_id\`, \`status\`, \`created_at\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`idx_waitlist_notified_at\` ON \`waitlist\` (\`notified_at\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`idx_waitlist_notified_at\` ON \`waitlist\``);
    await queryRunner.query(`DROP INDEX \`idx_waitlist_match_status_created\` ON \`waitlist\``);
  }
}
