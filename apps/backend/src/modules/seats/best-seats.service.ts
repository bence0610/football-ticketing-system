import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SeatLockService } from '../../redis/seat-lock.service';
import { MAX_SEATS_PER_ORDER } from '../payments/dto/create-payment-intent.dto';
import { bestSplit, findRuns, groupRows, GridSeat, rankWindows, Window } from './best-seats';
import { BestSeatsResponseDto, SeatAvailability, SeatRunDto } from './dto';
import { SeatsService } from './seats.service';

/** How many top-ranked placements are handed to Redis per attempt. */
const CANDIDATES_PER_ATTEMPT = 48;
/**
 * A lost race costs one more attempt with a fresh view of the sector. Under a
 * burst, several visitors can all aim for the same best placement; the script
 * gives it to one and the rest fall through its candidate list, so more than a
 * couple of attempts only happen when a whole sector is being fought over.
 */
const MAX_ATTEMPTS = 5;

export interface BestSeatsParams {
  matchId: string;
  section: string;
  count: number;
  allowSplit: boolean;
  userId?: string;
}

/**
 * "Find the best adjacent seats and lock them", as one server operation.
 *
 * Race safety: this service only RANKS placements from a snapshot of the sector.
 * It never decides that seats are free. The decision happens inside Redis, in
 * {@link SeatLockService.acquireFirstFreeGroup}, which takes the first ranked
 * placement whose seats are all still unlocked and locks them in the same
 * atomic step. A snapshot that went stale a millisecond later therefore cannot
 * hand the same seat to two people: the second caller's script finds the key
 * taken, moves to its next candidate, and, if all are gone, we re-read and retry.
 */
@Injectable()
export class BestSeatsService {
  private readonly logger = new Logger(BestSeatsService.name);

  constructor(
    private readonly seatsService: SeatsService,
    private readonly seatLockService: SeatLockService,
  ) {}

  async findAndLock(params: BestSeatsParams): Promise<BestSeatsResponseDto> {
    const { matchId, section, count, allowSplit, userId } = params;
    await this.seatsService.assertMatchOpenForSale(matchId);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const data = await this.seatsService.loadSectorForFinder(matchId, section);
      if (!data) {
        throw new NotFoundException(`A szektor (${section}) nem található.`);
      }
      if (data.sector.isAway) {
        throw new ForbiddenException('A vendégszektor helyei a portálon nem vásárolhatók meg.');
      }

      const grid: GridSeat[] = data.seats;
      const byId = new Map(data.seats.map((s) => [s.id, s]));
      const rowOrder = new Map(groupRows(grid).map((r, i) => [r.row, i]));
      const rowIndexOf = (row: string): number => rowOrder.get(row) ?? 0;
      const runs = findRuns(grid, data.width);

      const singles = rankWindows(runs, count, rowIndexOf, data.ideal);
      let candidates: Window[][];
      let kind: 'together' | 'split';
      if (singles.length > 0) {
        kind = 'together';
        candidates = singles.slice(0, CANDIDATES_PER_ATTEMPT).map((w) => [w]);
      } else {
        const split = count >= 2 ? bestSplit(runs, count, rowIndexOf, data.ideal) : null;
        if (!allowSplit || !split) {
          throw this.noRun(section, count, grid, runs, split);
        }
        kind = 'split';
        candidates = [[...split.windows]];
      }

      const locked = await this.seatLockService.acquireFirstFreeGroup(
        matchId,
        candidates.map((group) => group.flatMap((w) => w.seats.map((s) => s.id))),
        { userId, maxHeldSeats: MAX_SEATS_PER_ORDER },
      );
      if (!locked) {
        this.logger.debug(
          `Best seats: placement taken before the lock (attempt ${attempt}/${MAX_ATTEMPTS}).`,
        );
        continue;
      }

      const chosen = candidates[locked.index];
      const runDtos: SeatRunDto[] = chosen.map((w) => ({
        row: w.row,
        seats: w.seats.map((s) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { free, ...dto } = byId.get(s.id)!;
          return { ...dto, status: SeatAvailability.LOCKED };
        }),
      }));
      return {
        matchId,
        section,
        kind,
        runs: runDtos,
        ownerToken: locked.ownerToken,
        ttlSeconds: locked.ttlSeconds,
        expiresAt: new Date(Date.now() + locked.ttlSeconds * 1000).toISOString(),
      };
    }

    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'contended',
      message: 'A szektor helyeit épp most foglalták le mások. Próbáld újra egy pillanat múlva.',
    });
  }

  /** The 409 that says plainly what is not possible and what is. */
  private noRun(
    section: string,
    count: number,
    seats: ReadonlyArray<GridSeat>,
    runs: ReadonlyArray<{ row: string; seats: ReadonlyArray<GridSeat> }>,
    split: { windows: ReadonlyArray<Window> } | null,
  ): ConflictException {
    const freeSeats = seats.filter((s) => s.free).length;
    const longest = runs.reduce((m, r) => Math.max(m, r.seats.length), 0);
    const offer = split
      ? {
          runs: split.windows.map((w) => ({
            row: w.row,
            firstNumber: w.seats[0].number,
            lastNumber: w.seats[w.seats.length - 1].number,
            length: w.seats.length,
          })),
        }
      : null;

    let message: string;
    let code: 'no_adjacent_run' | 'not_enough_seats';
    if (freeSeats < count) {
      code = 'not_enough_seats';
      message = `Ebben a szektorban (${section}) már csak ${freeSeats} szabad hely van, ${count} fő részére nem elég.`;
    } else {
      code = 'no_adjacent_run';
      message = `Ebben a szektorban (${section}) nincs ${count} egymás melletti szabad hely; a leghosszabb összefüggő szabad sor ${longest} hely.`;
      message += offer
        ? ` Felajánlhatunk két külön sort: ${offer.runs
            .map((r) => `${r.row}. sor ${r.firstNumber}-${r.lastNumber}`)
            .join(' és ')}.`
        : ' Két külön sorba sem tudjuk elosztani a társaságot.';
    }
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code,
      message,
      requested: count,
      longestRun: longest,
      freeSeats,
      alternative: offer,
    });
  }
}
