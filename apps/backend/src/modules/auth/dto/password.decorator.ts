import { applyDecorators } from '@nestjs/common';
import {
  IsString,
  Matches,
  MinLength,
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/**
 * bcrypt hashes at most the first 72 BYTES of a password and ignores the rest
 * (and stops at a NUL byte). Counting characters let a long password with accented
 * letters through: "é" is 2 bytes, so 72 characters can be 100+ bytes, the tail was
 * silently dropped, and a different password sharing the first 72 bytes unlocked
 * the same account. The limit is therefore enforced in BYTES (UTF-8), and a
 * password over it is REFUSED, never truncated.
 */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_TOO_LONG_MESSAGE =
  'A jelszó legfeljebb 72 bájt lehet. Az ékezetes betűk 2, egyes jelek (pl. emoji) 4 bájtot foglalnak, ezért ilyen jelszó kevesebb mint 72 karakter után is túl hosszú. Rövidítsd le.';

export const PASSWORD_BYTES_AT_LOGIN_MESSAGE =
  'A jelszó legfeljebb 72 bájt lehet. Ha korábban ennél hosszabb jelszót állítottál be, a rendszer csak az elejét tárolta: állíts be újat az „Elfelejtett jelszó” oldalon.';

/** UTF-8 length, the number bcrypt's 72 limit is about. */
export const passwordByteLength = (value: string): number => Buffer.byteLength(value, 'utf8');

/**
 * Fails a string password that bcrypt could not hash in full: over 72 bytes, or
 * containing a NUL character (bcrypt would stop reading there).
 */
export function IsWithinBcryptLimit(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isWithinBcryptLimit',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: PASSWORD_TOO_LONG_MESSAGE, ...options },
      validator: {
        validate(value: unknown): boolean {
          return (
            typeof value !== 'string' ||
            (passwordByteLength(value) <= PASSWORD_MAX_BYTES && !value.includes('\u0000'))
          );
        },
        defaultMessage(_args: ValidationArguments): string {
          return PASSWORD_TOO_LONG_MESSAGE;
        },
      },
    });
  };
}

/**
 * The one password rule: 8 characters minimum, at most 72 BYTES (UTF-8, see
 * above), at least one letter (a-z, ASCII) and one digit. Registration, password
 * reset and the signed-in password change all use it, so the same password is
 * accepted or refused in all three places - and the strength meter
 * (apps/frontend/src/app/shared/utils/password-rules.ts) describes exactly this.
 * Change it here and there together; the specs pin them to one table.
 */
export function IsAccountPassword(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: 'A jelszó szöveg típusú érték legyen.' }),
    MinLength(8, { message: 'A jelszónak legalább 8 karakteresnek kell lennie.' }),
    IsWithinBcryptLimit(),
    Matches(/(?=.*[A-Za-z])(?=.*\d).+/, {
      message: 'A jelszó tartalmazzon legalább egy betűt és egy számot.',
    }),
  );
}
