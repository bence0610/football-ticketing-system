import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `uq_tickets_match_seat (match_id, seat_id)` ignored the ticket status, so a CANCELLED, REFUNDED
 * or EXPIRED row kept holding the seat for its match while every other part of the application
 * (the seat map, the lock, the payment check, the admin figures) treats such a seat as FREE. The
 * two disagreed: a seat shown as free could not be sold, and the failed insert looked like a
 * concurrent finalization of the same payment.
 *
 * The index is aligned to the application's definition (ticket-occupancy.ts): only a ticket that
 * OCCUPIES its seat (pending_payment, paid, used) holds the (match, seat) slot. A generated
 * `active_slot` column is 1 for those statuses and NULL otherwise; MySQL's unique indexes treat
 * NULLs as distinct, so any number of void rows may sit next to one occupying ticket.
 */
export class TicketSlotOnlyForOccupying1716400000000 implements MigrationInterface {
  name = 'TicketSlotOnlyForOccupying1716400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `tickets` ADD COLUMN `active_slot` tinyint GENERATED ALWAYS AS (CASE WHEN `status` IN ('pending_payment','paid','used') THEN 1 ELSE NULL END) STORED",
    );
    await queryRunner.query('ALTER TABLE `tickets` DROP INDEX `uq_tickets_match_seat`');
    await queryRunner.query(
      'ALTER TABLE `tickets` ADD UNIQUE INDEX `uq_tickets_match_seat` (`match_id`, `seat_id`, `active_slot`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `tickets` DROP INDEX `uq_tickets_match_seat`');
    await queryRunner.query(
      'ALTER TABLE `tickets` ADD UNIQUE INDEX `uq_tickets_match_seat` (`match_id`, `seat_id`)',
    );
    await queryRunner.query('ALTER TABLE `tickets` DROP COLUMN `active_slot`');
  }
}
