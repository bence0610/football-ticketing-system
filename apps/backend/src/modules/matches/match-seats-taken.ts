import { In, Repository } from 'typeorm';
import { Match, SeasonPass, SeasonPassStatus, Ticket } from '../../database/entities';
import { passCoversMatch } from '../season-passes/season-pass-validity';
import { OCCUPYING_TICKET_STATUSES } from '../tickets/ticket-occupancy';

type CountedMatch = Pick<Match, 'id' | 'kickoffAt' | 'isSeasonPassEligible' | 'status'>;

/**
 * THE figure for "how many seats of this match are taken": the tickets that occupy a seat PLUS the
 * seats of the season passes valid for the match whose holder's entry ticket does not exist (yet).
 * A pass entry ticket is created only when the holder opens the QR or is scanned, but the seat is
 * the holder's from the moment the pass is valid for the match, so it is not for sale: counting
 * only tickets showed those seats as free. The admin occupancy counts the same way.
 *
 * `availableSeats` of the match list, the waitlist rule ("is the match sold out") and the chatbot's
 * snapshot all take it from here, so they cannot disagree.
 */
export async function seatsTakenByMatch(
  tickets: Repository<Ticket>,
  matches: readonly CountedMatch[],
): Promise<Map<string, number>> {
  const taken = new Map<string, number>();
  if (matches.length === 0) return taken;
  const matchIds = matches.map((m) => m.id);

  const rows = await tickets
    .createQueryBuilder('ticket')
    .select('ticket.matchId', 'matchId')
    .addSelect('COUNT(ticket.id)', 'soldCount')
    .where('ticket.matchId IN (:...matchIds)', { matchIds })
    .andWhere('ticket.status IN (:...statuses)', { statuses: [...OCCUPYING_TICKET_STATUSES] })
    .groupBy('ticket.matchId')
    .getRawMany<{ matchId: string; soldCount: string | number }>();
  for (const row of rows) taken.set(row.matchId, Number(row.soldCount));

  // The seats the passes hold for each match, that have no occupying ticket of their own.
  if (!matches.some((m) => m.isSeasonPassEligible)) return taken;
  const passes = await tickets.manager.getRepository(SeasonPass).find({
    where: { status: SeasonPassStatus.ACTIVE },
    select: ['seatId', 'validFrom', 'validUntil'],
  });
  const heldByMatch = new Map<string, Set<string>>();
  for (const match of matches) {
    const seats = passes
      .filter((p) => p.seatId && passCoversMatch(match, p))
      .map((p) => p.seatId as string);
    if (seats.length > 0) heldByMatch.set(match.id, new Set(seats));
  }
  if (heldByMatch.size === 0) return taken;

  const allPassSeats = [...new Set([...heldByMatch.values()].flatMap((s) => [...s]))];
  const ticketed = await tickets.find({
    where: {
      matchId: In([...heldByMatch.keys()]),
      seatId: In(allPassSeats),
      status: In([...OCCUPYING_TICKET_STATUSES]),
    },
    select: ['matchId', 'seatId'],
  });
  const withTicket = new Map<string, Set<string>>();
  for (const t of ticketed) {
    const set = withTicket.get(t.matchId) ?? new Set<string>();
    set.add(t.seatId);
    withTicket.set(t.matchId, set);
  }
  for (const [matchId, seats] of heldByMatch) {
    const own = withTicket.get(matchId) ?? new Set<string>();
    const heldOnly = [...seats].filter((id) => !own.has(id)).length;
    taken.set(matchId, (taken.get(matchId) ?? 0) + heldOnly);
  }
  return taken;
}
