import { maskEmail } from './mask-email';

describe('maskEmail', () => {
  it.each([
    ['janos@domain.hu', 'j***@d***.hu'],
    ['j@d.hu', 'j***@d***.hu'],
    ['kovacs.bela@mail.example.com', 'k***@m***.com'],
    ['user@localhost', 'u***@l***'],
  ])('%s -> %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it('never echoes a malformed value', () => {
    expect(maskEmail('nincs-kukac')).toBe('***');
    expect(maskEmail('@domain.hu')).toBe('***');
    expect(maskEmail('valaki@')).toBe('***');
  });
});
