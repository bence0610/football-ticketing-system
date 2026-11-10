import { passwordChecks, passwordStrength } from './password-rules';

/**
 * The same table is asserted against the real server DTO in
 * apps/backend/src/modules/auth/dto/register.dto.spec.ts. If one side changes
 * and the other does not, one of the two specs fails.
 */
export const PASSWORD_CASES: ReadonlyArray<[string, boolean]> = [
  ['abcdefg1', true],
  ['Jelszo123', true],
  ['12345678', false], // no letter
  ['abcdefgh', false], // no digit
  ['abc1234', false], // 7 characters
  ['éáőűíóüö12', false], // accented letters only: the server's check is ASCII a-z
  ['é1abcdefg', true],
  [`a1${'x'.repeat(70)}`, true], // 72
  [`a1${'x'.repeat(71)}`, false], // 73
  ['', false],
];

describe('password rules', () => {
  for (const [pw, ok] of PASSWORD_CASES) {
    it(`${ok ? 'accepts' : 'rejects'} ${JSON.stringify(pw.length > 20 ? pw.slice(0, 6) + '…' : pw)}`, () => {
      expect(passwordChecks(pw).accepted).toBe(ok);
    });
  }

  describe('strength meter', () => {
    it('is empty for nothing', () => {
      expect(passwordStrength('')).toEqual(jasmine.objectContaining({ segments: 0, level: 'empty' }));
    });

    it('never fills more than two segments, or says it is fine, for a password the server rejects', () => {
      for (const [pw, ok] of PASSWORD_CASES) {
        if (ok || !pw) continue;
        const s = passwordStrength(pw);
        expect(s.level).toBe('rejected');
        expect(s.segments).toBeLessThanOrEqual(2);
      }
    });

    it('fills three for an accepted password and four only from 12 characters', () => {
      expect(passwordStrength('abcdefg1').segments).toBe(3);
      expect(passwordStrength('abcdefg1').level).toBe('accepted');
      expect(passwordStrength('abcdefghij12').segments).toBe(4);
      expect(passwordStrength('abcdefghij12').level).toBe('long');
    });

    it('a long password with no digit is still rejected, not strong', () => {
      const s = passwordStrength('abcdefghijklmnopqrstuvwxyz');
      expect(s.level).toBe('rejected');
      expect(s.segments).toBeLessThanOrEqual(2);
    });
  });
});
