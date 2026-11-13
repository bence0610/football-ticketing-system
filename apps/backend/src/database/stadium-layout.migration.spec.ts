import { QueryRunner } from 'typeorm';
import { StadiumLayout1715400000000 } from './migrations/1715400000000-StadiumLayout';

/**
 * The migration is a clean reset of reference data, so it must refuse to run
 * over anything it cannot carry across: tickets, season passes and loans
 * reference seats of the old layout.
 */
describe('StadiumLayout migration', () => {
  function runner(counts: { tickets: number; passes: number; loans: number }): {
    qr: QueryRunner;
    statements: string[];
  } {
    const statements: string[] = [];
    const query = jest.fn(async (sql: string) => {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      if (sql.includes('SELECT') && sql.includes('tickets')) {
        return [
          { table: 'tickets', n: String(counts.tickets) },
          { table: 'season_passes', n: String(counts.passes) },
          { table: 'pass_loans', n: String(counts.loans) },
        ];
      }
      return [];
    });
    return { qr: { query } as unknown as QueryRunner, statements };
  }

  it('refuses to run while tickets exist, naming them and changing nothing', async () => {
    const { qr, statements } = runner({ tickets: 3, passes: 0, loans: 0 });
    await expect(new StadiumLayout1715400000000().up(qr)).rejects.toThrow(/tickets: 3/);
    expect(statements.filter((s) => /^(DELETE|ALTER|INSERT|UPDATE)/.test(s))).toEqual([]);
  });

  it('refuses for season passes and for loans too', async () => {
    for (const counts of [
      { tickets: 0, passes: 1, loans: 0 },
      { tickets: 0, passes: 0, loans: 2 },
    ]) {
      const { qr } = runner(counts);
      await expect(new StadiumLayout1715400000000().up(qr)).rejects.toThrow(/refused/);
    }
  });

  it('tells the operator how to clear a dev database', async () => {
    const { qr } = runner({ tickets: 1, passes: 0, loans: 0 });
    await expect(new StadiumLayout1715400000000().up(qr)).rejects.toThrow(
      /DELETE FROM pass_loans; DELETE FROM tickets; DELETE FROM season_passes;/,
    );
  });

  it('on an empty database clears the old layout, then adds the columns, then the 19 sectors', async () => {
    const { qr, statements } = runner({ tickets: 0, passes: 0, loans: 0 });
    await new StadiumLayout1715400000000().up(qr);

    const order = statements
      .filter((s) => /^(UPDATE|DELETE|ALTER|INSERT)/.test(s))
      .map((s) => s.split(' ').slice(0, 3).join(' '));
    expect(order).toEqual([
      'UPDATE `waitlist` SET',
      'DELETE FROM `season_pass_prices`',
      'DELETE FROM `seats`',
      'DELETE FROM `sectors`',
      'ALTER TABLE `sectors`',
      'INSERT INTO `sectors`',
    ]);
    const insert = statements.find((s) => s.startsWith('INSERT INTO `sectors`'))!;
    expect((insert.match(/UUID\(\)/g) ?? []).length).toBe(19);
  });

  it('constrains the gate to 1-4 in the database itself', async () => {
    const { qr, statements } = runner({ tickets: 0, passes: 0, loans: 0 });
    await new StadiumLayout1715400000000().up(qr);
    expect(statements.join(' ')).toContain('CHECK (`gate` BETWEEN 1 AND 4)');
  });
});
