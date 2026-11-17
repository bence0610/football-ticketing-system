import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A loyalty tier reached during a season is kept until the end of the next season, so the tier is
 * stored together with when it was reached instead of being derived from the points alone.
 *
 *  - users.loyalty_tier_reached_at: when the stored tier was reached (null: held by points alone).
 *    Existing users above the entry tier are stamped with the migration time, so a tier they hold
 *    today gets the same protection as one reached after this change.
 *  - loyalty_transactions.source gains 'pass_attendance': the points a season-pass entry earns
 *    when it is scanned at the gate.
 *
 * The stored enum values of the tiers are unchanged.
 */
export class LoyaltyTierKept1715900000000 implements MigrationInterface {
  name = 'LoyaltyTierKept1715900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `users` ADD COLUMN `loyalty_tier_reached_at` timestamp NULL DEFAULT NULL AFTER `loyalty_tier`',
    );
    await queryRunner.query(
      "UPDATE `users` SET `loyalty_tier_reached_at` = NOW() WHERE `loyalty_tier` <> 'bronze'",
    );
    await queryRunner.query(
      "ALTER TABLE `loyalty_transactions` MODIFY COLUMN `source` enum('ticket_purchase','season_pass_purchase','promotion','reward_redeem','admin','profile_completion','pass_loan','season_carryover','registration','pass_attendance') NOT NULL",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `loyalty_transactions` WHERE `source` = 'pass_attendance'",
    );
    await queryRunner.query(
      "ALTER TABLE `loyalty_transactions` MODIFY COLUMN `source` enum('ticket_purchase','season_pass_purchase','promotion','reward_redeem','admin','profile_completion','pass_loan','season_carryover','registration') NOT NULL",
    );
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `loyalty_tier_reached_at`');
  }
}
