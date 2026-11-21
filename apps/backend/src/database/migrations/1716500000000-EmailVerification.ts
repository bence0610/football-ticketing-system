import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * E-mail verification at registration. One row per emailed link (only the token's hash is stored,
 * see EmailVerificationToken); rows go with the user.
 *
 * Every account that exists when this runs counts as verified: the demo accounts, the seeded
 * staff accounts and everybody who registered before verification existed. Only accounts created
 * afterwards start unverified (`email_verified` was always stored, as false, and never read).
 */
export class EmailVerification1716500000000 implements MigrationInterface {
  name = 'EmailVerification1716500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`email_verification_tokens\` (
        \`id\` varchar(36) NOT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        \`version\` int NOT NULL DEFAULT 1,
        \`user_id\` varchar(36) NOT NULL,
        \`token_hash\` varchar(64) NOT NULL,
        \`email\` varchar(255) NOT NULL,
        \`expires_at\` timestamp NOT NULL,
        \`used_at\` timestamp NULL,
        UNIQUE INDEX \`IDX_email_verification_tokens_hash\` (\`token_hash\`),
        INDEX \`idx_email_verification_tokens_user\` (\`user_id\`),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_email_verification_tokens_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query('UPDATE `users` SET `email_verified` = 1 WHERE `email_verified` = 0');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `email_verification_tokens`');
  }
}
