import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RequestEmailChangeDto } from './request-email-change.dto';
import { UpdateProfileDto } from './update-profile.dto';

// The global ValidationPipe runs with whitelist + forbidNonWhitelisted.
const PIPE_OPTIONS = { whitelist: true, forbidNonWhitelisted: true };

const errorsFor = (body: Record<string, unknown>, property: string): string[] =>
  validateSync(plainToInstance(UpdateProfileDto, body), PIPE_OPTIONS)
    .filter((e) => e.property === property)
    .flatMap((e) => Object.values(e.constraints ?? {}));

describe('UpdateProfileDto phoneNumber', () => {
  it.each(['+36301234567', '+36 30 123 4567', '06 (30) 123-4567', '123456', '1'.repeat(32)])(
    'accepts %j',
    (phoneNumber) => {
      expect(errorsFor({ phoneNumber }, 'phoneNumber')).toEqual([]);
    },
  );

  it.each(['', null])('accepts %j (clears the number)', (phoneNumber) => {
    expect(errorsFor({ phoneNumber }, 'phoneNumber')).toEqual([]);
  });

  it.each(['12345', '1'.repeat(33), '+36 30 abc 4567', '06/30/1234567', '+36301234567;'])(
    'rejects %j with a Hungarian message',
    (phoneNumber) => {
      const messages = errorsFor({ phoneNumber }, 'phoneNumber');
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.join(' ')).toContain('telefonszám');
    },
  );

  it('rejects a non-string', () => {
    expect(errorsFor({ phoneNumber: 36301234567 }, 'phoneNumber').join(' ')).toContain('szöveg');
  });
});

describe('UpdateProfileDto field set', () => {
  it('accepts exactly firstName, lastName, phoneNumber, dateOfBirth', () => {
    const errors = validateSync(
      plainToInstance(UpdateProfileDto, {
        firstName: 'Béla',
        lastName: 'Kovács',
        phoneNumber: '+36301234567',
        dateOfBirth: '1990-01-15',
      }),
      PIPE_OPTIONS,
    );
    expect(errors).toEqual([]);
  });

  it('refuses email (it changes only through the confirmation flow)', () => {
    const errors = validateSync(
      plainToInstance(UpdateProfileDto, { email: 'uj@pelda.hu' }),
      PIPE_OPTIONS,
    );
    expect(errors.map((e) => e.property)).toEqual(['email']);
  });

  it('names its own field in the name messages', () => {
    expect(errorsFor({ firstName: 'B' }, 'firstName').join(' ')).toContain('keresztnév');
    expect(errorsFor({ lastName: 'K' }, 'lastName').join(' ')).toContain('vezetéknév');
  });

  it('accepts null for the date of birth: that is how a date entered by mistake is cleared', () => {
    const dto = plainToInstance(UpdateProfileDto, { dateOfBirth: null });
    expect(validateSync(dto, PIPE_OPTIONS)).toEqual([]);
    expect(dto.dateOfBirth).toBeNull();
  });

  it('still refuses an empty string for the date of birth (clearing is null, not "")', () => {
    expect(errorsFor({ dateOfBirth: '' }, 'dateOfBirth').length).toBeGreaterThan(0);
  });

  it('refuses an invalid date of birth in Hungarian', () => {
    expect(errorsFor({ dateOfBirth: 'nem-datum' }, 'dateOfBirth').join(' ')).toContain(
      'születési dátum',
    );
  });
});

describe('RequestEmailChangeDto', () => {
  it('trims and lowercases the new address', () => {
    const dto = plainToInstance(RequestEmailChangeDto, {
      newEmail: '  Uj.Cim@Pelda.HU ',
      currentPassword: 'x',
    });
    expect(validateSync(dto, PIPE_OPTIONS)).toEqual([]);
    expect(dto.newEmail).toBe('uj.cim@pelda.hu');
  });

  it('needs a valid address and the current password', () => {
    const errors = validateSync(
      plainToInstance(RequestEmailChangeDto, { newEmail: 'nem-cim', currentPassword: '' }),
      PIPE_OPTIONS,
    );
    expect(errors.map((e) => e.property).sort()).toEqual(['currentPassword', 'newEmail']);
  });
});
