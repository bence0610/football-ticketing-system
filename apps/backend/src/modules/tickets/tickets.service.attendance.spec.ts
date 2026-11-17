import {
  LoyaltyTransactionSource,
  SeasonPass,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
} from '../../database/entities';
import { TicketsService } from './tickets.service';

/**
 * Loyalty measures attendance, not spending: a person earns LOYALTY_ATTENDANCE_POINTS the first
 * time they enter a match, once per person per match however many of their tickets are scanned.
 * The once is the ledger's unique (source, reference), the reference being built from the match
 * and the person; this spec runs the real TicketsService against a ledger that enforces that key.
 */
describe('TicketsService.scanTicket: attendance points', () => {
  const MATCH = 'match-1';
  const OTHER_MATCH = 'match-2';

  /** A fake ledger with the unique (source, reference) key, as the database has it. */
  function ledger() {
    const rows: Array<{ userId: string; source: string; referenceId: string; points: number }> = [];
    const keys = new Set<string>();
    const award = jest.fn(
      async (o: { userId: string; source: string; referenceId: string; points: number }) => {
        const key = `${o.source}|${o.referenceId}`;
        if (keys.has(key)) return { duplicate: true };
        keys.add(key);
        rows.push({
          userId: o.userId,
          source: o.source,
          referenceId: o.referenceId,
          points: o.points,
        });
        return { duplicate: false };
      },
    );
    const pointsOf = (userId: string): number =>
      rows.filter((r) => r.userId === userId).reduce((sum, r) => sum + r.points, 0);
    return { rows, award, pointsOf };
  }

  interface Spec {
    id: string;
    userId: string;
    source?: TicketSource;
    matchId?: string;
    status?: TicketStatus;
    seasonPassId?: string | null;
  }

  function setup(specs: Spec[], holderOfPass: Record<string, string | null> = {}) {
    const tickets = new Map<string, Ticket>(
      specs.map((s) => [
        s.id,
        {
          id: s.id,
          status: s.status ?? TicketStatus.PAID,
          source: s.source ?? TicketSource.SINGLE,
          userId: s.userId,
          matchId: s.matchId ?? MATCH,
          seasonPassId: s.seasonPassId ?? null,
          qrJti: null,
          match: {
            id: s.matchId ?? MATCH,
            homeTeam: 'KTE',
            awayTeam: 'Újpest',
            venue: 'S',
            kickoffAt: new Date(),
          },
          seat: { id: 's1', section: 'B', row: '5', number: 12, category: 'standard' },
        } as unknown as Ticket,
      ]),
    );
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Ticket) {
          return {
            findOne: async ({ where }: { where: { id: string } }) => tickets.get(where.id) ?? null,
            save: async (x: Ticket) => x,
          };
        }
        if (entity === User)
          return { findOne: async () => ({ firstName: 'Anna', lastName: 'Kiss' }) };
        if (entity === SeasonPass) return { findOne: async () => null };
        return { update: async () => undefined };
      },
    };
    const dataSource = {
      transaction: async (cb: (m: unknown) => unknown) => cb(manager),
      getRepository: (entity: unknown) => {
        if (entity === SeasonPass) {
          return {
            findOne: async ({ where }: { where: { id: string } }) => ({
              id: where.id,
              holderUserId: holderOfPass[where.id] ?? null,
            }),
          };
        }
        throw new Error('unexpected repo');
      },
    };
    const books = ledger();
    const loyalty = { award: books.award, getConfig: () => ({ attendancePoints: 50 }) };
    const qr = { verify: jest.fn(), revoke: jest.fn() };
    const service = new TicketsService(
      {} as never,
      dataSource as never,
      qr as never,
      undefined,
      loyalty as never,
    );
    return { service, tickets, ...books };
  }

  it('three of a user’s tickets scanned for one match earn the points once', async () => {
    const { service, rows, pointsOf } = setup([
      { id: 't1', userId: 'anna' },
      { id: 't2', userId: 'anna' },
      { id: 't3', userId: 'anna' },
    ]);
    for (const id of ['t1', 't2', 't3']) {
      expect((await service.scanTicket(id, {})).result).toBe('ok');
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'anna',
      source: LoyaltyTransactionSource.ATTENDANCE,
      points: 50,
      referenceId: `match:${MATCH}:anna`,
    });
    expect(pointsOf('anna')).toBe(50);
  });

  it('a pass entry and a ticket of the same user on the same match earn once', async () => {
    const { service, rows, pointsOf } = setup(
      [
        { id: 'entry', userId: 'buyer', source: TicketSource.SEASON_PASS, seasonPassId: 'pass-1' },
        { id: 'single', userId: 'anna' },
      ],
      { 'pass-1': 'anna' }, // the pass holder is the same person as the ticket's buyer
    );
    await service.scanTicket('entry', {});
    await service.scanTicket('single', {});
    expect(rows).toHaveLength(1);
    expect(pointsOf('anna')).toBe(50);
    // the pass's buyer (not the holder) earned nothing for the entry
    expect(pointsOf('buyer')).toBe(0);
  });

  it('a bought but unscanned ticket earns nothing', async () => {
    const { service, rows, award } = setup([{ id: 't1', userId: 'anna' }]);
    // never scanned; and a refused scan (an expired ticket) admits nobody and earns nothing either
    const {
      service: s2,
      rows: rows2,
      award: award2,
    } = setup([{ id: 'late', userId: 'anna', status: TicketStatus.EXPIRED }]);
    expect((await s2.scanTicket('late', {})).result).toBe('expired');
    expect(rows).toHaveLength(0);
    expect(award).not.toHaveBeenCalled();
    expect(rows2).toHaveLength(0);
    expect(award2).not.toHaveBeenCalled();
    expect(service).toBeDefined();
  });

  it('a borrower earns the attendance points; the lender gets only the loan points (none from the gate)', async () => {
    const { service, rows, pointsOf } = setup(
      [{ id: 'loan', userId: 'borrower', source: TicketSource.LOAN, seasonPassId: 'pass-1' }],
      { 'pass-1': 'lender' },
    );
    expect((await service.scanTicket('loan', {})).result).toBe('ok');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 'borrower',
      source: LoyaltyTransactionSource.ATTENDANCE,
      referenceId: `match:${MATCH}:borrower`,
    });
    expect(pointsOf('borrower')).toBe(50);
    expect(pointsOf('lender')).toBe(0); // the loan points are paid when the loan closes, not here
  });

  it('each match earns separately, and each person separately', async () => {
    const { service, pointsOf } = setup([
      { id: 'a1', userId: 'anna' },
      { id: 'a2', userId: 'anna', matchId: OTHER_MATCH },
      { id: 'b1', userId: 'bela' },
    ]);
    for (const id of ['a1', 'a2', 'b1']) await service.scanTicket(id, {});
    expect(pointsOf('anna')).toBe(100);
    expect(pointsOf('bela')).toBe(50);
  });

  it('scanning the same ticket twice earns once', async () => {
    const { service, rows } = setup([{ id: 't1', userId: 'anna' }]);
    expect((await service.scanTicket('t1', {})).result).toBe('ok');
    expect((await service.scanTicket('t1', {})).result).toBe('already_used');
    expect(rows).toHaveLength(1);
  });

  it('a holder of a pass without an account has nobody to credit', async () => {
    const { service, rows } = setup(
      [{ id: 'entry', userId: 'buyer', source: TicketSource.SEASON_PASS, seasonPassId: 'pass-1' }],
      { 'pass-1': null },
    );
    expect((await service.scanTicket('entry', {})).result).toBe('ok');
    expect(rows).toHaveLength(0);
  });

  it('a failing ledger never stops the admission', async () => {
    const { service, award } = setup([{ id: 't1', userId: 'anna' }]);
    award.mockRejectedValue(new Error('ledger down'));
    expect(await service.scanTicket('t1', {})).toMatchObject({ success: true, result: 'ok' });
  });
});
