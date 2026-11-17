import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Loyalty measures attendance, not spending: a user earns points the first time they enter a match
 * (a scanned ticket they bought, their own scanned pass entry, or a scanned borrowed entry), once
 * per user per match. The ledger source gains 'attendance'; its reference is
 * `match:<match id>:<user id>`, so the unique (source, reference_id) key enforces the once.
 *
 * Existing 'ticket_purchase' and 'pass_attendance' rows stay as history and are not rewritten.
 */
export class AttendanceLoyalty1716000000000 implements MigrationInterface {
  name = 'AttendanceLoyalty1716000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `loyalty_transactions` MODIFY COLUMN `source` enum('ticket_purchase','season_pass_purchase','promotion','reward_redeem','admin','profile_completion','pass_loan','season_carryover','registration','pass_attendance','attendance') NOT NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM `loyalty_transactions` WHERE `source` = 'attendance'");
    await queryRunner.query(
      "ALTER TABLE `loyalty_transactions` MODIFY COLUMN `source` enum('ticket_purchase','season_pass_purchase','promotion','reward_redeem','admin','profile_completion','pass_loan','season_carryover','registration','pass_attendance') NOT NULL",
    );
  }
}
