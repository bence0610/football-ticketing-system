import { extractTicketId } from './ticket-token';

const b64url = (o: unknown): string =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('extractTicketId', () => {
  it('reads the subject of a JWT-shaped token', () => {
    expect(extractTicketId(`h.${b64url({ sub: 't-1' })}.s`)).toBe('t-1');
  });
  it('tolerates surrounding whitespace from a paste', () => {
    expect(extractTicketId(`  h.${b64url({ sub: 't-1' })}.s\n`)).toBe('t-1');
  });
  it('rejects text that is not a token', () => {
    expect(extractTicketId('hello')).toBeNull();
    expect(extractTicketId('a.b')).toBeNull();
    expect(extractTicketId(`h.${b64url({ nope: 1 })}.s`)).toBeNull();
    expect(extractTicketId('h.%%%.s')).toBeNull();
  });
});
