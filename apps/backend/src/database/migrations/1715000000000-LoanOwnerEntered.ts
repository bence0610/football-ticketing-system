import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds pass_loans.status 'owner_entered'. acceptLoan used to store 'revoked'
 * when the owner had already entered the stadium, which is not a revocation.
 * Existing rows that were set for that reason (identified by the reason text
 * acceptLoan wrote) are converted; the down migration maps them back.
 */
export class LoanOwnerEntered1715000000000 implements MigrationInterface {
  name = 'LoanOwnerEntered1715000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`pass_loans\`
      MODIFY COLUMN \`status\` enum('pending','accepted','revoked','owner_entered','expired','used','cancelled','completed') NOT NULL DEFAULT 'pending'
    `);
    await queryRunner.query(`
      UPDATE \`pass_loans\` SET \`status\` = 'owner_entered'
      WHERE \`status\` = 'revoked' AND \`cancellation_reason\` = 'Owner already entered the stadium for this match'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`pass_loans\` SET \`status\` = 'revoked' WHERE \`status\` = 'owner_entered'`,
    );
    await queryRunner.query(`
      ALTER TABLE \`pass_loans\`
      MODIFY COLUMN \`status\` enum('pending','accepted','revoked','expired','used','cancelled','completed') NOT NULL DEFAULT 'pending'
    `);
  }
}
