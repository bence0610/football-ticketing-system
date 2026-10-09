import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Iteration 4 schema additions:
 *  - tickets: qr_jti, confirmation_email_sent_at, expired_at, scanned_at, scanned_by_user_id, EXPIRED status, idx_tickets_match_status
 *  - loyalty_transactions: extended source enum (profile_completion, pass_loan, season_carryover, registration), unique (source, reference_id)
 *  - pass_loans: qr_jti, qr_revoked_at, cancelled_at, cancellation_reason, completed_at, CANCELLED & COMPLETED statuses, idx_pass_loans_status_match
 *  - users: profile_completed_at
 */
export class Iteration4Schema1714400000000 implements MigrationInterface {
  name = 'Iteration4Schema1714400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // -------------------- users --------------------
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD COLUMN \`profile_completed_at\` timestamp NULL AFTER \`last_login_at\`
    `);

    // -------------------- tickets --------------------
    await queryRunner.query(`
      ALTER TABLE \`tickets\`
      MODIFY COLUMN \`status\` enum('pending_payment','paid','cancelled','refunded','used','expired') NOT NULL DEFAULT 'pending_payment'
    `);
    await queryRunner.query(`
      ALTER TABLE \`tickets\`
      ADD COLUMN \`qr_jti\` varchar(36) NULL AFTER \`qr_code\`,
      ADD COLUMN \`scanned_at\` timestamp NULL AFTER \`used_at\`,
      ADD COLUMN \`scanned_by_user_id\` varchar(36) NULL AFTER \`scanned_at\`,
      ADD COLUMN \`expired_at\` timestamp NULL AFTER \`scanned_by_user_id\`,
      ADD COLUMN \`confirmation_email_sent_at\` timestamp NULL AFTER \`expired_at\`
    `);
    // Backfill qr_jti for existing rows so the unique constraint can be enforced.
    await queryRunner.query(`UPDATE \`tickets\` SET \`qr_jti\` = UUID() WHERE \`qr_jti\` IS NULL`);
    await queryRunner.query(
      `ALTER TABLE \`tickets\` MODIFY COLUMN \`qr_jti\` varchar(36) NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`uq_tickets_qr_jti\` ON \`tickets\` (\`qr_jti\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`idx_tickets_match_status\` ON \`tickets\` (\`match_id\`, \`status\`)`,
    );

    // -------------------- loyalty_transactions --------------------
    await queryRunner.query(`
      ALTER TABLE \`loyalty_transactions\`
      MODIFY COLUMN \`source\` enum('ticket_purchase','season_pass_purchase','promotion','reward_redeem','admin','profile_completion','pass_loan','season_carryover','registration') NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE \`loyalty_transactions\`
      MODIFY COLUMN \`reference_id\` varchar(191) NULL
    `);
    // MySQL allows multiple NULLs in a unique index so this still permits adjustments without reference IDs.
    await queryRunner.query(`
      CREATE UNIQUE INDEX \`uq_loyalty_source_reference\` ON \`loyalty_transactions\` (\`source\`, \`reference_id\`)
    `);

    // -------------------- pass_loans --------------------
    await queryRunner.query(`
      ALTER TABLE \`pass_loans\`
      MODIFY COLUMN \`status\` enum('pending','accepted','revoked','expired','used','cancelled','completed') NOT NULL DEFAULT 'pending'
    `);
    await queryRunner.query(`
      ALTER TABLE \`pass_loans\`
      ADD COLUMN \`qr_jti\` varchar(36) NULL AFTER \`accepted_at\`,
      ADD COLUMN \`qr_revoked_at\` timestamp NULL AFTER \`qr_jti\`,
      ADD COLUMN \`cancelled_at\` timestamp NULL AFTER \`qr_revoked_at\`,
      ADD COLUMN \`cancellation_reason\` varchar(255) NULL AFTER \`cancelled_at\`,
      ADD COLUMN \`completed_at\` timestamp NULL AFTER \`cancellation_reason\`
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX \`uq_pass_loans_qr_jti\` ON \`pass_loans\` (\`qr_jti\`)`,
    );
    await queryRunner.query(
      `CREATE INDEX \`idx_pass_loans_status_match\` ON \`pass_loans\` (\`status\`, \`match_id\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // pass_loans
    await queryRunner.query(`DROP INDEX \`idx_pass_loans_status_match\` ON \`pass_loans\``);
    await queryRunner.query(`DROP INDEX \`uq_pass_loans_qr_jti\` ON \`pass_loans\``);
    await queryRunner.query(`
      ALTER TABLE \`pass_loans\`
      DROP COLUMN \`completed_at\`,
      DROP COLUMN \`cancellation_reason\`,
      DROP COLUMN \`cancelled_at\`,
      DROP COLUMN \`qr_revoked_at\`,
      DROP COLUMN \`qr_jti\`
    `);
    await queryRunner.query(`
      ALTER TABLE \`pass_loans\`
      MODIFY COLUMN \`status\` enum('pending','accepted','revoked','expired','used') NOT NULL DEFAULT 'pending'
    `);

    // loyalty_transactions
    await queryRunner.query(
      `DROP INDEX \`uq_loyalty_source_reference\` ON \`loyalty_transactions\``,
    );
    await queryRunner.query(`
      ALTER TABLE \`loyalty_transactions\`
      MODIFY COLUMN \`reference_id\` varchar(36) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE \`loyalty_transactions\`
      MODIFY COLUMN \`source\` enum('ticket_purchase','season_pass_purchase','promotion','reward_redeem','admin') NOT NULL
    `);

    // tickets
    await queryRunner.query(`DROP INDEX \`idx_tickets_match_status\` ON \`tickets\``);
    await queryRunner.query(`DROP INDEX \`uq_tickets_qr_jti\` ON \`tickets\``);
    await queryRunner.query(`
      ALTER TABLE \`tickets\`
      DROP COLUMN \`confirmation_email_sent_at\`,
      DROP COLUMN \`expired_at\`,
      DROP COLUMN \`scanned_by_user_id\`,
      DROP COLUMN \`scanned_at\`,
      DROP COLUMN \`qr_jti\`
    `);
    await queryRunner.query(`
      ALTER TABLE \`tickets\`
      MODIFY COLUMN \`status\` enum('pending_payment','paid','cancelled','refunded','used') NOT NULL DEFAULT 'pending_payment'
    `);

    // users
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`profile_completed_at\``);
  }
}
