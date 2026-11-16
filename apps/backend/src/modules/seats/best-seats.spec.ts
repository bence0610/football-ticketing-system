import {
  aislesAfter,
  bestSplit,
  findRuns,
  GridSeat,
  groupRows,
  halfwayWithin,
  longestRun,
  rankWindows,
} from './best-seats';

/** rows x width grid, everything free unless listed as "row:number". */
function grid(rows: number, width: number, taken: string[] = []): GridSeat[] {
  const out: GridSeat[] = [];
  for (let r = 1; r <= rows; r++) {
    for (let n = 1; n <= width; n++) {
      out.push({ id: `${r}-${n}`, row: String(r), number: n, free: !taken.includes(`${r}:${n}`) });
    }
  }
  return out;
}

const rowIndex = (row: string): number => Number(row) - 1;
const numbers = (w: { seats: readonly GridSeat[] }): number[] => w.seats.map((s) => s.number);

describe('aislesAfter', () => {
  it('puts one aisle in the middle of a wide row and none in a narrow one', () => {
    expect(aislesAfter(28)).toEqual([14]);
    expect(aislesAfter(18)).toEqual([9]);
    expect(aislesAfter(14)).toEqual([]);
    expect(aislesAfter(12)).toEqual([]);
  });
});

describe('findRuns', () => {
  it('splits a row at taken seats', () => {
    const runs = findRuns(grid(1, 10, ['1:4']));
    expect(runs.map((r) => r.seats.length)).toEqual([3, 6]);
  });

  it('does not join seats across the aisle', () => {
    // 28 wide: aisle after 14. All free: two runs of 14, not one of 28.
    const runs = findRuns(grid(1, 28));
    expect(runs.map((r) => r.seats.length)).toEqual([14, 14]);
    expect(longestRun(grid(1, 28))).toBe(14);
  });

  it('does not join a row to the next row', () => {
    expect(findRuns(grid(2, 6)).map((r) => r.row)).toEqual(['1', '2']);
  });

  it('treats a missing seat number as a gap', () => {
    const seats = grid(1, 6).filter((s) => s.number !== 3);
    expect(findRuns(seats).map((r) => r.seats.length)).toEqual([2, 3]);
  });

  it('is 0 when nothing is free', () => {
    expect(
      longestRun(
        grid(2, 6, [
          '1:1',
          '1:2',
          '1:3',
          '1:4',
          '1:5',
          '1:6',
          '2:1',
          '2:2',
          '2:3',
          '2:4',
          '2:5',
          '2:6',
        ]),
      ),
    ).toBe(0);
  });
});

describe('groupRows', () => {
  it('orders rows numerically, not alphabetically', () => {
    const seats: GridSeat[] = ['10', '2', '1', '16', '9'].map((row) => ({
      id: row,
      row,
      number: 1,
      free: true,
    }));
    expect(groupRows(seats).map((r) => r.row)).toEqual(['1', '2', '9', '10', '16']);
  });
});

describe('halfwayWithin', () => {
  // the real upper arc, west to east: D/1 .. A/2 seats per row
  const upper = [18, 22, 24, 28, 28, 24, 22, 18];
  it('is at the east edge of the sector just west of the middle and the west edge of the one just east', () => {
    expect(halfwayWithin(upper, 3)).toBe(28);
    expect(halfwayWithin(upper, 4)).toBe(0);
  });
  it('clamps to the nearest edge for sectors away from the middle', () => {
    expect(halfwayWithin(upper, 0)).toBe(18);
    expect(halfwayWithin(upper, 7)).toBe(0);
  });
  it('falls inside a sector when the middle does (lower arc: J)', () => {
    const lower = [28, 24, 26, 28, 28, 28, 28, 28, 28, 26, 24];
    expect(halfwayWithin(lower, 5)).toBe(14);
  });
});

describe('rankWindows', () => {
  it('prefers the front row, then the middle', () => {
    const seats = grid(3, 12);
    const best = rankWindows(findRuns(seats), 2, rowIndex, 6)[0];
    expect(best.row).toBe('1');
    expect(numbers(best)).toEqual([6, 7]); // centre at 6, exactly the halfway point
  });

  it('trades a few seats of distance against a row', () => {
    // front row free only at the far edge (seats 1-2), row 2 free in the middle: row 2 wins
    // (edge: 10 seats off centre + 0 rows; middle: 0 off + 1 row)
    const taken: string[] = [];
    for (let n = 3; n <= 12; n++) taken.push(`1:${n}`);
    const best = rankWindows(findRuns(grid(2, 12, taken)), 2, rowIndex, 6)[0];
    expect(best.row).toBe('2');
  });

  it('takes the best placement inside a long run, not its start', () => {
    const best = rankWindows(findRuns(grid(1, 12)), 4, rowIndex, 6)[0];
    expect(numbers(best)).toEqual([5, 6, 7, 8]);
  });

  it('breaks ties towards the lower seat number, deterministically', () => {
    // halfway at the boundary of seat 6/7 of a 12-wide row: windows [5,6] and [7,8] tie
    const a = rankWindows(findRuns(grid(1, 12)), 2, rowIndex, 6)
      .slice(0, 3)
      .map(numbers);
    expect(a[0]).toEqual([6, 7]);
    const b = rankWindows(findRuns(grid(1, 12)), 2, rowIndex, 6)
      .slice(0, 3)
      .map(numbers);
    expect(b).toEqual(a);
    const tie = rankWindows(findRuns(grid(1, 12)), 2, rowIndex, 6);
    expect(tie[1].cost).toBe(tie[2].cost);
    expect(numbers(tie[1])).toEqual([5, 6]);
  });

  it('numeric row order decides "front" with ten or more rows', () => {
    const rowOrder = (row: string): number => Number(row) - 1;
    const best = rankWindows(findRuns(grid(16, 4)), 2, rowOrder, 2)[0];
    expect(best.row).toBe('1');
  });

  it('never offers a window across an aisle', () => {
    expect(rankWindows(findRuns(grid(1, 28)), 16, rowIndex, 14)).toEqual([]);
  });
});

describe('bestSplit', () => {
  it('prefers an even split: 4 people as 2+2 before 3+1', () => {
    // row 1: runs of 3 and 2 (seat 4 taken, seat 5 taken... ) -> build runs 3 + 2 + 1
    const taken = ['1:4', '1:7'];
    const runs = findRuns(grid(1, 9, taken)); // runs: 1-3, 5-6, 8-9
    const split = bestSplit(runs, 4, rowIndex, 5)!;
    expect(split.windows.map((w) => w.seats.length).sort()).toEqual([2, 2]);
  });

  it('falls back to 3+1 when only that exists', () => {
    const runs = findRuns(grid(1, 9, ['1:4', '1:6', '1:7', '1:8'])); // 1-3, 5, 9
    const split = bestSplit(runs, 4, rowIndex, 5)!;
    expect(split.windows.map((w) => w.seats.length).sort()).toEqual([1, 3]);
  });

  it('takes the two windows from different runs', () => {
    const runs = findRuns(grid(1, 9, ['1:4', '1:6'])); // 1-3, 5, 7-9
    const split = bestSplit(runs, 5, rowIndex, 5)!;
    expect(new Set(split.windows.flatMap((w) => w.seats.map((s) => s.id))).size).toBe(5);
  });

  it('is null when two runs cannot seat the party', () => {
    // runs of 2,2,2 - 6 people would need three
    const runs = findRuns(grid(1, 8, ['1:3', '1:6']));
    expect(runs.map((r) => r.seats.length)).toEqual([2, 2, 2]);
    expect(bestSplit(runs, 6, rowIndex, 4)).toBeNull();
  });

  it('is null for one person', () => {
    expect(bestSplit(findRuns(grid(1, 4)), 1, rowIndex, 2)).toBeNull();
  });
});
