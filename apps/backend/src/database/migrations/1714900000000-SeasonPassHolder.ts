import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separates the BUYER of a season pass (`user_id`) from its HOLDER (the person
 * who occupies the seat): adds `holder_name` (always set) and `holder_user_id`
 * (optional link to an account), and adds the two physical rules as database
 * constraints:
 *   - uq_season_passes_seat_season   one pass per seat per season
 *   - uq_season_passes_holder_season an account holds at most one pass per season
 *
 * Existing passes are migrated with the buyer as holder. If a buyer already
 * owns several passes in one season, only the oldest one is linked to the
 * buyer's account; the rest keep the buyer's name but no account link (the
 * holder unique index would otherwise reject the migration).
 */
export class SeasonPassHolder1714900000000 implements MigrationInterface {
  name = 'SeasonPassHolder1714900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dupSeats: Array<{ seat_id: string; season_label: string }> = await queryRunner.query(`
      SELECT seat_id, season_label FROM season_passes
      WHERE seat_id IS NOT NULL
      GROUP BY seat_id, season_label HAVING COUNT(*) > 1
    `);
    if (dupSeats.length > 0) {
      throw new Error(
        `Cannot add uq_season_passes_seat_season: seat sold twice for the same season ` +
          `(${dupSeats.map((d) => `${d.seat_id}/${d.season_label}`).join(', ')}). Resolve manually.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE \`season_passes\`
        ADD COLUMN \`holder_name\` varchar(120) NULL AFTER \`user_id\`,
        ADD COLUMN \`holder_user_id\` varchar(36) NULL AFTER \`holder_name\`
    `);

    await queryRunner.query(`
      UPDATE \`season_passes\` sp
      JOIN \`users\` u ON u.id = sp.user_id
      SET sp.holder_name = TRIM(CONCAT(u.first_name, ' ', u.last_name))
    `);
    // Link the buyer as holder for the oldest pass per (buyer, season) only.
    await queryRunner.query(`
      UPDATE \`season_passes\` sp
      JOIN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (
            PARTITION BY user_id, season_label ORDER BY created_at, id
          ) AS rn
          FROM season_passes
        ) ranked WHERE ranked.rn = 1
      ) first_pass ON first_pass.id = sp.id
      SET sp.holder_user_id = sp.user_id
    `);

    await queryRunner.query(`
      ALTER TABLE \`season_passes\`
        MODIFY COLUMN \`holder_name\` varchar(120) NOT NULL,
        ADD UNIQUE INDEX \`uq_season_passes_seat_season\` (\`seat_id\`, \`season_label\`),
        ADD UNIQUE INDEX \`uq_season_passes_holder_season\` (\`holder_user_id\`, \`season_label\`),
        ADD CONSTRAINT \`fk_season_passes_holder\` FOREIGN KEY (\`holder_user_id\`)
          REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`season_passes\`
        DROP FOREIGN KEY \`fk_season_passes_holder\`,
        DROP INDEX \`uq_season_passes_holder_season\`,
        DROP INDEX \`uq_season_passes_seat_season\`,
        DROP COLUMN \`holder_user_id\`,
        DROP COLUMN \`holder_name\`
    `);
  }
}
