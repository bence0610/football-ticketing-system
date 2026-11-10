import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * The one password rule: 8-72 characters, at least one letter (a-z, ASCII) and
 * one digit. Registration and password reset both use it, so the same password
 * is accepted or refused in both places - and the registration page's strength
 * meter (apps/frontend/src/app/shared/utils/password-rules.ts) describes exactly
 * this. Change it here and there together; the spec pins them to one table.
 */
export function IsAccountPassword(): PropertyDecorator {
  return applyDecorators(
    IsString({ message: 'A jelszó szöveg típusú érték legyen.' }),
    MinLength(8, { message: 'A jelszónak legalább 8 karakteresnek kell lennie.' }),
    MaxLength(72, { message: 'A jelszó legfeljebb 72 karakter lehet.' }),
    Matches(/(?=.*[A-Za-z])(?=.*\d).+/, {
      message: 'A jelszó tartalmazzon legalább egy betűt és egy számot.',
    }),
  );
}
