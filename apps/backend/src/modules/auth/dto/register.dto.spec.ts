import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RegisterDto } from './register.dto';

/**
 * The password cases the registration page's strength meter is built on
 * (apps/frontend/src/app/shared/utils/password-rules.spec.ts uses the same
 * table). Here the real DTO decides.
 */
const CASES: ReadonlyArray<[string, boolean]> = [
  ['abcdefg1', true],
  ['Jelszo123', true],
  ['12345678', false],
  ['abcdefgh', false],
  ['abc1234', false],
  ['éáőűíóüö12', false],
  ['é1abcdefg', true],
  [`a1${'x'.repeat(70)}`, true],
  [`a1${'x'.repeat(71)}`, false],
  ['', false],
];

describe('RegisterDto password rule', () => {
  for (const [password, ok] of CASES) {
    it(`${ok ? 'accepts' : 'rejects'} ${JSON.stringify(password.length > 20 ? password.slice(0, 6) + '…' : password)}`, () => {
      const dto = plainToInstance(RegisterDto, {
        email: 'fan@kte.hu',
        password,
        firstName: 'Béla',
        lastName: 'Kovács',
      });
      const failed = validateSync(dto).some((e) => e.property === 'password');
      expect(failed).toBe(!ok);
    });
  }
});

/**
 * firstName is the Keresztnév and lastName the Vezetéknév (the registration form
 * and the profile both read them that way); each message must name its own field.
 */
describe('RegisterDto name messages', () => {
  const messagesFor = (property: 'firstName' | 'lastName'): string[] => {
    const dto = plainToInstance(RegisterDto, {
      email: 'fan@kte.hu',
      password: 'Jelszo123',
      firstName: property === 'firstName' ? 'B' : 'Béla',
      lastName: property === 'lastName' ? 'K' : 'Kovács',
    });
    return validateSync(dto)
      .filter((e) => e.property === property)
      .flatMap((e) => Object.values(e.constraints ?? {}));
  };

  it('firstName errors say keresztnév, never vezetéknév', () => {
    const messages = messagesFor('firstName').join(' ');
    expect(messages).toContain('keresztnév');
    expect(messages).not.toContain('vezetéknév');
  });

  it('lastName errors say vezetéknév, never keresztnév', () => {
    const messages = messagesFor('lastName').join(' ');
    expect(messages).toContain('vezetéknév');
    expect(messages).not.toContain('keresztnév');
  });
});
