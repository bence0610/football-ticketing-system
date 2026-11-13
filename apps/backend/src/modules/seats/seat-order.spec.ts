import { compareRows, compareSeats } from './seat-order';

describe('row ordering', () => {
  it('compares rows as numbers, so row 10 comes after row 2 (a string sort puts it before)', () => {
    const rows = ['10', '2', '1', '16', '9', '11'];
    expect([...rows].sort()).toEqual(['1', '10', '11', '16', '2', '9']); // the bug
    expect([...rows].sort(compareRows)).toEqual(['1', '2', '9', '10', '11', '16']);
  });

  it('puts a non-numeric row after the numbered ones', () => {
    expect(['B', '3', 'A', '12'].sort(compareRows)).toEqual(['3', '12', 'A', 'B']);
  });
});

describe('seat ordering', () => {
  const position = new Map([
    ['D/1', 1],
    ['C/2', 4],
    ['VENDÉG', 9],
    ['VIP', 15],
  ]);
  const seat = (section: string, row: string, number: number) => ({ section, row, number });

  it('orders by stadium position, then numeric row, then seat number', () => {
    const seats = [
      seat('VIP', '1', 1),
      seat('D/1', '10', 2),
      seat('D/1', '2', 5),
      seat('D/1', '2', 11),
      seat('D/1', '2', 3),
      seat('C/2', '1', 1),
      seat('VENDÉG', '1', 1),
    ];
    const ordered = [...seats].sort(compareSeats(position));
    expect(ordered.map((s) => `${s.section}/${s.row}/${s.number}`)).toEqual([
      'D/1/2/3',
      'D/1/2/5',
      'D/1/2/11',
      'D/1/10/2',
      'C/2/1/1',
      'VENDÉG/1/1',
      'VIP/1/1',
    ]);
  });

  it('is not alphabetical: C/2 (position 4) comes after D/1 (position 1)', () => {
    const ordered = [seat('C/2', '1', 1), seat('D/1', '1', 1)].sort(compareSeats(position));
    expect(ordered[0].section).toBe('D/1');
  });

  it('puts a sector without a position last, by code', () => {
    const ordered = [seat('X', '1', 1), seat('D/1', '1', 1), seat('A', '1', 1)].sort(
      compareSeats(position),
    );
    expect(ordered.map((s) => s.section)).toEqual(['D/1', 'A', 'X']);
  });
});
