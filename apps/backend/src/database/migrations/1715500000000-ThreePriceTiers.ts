import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Four price tiers (vip / premium / standard / economy) become three: the whole
 * upper arc (`upper`), the whole lower arc except VIP (`lower`) and `vip`. The
 * away section has no tier (NULL): it has no price.
 *
 * Unlike the layout migration this one keeps tickets, passes and loans: no seat
 * moves, only what a seat costs. Tickets keep the price they were paid at.
 *
 * Seat modifiers and categories are rewritten to match (the values are written
 * out here and not imported, so the migration never changes when the layout
 * file does; a spec checks the two agree). Season pass prices are now one row
 * per tier, keyed by the tier in `section`: the 18 per-sector rows are removed
 * and the seed writes the three new ones. Passes already issued reference
 * their seat, not a price row, so they are untouched.
 */
export class ThreePriceTiers1715500000000 implements MigrationInterface {
  name = 'ThreePriceTiers1715500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `sectors` DROP CONSTRAINT `chk_sectors_price_category`',
    );
    await queryRunner.query(
      'ALTER TABLE `sectors` MODIFY COLUMN `price_category` varchar(16) NULL',
    );
    await queryRunner.query(`
      UPDATE \`sectors\` SET \`price_category\` = CASE
        WHEN \`is_away\` = 1 THEN NULL
        WHEN \`code\` = 'VIP' THEN 'vip'
        WHEN \`arc\` = 'upper' THEN 'upper'
        ELSE 'lower'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE \`sectors\`
        ADD CONSTRAINT \`chk_sectors_price_category\` CHECK (
          (\`is_away\` = 1 AND \`price_category\` IS NULL)
          OR (\`is_away\` = 0 AND \`price_category\` IN ('vip', 'upper', 'lower'))
        )
    `);

    await queryRunner.query(`
      UPDATE \`seats\` s JOIN \`sectors\` c ON c.\`code\` = s.\`section\`
      SET s.\`price_modifier\` = CASE c.\`price_category\`
            WHEN 'vip' THEN 2.50
            WHEN 'lower' THEN 1.40
            WHEN 'upper' THEN 1.00
            ELSE 1.00
          END,
          s.\`category\` = IF(c.\`price_category\` = 'vip', 'vip', 'standard')
    `);

    await queryRunner.query('DELETE FROM `season_pass_prices`');
  }

  /**
   * Back to the four tiers, from the per-sector table of the layout migration.
   * Season pass prices are removed again; the (old) seed rewrites them.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `sectors` DROP CONSTRAINT `chk_sectors_price_category`',
    );
    await queryRunner.query(`
      UPDATE \`sectors\` SET \`price_category\` = CASE \`code\`
        WHEN 'D/1' THEN 'economy' WHEN 'D/2' THEN 'standard' WHEN 'C/1' THEN 'standard'
        WHEN 'C/2' THEN 'premium' WHEN 'B/1' THEN 'premium' WHEN 'B/2' THEN 'standard'
        WHEN 'A/1' THEN 'standard' WHEN 'A/2' THEN 'economy' WHEN 'VENDÉG' THEN 'standard'
        WHEN 'N' THEN 'economy' WHEN 'M' THEN 'economy' WHEN 'L' THEN 'standard'
        WHEN 'K' THEN 'standard' WHEN 'J' THEN 'premium' WHEN 'VIP' THEN 'vip'
        WHEN 'H' THEN 'premium' WHEN 'G' THEN 'standard' WHEN 'F' THEN 'standard'
        WHEN 'E' THEN 'economy'
        ELSE 'standard'
      END
    `);
    await queryRunner.query(
      'ALTER TABLE `sectors` MODIFY COLUMN `price_category` varchar(16) NOT NULL',
    );
    await queryRunner.query(`
      ALTER TABLE \`sectors\`
        ADD CONSTRAINT \`chk_sectors_price_category\`
          CHECK (\`price_category\` IN ('vip', 'premium', 'standard', 'economy'))
    `);
    await queryRunner.query(`
      UPDATE \`seats\` s JOIN \`sectors\` c ON c.\`code\` = s.\`section\`
      SET s.\`price_modifier\` = CASE c.\`price_category\`
            WHEN 'vip' THEN 2.50 WHEN 'premium' THEN 1.50
            WHEN 'standard' THEN 1.00 ELSE 0.80
          END,
          s.\`category\` = CASE c.\`price_category\`
            WHEN 'vip' THEN 'vip' WHEN 'premium' THEN 'premium' ELSE 'standard'
          END
    `);
    await queryRunner.query('DELETE FROM `season_pass_prices`');
  }
}
