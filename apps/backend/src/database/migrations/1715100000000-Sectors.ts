import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `sectors` reference table with an `is_covered` flag, replacing the
 * "VIP is the only covered sector" assumption that was hard-coded in the
 * clients. In the stadium VIP and B are under a roof; A and C are open.
 *
 * Rows are keyed by the same code `seats.section` carries. Only the four
 * stadium sectors are inserted; a seat whose section has no row simply has no
 * coverage information, and nothing claims coverage for it.
 */
export class Sectors1715100000000 implements MigrationInterface {
  name = 'Sectors1715100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`sectors\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`version\` int NOT NULL DEFAULT 1,
        \`code\` varchar(32) NOT NULL,
        \`name\` varchar(128) NOT NULL,
        \`is_covered\` tinyint(1) NOT NULL DEFAULT 0,
        UNIQUE INDEX \`uq_sectors_code\` (\`code\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      INSERT INTO \`sectors\` (\`id\`, \`code\`, \`name\`, \`is_covered\`) VALUES
        (UUID(), 'A',   'A szektor',   0),
        (UUID(), 'B',   'B szektor',   1),
        (UUID(), 'C',   'C szektor',   0),
        (UUID(), 'VIP', 'VIP szektor', 1)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`sectors\``);
  }
}
