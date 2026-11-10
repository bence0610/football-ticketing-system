import { formatFullName } from './format-name';

describe('formatFullName', () => {
  it('puts the family name first', () => {
    expect(formatFullName({ firstName: 'Béla', lastName: 'Kovács' })).toBe('Kovács Béla');
  });

  it('copes with a missing part or stray spaces, never printing "undefined"', () => {
    expect(formatFullName({ firstName: ' Béla ', lastName: '' })).toBe('Béla');
    expect(formatFullName({ firstName: null, lastName: 'Kovács' })).toBe('Kovács');
    expect(formatFullName({})).toBe('');
  });
});
