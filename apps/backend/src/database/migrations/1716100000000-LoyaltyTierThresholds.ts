import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tier thresholds came down (Ezüst 300, Arany 1,000, KTE Legenda 2,500; they were 500 / 1,500 /
 * 3,000) because loyalty now measures attendance and the most anyone earns is about 1,300 points a
 * season. The stored tier of an existing user was written under the old thresholds, so a user whose
 * points now reach a higher tier is RAISED to it, and stamped as reached now (the stamp
 * LoyaltyTierKept added, which keeps a tier through the next season-end conversion).
 *
 * Nobody is lowered: lower thresholds can only raise what the points give, and a kept tier above the
 * points stays as it is. No tier-upgrade e-mail is sent for this correction. The discounts are
 * unchanged.
 */
export class LoyaltyTierThresholds1716100000000 implements MigrationInterface {
  name = 'LoyaltyTierThresholds1716100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE \`users\`
      SET \`loyalty_tier\` = CASE
            WHEN \`loyalty_points\` >= 2500 THEN 'platinum'
            WHEN \`loyalty_points\` >= 1000 THEN 'gold'
            ELSE 'silver'
          END,
          \`loyalty_tier_reached_at\` = NOW()
      WHERE \`loyalty_points\` >= 300
        AND FIELD(\`loyalty_tier\`, 'bronze', 'silver', 'gold', 'platinum') <
            FIELD(CASE
                    WHEN \`loyalty_points\` >= 2500 THEN 'platinum'
                    WHEN \`loyalty_points\` >= 1000 THEN 'gold'
                    ELSE 'silver'
                  END, 'bronze', 'silver', 'gold', 'platinum')
    `);
  }

  public async down(): Promise<void> {
    // The raised tiers cannot be told apart from tiers earned honestly afterwards: nothing to undo.
  }
}
