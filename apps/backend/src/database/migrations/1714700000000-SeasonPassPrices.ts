import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `season_pass_prices` catalogue table consumed by the
 * SeasonPassesModule purchase flow. One row per (section, seasonLabel).
 */
export class SeasonPassPrices1714700000000 implements MigrationInterface {
  name = 'SeasonPassPrices1714700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`season_pass_prices\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`version\` int NOT NULL DEFAULT 1,
        \`section\` varchar(32) NOT NULL,
        \`section_label\` varchar(128) NOT NULL,
        \`season_label\` varchar(32) NOT NULL,
        \`price\` int UNSIGNED NOT NULL,
        \`currency\` varchar(8) NOT NULL DEFAULT 'HUF',
        \`valid_from\` date NOT NULL,
        \`valid_until\` date NOT NULL,
        \`is_active\` tinyint(1) NOT NULL DEFAULT 1,
        UNIQUE INDEX \`uq_season_pass_prices_section_season\` (\`section\`, \`season_label\`),
        INDEX \`idx_season_pass_prices_season\` (\`season_label\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`season_pass_prices\``);
  }
}
