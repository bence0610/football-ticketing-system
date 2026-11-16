import { EntityManager, EntityTarget } from 'typeorm';
import { tierForPoints } from '../../modules/loyalty/loyalty.constants';
import { LoyaltyTransaction } from '../entities/loyalty-transaction.entity';
import { Match } from '../entities/match.entity';
import { PassLoan } from '../entities/pass-loan.entity';
import { SeasonPassPrice } from '../entities/season-pass-price.entity';
import { SeasonPass } from '../entities/season-pass.entity';
import { Ticket } from '../entities/ticket.entity';
import { User } from '../entities/user.entity';
import { Waitlist } from '../entities/waitlist.entity';
import type { DemoDataset } from './dataset';
import { DEMO_ID_PREFIX } from './rng';

/** `LIKE` pattern that matches every id this script creates. */
const MINE = `${DEMO_ID_PREFIX}-%`;

type Counts = Record<string, number>;

async function remove(
  manager: EntityManager,
  label: string,
  sql: string,
  params: unknown[],
  counts: Counts,
): Promise<void> {
  const result = (await manager.query(sql, params)) as { affectedRows?: number };
  counts[label] = (counts[label] ?? 0) + (result.affectedRows ?? 0);
}

/**
 * Removes what an earlier run wrote, so a second run replaces the data instead of adding to it.
 * Only rows with this script's id prefix go, plus the few rows that depend on them: if an
 * account that is not demo data bought a ticket for a demo match (it is a demo match, it is
 * going), that ticket goes too, and the loyalty points it earned are taken back from that account.
 */
export async function wipeDemoData(manager: EntityManager): Promise<Counts> {
  const counts: Counts = {};

  const foreignTickets = (await manager.query(
    'SELECT id, user_id AS userId FROM tickets WHERE match_id LIKE ? AND user_id NOT LIKE ?',
    [MINE, MINE],
  )) as Array<{ id: string; userId: string }>;
  if (foreignTickets.length > 0) {
    const refs = foreignTickets.map((t) => `ticket:${t.id}`);
    const earned = (await manager.query(
      "SELECT user_id AS userId, SUM(points) AS points FROM loyalty_transactions WHERE source = 'ticket_purchase' AND reference_id IN (?) GROUP BY user_id",
      [refs],
    )) as Array<{ userId: string; points: string }>;
    await remove(
      manager,
      'loyalty rows of other accounts',
      "DELETE FROM loyalty_transactions WHERE source = 'ticket_purchase' AND reference_id IN (?)",
      [refs],
      counts,
    );
    for (const e of earned) {
      const [user] = (await manager.query(
        'SELECT loyalty_points AS points FROM users WHERE id = ?',
        [e.userId],
      )) as Array<{ points: number }>;
      const points = Math.max(0, Number(user?.points ?? 0) - Number(e.points));
      await manager.query('UPDATE users SET loyalty_points = ?, loyalty_tier = ? WHERE id = ?', [
        points,
        tierForPoints(points).tier,
        e.userId,
      ]);
    }
  }

  await remove(
    manager,
    'waitlist',
    'DELETE FROM waitlist WHERE user_id LIKE ? OR match_id LIKE ?',
    [MINE, MINE],
    counts,
  );
  await remove(
    manager,
    'loyalty_transactions',
    'DELETE FROM loyalty_transactions WHERE user_id LIKE ?',
    [MINE],
    counts,
  );
  await remove(
    manager,
    'tickets',
    'DELETE FROM tickets WHERE match_id LIKE ? OR user_id LIKE ? OR season_pass_id LIKE ?',
    [MINE, MINE, MINE],
    counts,
  );
  await remove(
    manager,
    'pass_loans',
    'DELETE FROM pass_loans WHERE id LIKE ? OR match_id LIKE ? OR lender_user_id LIKE ? OR season_pass_id LIKE ?',
    [MINE, MINE, MINE, MINE],
    counts,
  );
  await remove(
    manager,
    'season_passes',
    'DELETE FROM season_passes WHERE id LIKE ? OR user_id LIKE ? OR holder_user_id LIKE ?',
    [MINE, MINE, MINE],
    counts,
  );
  await remove(
    manager,
    'season_pass_prices',
    'DELETE FROM season_pass_prices WHERE id LIKE ?',
    [MINE],
    counts,
  );
  await remove(manager, 'matches', 'DELETE FROM matches WHERE id LIKE ?', [MINE], counts);
  await remove(
    manager,
    'password_reset_tokens',
    'DELETE FROM password_reset_tokens WHERE user_id LIKE ?',
    [MINE],
    counts,
  );
  await remove(
    manager,
    'email_change_tokens',
    'DELETE FROM email_change_tokens WHERE user_id LIKE ?',
    [MINE],
    counts,
  );
  await remove(manager, 'users', 'DELETE FROM users WHERE id LIKE ?', [MINE], counts);
  return counts;
}

async function insertInChunks(
  manager: EntityManager,
  entity: EntityTarget<object>,
  rows: readonly object[],
  chunk = 400,
): Promise<number> {
  for (let i = 0; i < rows.length; i += chunk) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(entity)
      .values(rows.slice(i, i + chunk) as never[])
      .execute();
  }
  return rows.length;
}

/** Writes the whole dataset, parents before children so every foreign key holds. */
export async function writeDemoData(manager: EntityManager, data: DemoDataset): Promise<Counts> {
  const written: Counts = {};
  written.users = await insertInChunks(manager, User, data.users);
  written.matches = await insertInChunks(manager, Match, data.matches);
  written.season_pass_prices = await insertInChunks(manager, SeasonPassPrice, data.prices);
  written.season_passes = await insertInChunks(manager, SeasonPass, data.passes);
  written.pass_loans = await insertInChunks(manager, PassLoan, data.loans);
  written.tickets = await insertInChunks(manager, Ticket, data.tickets);
  written.loyalty_transactions = await insertInChunks(manager, LoyaltyTransaction, data.ledger);
  written.waitlist = await insertInChunks(manager, Waitlist, data.waitlist);
  return written;
}
