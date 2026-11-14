import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * E-mail change: one row per confirmation link sent to the requested new
 * address. Only the token's hash is stored (see EmailChangeToken). Rows go with
 * the user (ON DELETE CASCADE).
 */
export class EmailChangeTokens1715600000000 implements MigrationInterface {
  name = 'EmailChangeTokens1715600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`email_change_tokens\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`version\` int NOT NULL DEFAULT 1,
        \`user_id\` varchar(36) NOT NULL,
        \`new_email\` varchar(255) NOT NULL,
        \`token_hash\` varchar(64) NOT NULL,
        \`password_fingerprint\` varchar(64) NOT NULL,
        \`expires_at\` timestamp NOT NULL,
        \`used_at\` timestamp NULL,
        UNIQUE INDEX \`IDX_email_change_tokens_hash\` (\`token_hash\`),
        INDEX \`idx_email_change_tokens_user\` (\`user_id\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_email_change_tokens_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`email_change_tokens\``);
  }
}
