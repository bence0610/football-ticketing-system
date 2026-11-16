/**
 * DEMO DATA for screenshots and the thesis defence. Not part of the normal seed.
 *
 *   npm run seed:demo              replace any earlier demo data with a fresh history
 *   npm run seed:demo -- --dry-run build it in memory, print the figures, write nothing
 *   npm run seed:demo -- --report  only audit and print the figures of what is already there
 *
 * What it writes: about 3,000 fans and 16 named demo accounts, the full 2026/2027 NB II
 * season (30 rounds, 15 at home and 15 away) and two Magyar Kupa ties around today's date,
 * last season's home matches, single tickets, season passes, loans, loyalty points and a
 * waitlist for the sold-out match.
 *
 * It refuses to run unless NODE_ENV is "development" and the database is on this machine.
 * Every row it writes has an id starting with `de300000-`, so a second run removes the first
 * run's rows and writes them again instead of adding to them. Rows that are not demo data
 * are never touched (one exception, documented in write.ts).
 *
 * HOW PAYMENT IS BYPASSED: no Stripe call is made, and no PaymentIntent exists. The tickets
 * and passes are inserted directly, with the `pi_demo_...` marker where the application
 * stores a PaymentIntent id (one per order, shared by the tickets of that order). Everything
 * else is written the way the application writes it: the same statuses and QR code formats,
 * the same loyalty ledger (reference ids, tiers, the discount the buyer's tier gave at that
 * moment, the season-end halving), the same seat rules. Redis is not touched.
 */
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import type { EntityManager } from 'typeorm';
import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import loyaltyConfig from '../../config/loyalty.config';
import AppDataSource from '../data-source';
import { totalSeatCount } from '../stadium-layout';
import { buildDemoDataset } from './dataset';
import type { SeatRef, SectorRef } from './demand';
import { assertLocalDevelopmentDatabase } from './guard';
import type { PassTier } from './model';
import { TIER_DEFINITIONS } from '../../modules/loyalty/loyalty.constants';
import { auditDemoData, demoFigures } from './report';
import { DEMO_ID_PREFIX } from './rng';
import { summaryLines } from './summary';
import { DEMO_PASSWORD, NAMED_ACCOUNTS } from './users';
import { wipeDemoData, writeDemoData } from './write';

const P = `${DEMO_ID_PREFIX}-%`;

const NOTES: readonly string[] = [
  'The away section (VENDÉG) is empty. The portal never sells it and the application refuses a ticket there, so even for the bigger visitors it shows no sold seats here; away fans are not portal customers.',
  'Played matches are FINISHED. The roughly 10% of single tickets that were not scanned are left PAID, not EXPIRED: the admin redemption figure counts only PAID and USED tickets, so expired ones would hide the no-shows and read ~100%. The nightly ExpireTicketsJob (04:00) turns those PAID tickets into EXPIRED; to keep the figure while you demo, set TICKET_EXPIRE_CRON to something that never fires, e.g. "0 0 31 2 *".',
  'The match in progress has status ON_SALE: the application has no "live" status, and sales stop at kickoff on the time alone.',
  'Away matches have no stock (capacity 0), no tickets and status SCHEDULED/FINISHED. The admin figures leave them out: they are listed with dashes and are in no total or average.',
  "Every home match has capacity = the sellable seats (the away section excluded); the sold-out one has every one of them taken, the season-pass holders' entries included.",
  'Loans: a withdrawn loan is CANCELLED, as the application does it; REVOKED is not used (no code path sets it).',
  'No Redis state is written: no seat locks, no revoked QR token ids, no waitlist claim slot.',
];

function parseDate(text: string): Date {
  return new Date(`${text}T00:00:00.000Z`);
}

/** The named accounts, as stored: tier and points are read back from the database, not assumed. */
async function printAccounts(manager: EntityManager): Promise<void> {
  const rows = (await manager.query(
    'SELECT email, first_name AS firstName, last_name AS lastName, loyalty_tier AS tier, loyalty_points AS points FROM users WHERE id LIKE ?',
    [P],
  )) as Array<{ email: string; firstName: string; lastName: string; tier: string; points: number }>;
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  console.log(
    `\nDemo accounts (password for every account, the crowd included: ${DEMO_PASSWORD}):`,
  );
  const width = Math.max(...NAMED_ACCOUNTS.map((a) => a.email.length));
  for (const a of NAMED_ACCOUNTS) {
    const r = byEmail.get(a.email);
    if (!r) continue;
    const tier = TIER_DEFINITIONS.find((t) => t.tier === r.tier)?.label ?? r.tier;
    const name = `${r.lastName} ${r.firstName}`;
    console.log(
      `  ${a.email.padEnd(width)}  ${name.padEnd(16)} [${tier}, ${r.points} pont]  ${a.purpose}`,
    );
  }
}

/** Prints the audit and the figures; returns the exit code (0 when every check passed). */
async function printAuditAndFigures(
  manager: EntityManager,
  validFrom: string,
  validUntil: string,
): Promise<number> {
  console.log('\nAudit (read back from the database; 0 violations is a pass):');
  const audit = await auditDemoData(manager);
  for (const a of audit) {
    console.log(
      `  ${a.violations === 0 ? 'PASS' : 'FAIL'}  ${a.name}${a.violations ? `  [${a.violations}]` : ''}`,
    );
  }
  const failed = audit.filter((a) => a.violations > 0).length;

  console.log('\nFigures:');
  for (const line of await demoFigures(manager, { validFrom, validUntil }))
    console.log(`  ${line}`);
  if (failed > 0) console.error(`\n${failed} audit check(s) failed.`);
  return failed > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const reportOnly = process.argv.includes('--report');
  const options = AppDataSource.options as MysqlConnectionOptions;
  assertLocalDevelopmentDatabase({
    nodeEnv: process.env.NODE_ENV,
    dbHost: options.host,
    dbName: options.database as string | undefined,
  });
  console.log(
    `Target: ${options.database}@${options.host}:${options.port} (NODE_ENV=${process.env.NODE_ENV})`,
  );

  await AppDataSource.initialize();
  try {
    const manager = AppDataSource.manager;

    const seatRows = (await manager.query(
      'SELECT id, section, `row` AS rowNo, number, price_modifier AS pm, is_accessible AS acc FROM seats WHERE is_active = 1',
    )) as Array<{
      id: string;
      section: string;
      rowNo: string;
      number: number;
      pm: string;
      acc: number;
    }>;
    if (seatRows.length !== totalSeatCount()) {
      throw new Error(
        `The database holds ${seatRows.length} active seats but the stadium layout has ${totalSeatCount()}. Run the migrations and the normal seed (npm run seed) first.`,
      );
    }
    const seats: SeatRef[] = seatRows.map((s) => ({
      id: s.id,
      section: s.section,
      row: Number(s.rowNo),
      number: Number(s.number),
      priceModifier: Number(s.pm),
      isAccessible: Number(s.acc) === 1,
    }));
    const sectorRows = (await manager.query(
      'SELECT code, arc, position, is_away AS isAway, is_covered AS isCovered, price_category AS priceCategory FROM sectors',
    )) as Array<{
      code: string;
      arc: 'upper' | 'lower';
      position: number;
      isAway: number;
      isCovered: number;
      priceCategory: SectorRef['priceCategory'];
    }>;
    const sectors: SectorRef[] = sectorRows.map((s) => ({
      code: s.code,
      arc: s.arc,
      position: Number(s.position),
      isAway: Number(s.isAway) === 1,
      isCovered: Number(s.isCovered) === 1,
      priceCategory: s.priceCategory,
    }));

    const priceRows = (await manager.query(
      "SELECT section, season_label AS label, price, DATE_FORMAT(valid_from, '%Y-%m-%d') AS validFrom, DATE_FORMAT(valid_until, '%Y-%m-%d') AS validUntil FROM season_pass_prices WHERE is_active = 1 AND id NOT LIKE ?",
      [P],
    )) as Array<{
      section: PassTier;
      label: string;
      price: number;
      validFrom: string;
      validUntil: string;
    }>;
    if (priceRows.length === 0) {
      throw new Error('No active season pass prices: run the normal seed (npm run seed) first.');
    }
    const latest = priceRows.reduce((a, b) => (b.validUntil > a.validUntil ? b : a));
    const ofSeason = priceRows.filter((r) => r.label === latest.label);
    const prices = {} as Record<PassTier, number>;
    for (const tier of ['vip', 'lower', 'upper'] as const) {
      const row = ofSeason.find((r) => r.section === tier);
      if (!row) throw new Error(`Season ${latest.label} has no ${tier} price row.`);
      prices[tier] = Number(row.price);
    }
    const season = {
      label: latest.label,
      validFrom: parseDate(latest.validFrom),
      validUntil: parseDate(latest.validUntil),
      prices,
    };

    if (reportOnly) {
      await printAccounts(manager);
      process.exitCode = await printAuditAndFigures(manager, latest.validFrom, latest.validUntil);
      return;
    }

    const foreign = (await manager.query(
      "SELECT seat_id AS seatId FROM season_passes WHERE id NOT LIKE ? AND seat_id IS NOT NULL AND status IN ('active','pending_payment')",
      [P],
    )) as Array<{ seatId: string }>;

    const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS ?? '12', 10);
    const started = Date.now();
    // One hash for every demo account: hashing three thousand times would take minutes.
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, rounds);
    console.log(
      `Password hash made once (${Date.now() - started} ms), shared by every demo account.`,
    );

    const rules = loyaltyConfig();
    const built = Date.now();
    const data = buildDemoDataset({
      now: new Date(),
      seats,
      sectors,
      season,
      passwordHash,
      foreignPassSeatIds: new Set(foreign.map((f) => f.seatId)),
      rules,
    });
    console.log(
      `Built in memory in ${Date.now() - built} ms: ${data.users.length} users, ${data.matches.length} matches, ` +
        `${data.tickets.length} tickets, ${data.passes.length} passes, ${data.loans.length} loans, ` +
        `${data.ledger.length} ledger rows, ${data.waitlist.length} waitlist entries.`,
    );

    if (dryRun) {
      console.log('\nFigures (from the in-memory build):');
      const lines = summaryLines(data, {
        now: new Date(),
        seats,
        sectors,
        seasonFrom: season.validFrom,
        seasonUntil: season.validUntil,
      });
      for (const line of lines) console.log(`  ${line}`);
      console.log('Dry run: nothing was written.');
      return;
    }

    const wrote = Date.now();
    const [wiped, written] = await AppDataSource.transaction(async (tx) => {
      const w = await wipeDemoData(tx);
      const n = await writeDemoData(tx, data);
      return [w, n] as const;
    });
    console.log(`Removed from an earlier run: ${JSON.stringify(wiped)}`);
    console.log(`Written in ${Date.now() - wrote} ms: ${JSON.stringify(written)}`);

    const failed = await printAuditAndFigures(manager, latest.validFrom, latest.validUntil);

    await printAccounts(manager);

    console.log('\nWhere this differs from a live system:');
    for (const n of NOTES) console.log(`  - ${n}`);

    if (failed > 0) process.exitCode = 1;
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
