import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One-off backfill for the "lent and used" status.
 *
 * Before scanning a borrowed entry set pass_loans.status = 'used', such a loan
 * stayed 'accepted'. The hourly sweeper would then turn it into 'completed',
 * which means "lent, but the borrower did not come" - a false record for a
 * borrower who did.
 *
 * A loan is the one a LOAN ticket belongs to when both name the same pass and
 * match (the same key the scan uses). Where that ticket is already 'used' and
 * the loan still reads 'accepted', the loan becomes 'used'.
 *
 * Idempotent: it only touches 'accepted' rows, so a second run finds none.
 * down() is a no-op on purpose: afterwards a backfilled row cannot be told
 * apart from one the scan marked, and turning genuine 'used' loans back into
 * 'accepted' would recreate the very bug this fixes.
 */
export class LoanUsedBackfill1715200000000 implements MigrationInterface {
  name = 'LoanUsedBackfill1715200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE \`pass_loans\` l
      SET l.\`status\` = 'used'
      WHERE l.\`status\` = 'accepted'
        AND EXISTS (
          SELECT 1 FROM \`tickets\` t
          WHERE t.\`season_pass_id\` = l.\`season_pass_id\`
            AND t.\`match_id\` = l.\`match_id\`
            AND t.\`source\` = 'loan'
            AND t.\`status\` = 'used'
        )
    `);
  }

  public async down(): Promise<void> {
    // Intentionally empty - see the class comment.
  }
}
