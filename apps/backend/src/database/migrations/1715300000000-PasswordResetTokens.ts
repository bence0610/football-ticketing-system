import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Password reset: one row per emailed link. Only the token's hash is stored
 * (see PasswordResetToken). Rows go with the user (ON DELETE CASCADE).
 */
export class PasswordResetTokens1715300000000 implements MigrationInterface {
  name = 'PasswordResetTokens1715300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`password_reset_tokens\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`version\` int NOT NULL DEFAULT 1,
        \`user_id\` varchar(36) NOT NULL,
        \`token_hash\` varchar(64) NOT NULL,
        \`password_fingerprint\` varchar(64) NOT NULL,
        \`expires_at\` timestamp NOT NULL,
        \`used_at\` timestamp NULL,
        UNIQUE INDEX \`IDX_password_reset_tokens_hash\` (\`token_hash\`),
        INDEX \`idx_password_reset_tokens_user\` (\`user_id\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_password_reset_tokens_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`password_reset_tokens\``);
  }
}
