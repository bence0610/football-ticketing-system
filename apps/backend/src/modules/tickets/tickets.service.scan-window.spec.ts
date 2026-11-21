import { ConfigService } from '@nestjs/config';
import {
  LoyaltyTransactionSource,
  MatchStatus,
  SeasonPass,
  Ticket,
  TicketSource,
  TicketStatus,
  User,
} from '../../database/entities';
import { GateConfig, scanWindowState } from '../../config';
import { TicketsService } from './tickets.service';

/**
 * The server refuses a scan outside the window around kickoff (GATE_OPENS_HOURS_BEFORE before to
 * GATE_CLOSES_HOURS_AFTER after) with its own verdict, `not_today`, naming the match; the ticket
 * stays unused and no points are awarded. Season-pass entries and loan entries are tickets too.
 */
const HOUR = 3_600_000;
const TICKET_ID = '0b5f3c1e-aaaa-4bbb-8ccc-1234567890ab';

describe('scan window around kickoff', () => {
  const save = jest.fn(async (x: Ticket) => x);
  const award = jest.fn();

  function ticket(
    kickoffInHours: number,
    source = TicketSource.SINGLE,
    matchStatus: MatchStatus = MatchStatus.ON_SALE,
  ): Ticket {
    return {
      id: TICKET_ID,
      status: TicketStatus.PAID,
      source,
      userId: 'u1',
      matchId: 'm1',
      seasonPassId: source === TicketSource.SINGLE ? null : 'p1',
      qrJti: null,
      match: {
        id: 'm1',
        homeTeam: 'KTE',
        awayTeam: 'Újpest',
        venue: 'Széktói',
        status: matchStatus,
        kickoffAt: new Date(Date.now() + kickoffInHours * HOUR),
      },
      seat: { id: 's1', section: 'B', row: '5', number: 12, category: 'standard' },
    } as unknown as Ticket;
  }

  function service(t: Ticket, gate?: Partial<GateConfig>): TicketsService {
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Ticket) return { findOne: async () => t, save };
        if (entity === User)
          return { findOne: async () => ({ id: 'u1', firstName: 'Anna', lastName: 'Kiss' }) };
        if (entity === SeasonPass)
          return {
            findOne: async () => ({ id: 'p1', holderName: 'Kiss Anna', holderUserId: 'u1' }),
          };
        return { update: jest.fn() };
      },
    };
    const dataSource = {
      transaction: async (cb: (m: unknown) => unknown) => cb(manager),
      getRepository: () => ({ findOne: async () => ({ holderUserId: 'u1' }) }),
    };
    const qr = { verify: jest.fn(), revoke: jest.fn() };
    const config = gate
      ? ({
          get: () => ({ opensHoursBefore: 3, closesHoursAfter: 4, ...gate }),
        } as unknown as ConfigService)
      : undefined;
    return new TicketsService(
      {} as never,
      dataSource as never,
      qr as never,
      undefined,
      { award, getConfig: () => ({ attendancePoints: 50 }) } as never,
      config,
    );
  }

  beforeEach(() => {
    save.mockClear();
    award.mockClear();
  });

  it('admits inside the window: three hours before kickoff up to four hours after', async () => {
    for (const hours of [2.9, 0, -3.9]) {
      const res = await service(ticket(hours)).scanTicket(TICKET_ID, {});
      expect(res).toMatchObject({ success: true, result: 'ok' });
    }
  });

  it('refuses a ticket for a match weeks away: not_today, the match is shown, nothing is recorded', async () => {
    const t = ticket(24 * 30);
    const res = await service(t).scanTicket(TICKET_ID, {});

    expect(res).toMatchObject({
      success: false,
      result: 'not_today',
      message: 'too_early',
      match: { homeTeam: 'KTE', awayTeam: 'Újpest' },
    });
    expect(t.status).toBe(TicketStatus.PAID);
    expect(save).not.toHaveBeenCalled();
    expect(award).not.toHaveBeenCalled();
  });

  it('refuses just before the window opens and just after it closes', async () => {
    expect(await service(ticket(3.1)).scanTicket(TICKET_ID, {})).toMatchObject({
      result: 'not_today',
      message: 'too_early',
    });
    expect(await service(ticket(-4.1)).scanTicket(TICKET_ID, {})).toMatchObject({
      result: 'not_today',
      message: 'too_late',
    });
  });

  it('a ticket scanned yesterday-night after the match is not admitted, and earns no points', async () => {
    const t = ticket(-20);
    const res = await service(t).scanTicket(TICKET_ID, {});
    expect(res.result).toBe('not_today');
    expect(t.status).toBe(TicketStatus.PAID);
    expect(award).not.toHaveBeenCalled();
  });

  it.each([TicketSource.SEASON_PASS, TicketSource.LOAN])(
    'applies to a %s entry too',
    async (source) => {
      const res = await service(ticket(24 * 5, source)).scanTicket(TICKET_ID, {});
      expect(res).toMatchObject({ result: 'not_today', source });
      expect(award).not.toHaveBeenCalled();
      expect(LoyaltyTransactionSource.ATTENDANCE).toBeDefined();
    },
  );

  it('the window is configurable', async () => {
    // 5 h before kickoff: refused by default, admitted when the gate opens 6 h ahead
    expect((await service(ticket(5)).scanTicket(TICKET_ID, {})).result).toBe('not_today');
    expect(
      (await service(ticket(5), { opensHoursBefore: 6 }).scanTicket(TICKET_ID, {})).result,
    ).toBe('ok');
    // and it can close earlier
    expect(
      (await service(ticket(-2), { closesHoursAfter: 1 }).scanTicket(TICKET_ID, {})).result,
    ).toBe('not_today');
  });

  it('a postponed match admits nobody: its own verdict, the ticket stays unused', async () => {
    const t = ticket(1, TicketSource.SINGLE, MatchStatus.POSTPONED);
    const res = await service(t).scanTicket(TICKET_ID, {});
    expect(res).toMatchObject({ success: false, result: 'match_postponed' });
    expect(t.status).toBe(TicketStatus.PAID);
    expect(award).not.toHaveBeenCalled();
  });

  describe('scanWindowState (the one rule)', () => {
    const gate = { opensHoursBefore: 3, closesHoursAfter: 4 };
    const kickoff = new Date('2026-11-18T18:00:00Z');
    const at = (iso: string) => new Date(iso);
    it('open, early, late', () => {
      expect(scanWindowState(kickoff, at('2026-11-18T15:00:00Z'), gate)).toBe('open');
      expect(scanWindowState(kickoff, at('2026-11-18T14:59:59Z'), gate)).toBe('early');
      expect(scanWindowState(kickoff, at('2026-11-18T22:00:00Z'), gate)).toBe('open');
      expect(scanWindowState(kickoff, at('2026-11-18T22:00:01Z'), gate)).toBe('late');
    });
  });
});
