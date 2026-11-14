import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { RequestEmailChangeDto } from '../../users/dto/request-email-change.dto';
import { ChangePasswordDto } from './change-password.dto';
import { LoginDto } from './login.dto';

/**
 * Anything that is COMPARED with a stored hash obeys the same 72-byte limit: bcrypt
 * would compare only the first 72 bytes, so a longer text would match a password it
 * is not. A refusal with a way out (reset the password) beats a silent prefix match.
 */
const atLimit = `a1${'é'.repeat(35)}`; // 72 bytes
const overLimit = `a1${'é'.repeat(36)}`; // 74 bytes, 38 characters

const messagesOf = (errors: ReturnType<typeof validateSync>, property: string): string[] =>
  errors.filter((e) => e.property === property).flatMap((e) => Object.values(e.constraints ?? {}));

describe('72-byte limit on a password that is compared', () => {
  it('login accepts 72 bytes and refuses 74, pointing to the password reset', () => {
    const ok = validateSync(plainToInstance(LoginDto, { email: 'fan@kte.hu', password: atLimit }));
    expect(messagesOf(ok, 'password')).toEqual([]);
    const bad = validateSync(plainToInstance(LoginDto, { email: 'fan@kte.hu', password: overLimit }));
    expect(messagesOf(bad, 'password').join(' ')).toContain('Elfelejtett jelszó');
  });

  it('the current password of a change and of an e-mail change obey it too', () => {
    const change = (currentPassword: string) =>
      validateSync(plainToInstance(ChangePasswordDto, { currentPassword, newPassword: 'Jelszo123' }));
    expect(messagesOf(change(atLimit), 'currentPassword')).toEqual([]);
    expect(messagesOf(change(overLimit), 'currentPassword').join(' ')).toContain('72 bájt');

    const email = (currentPassword: string) =>
      validateSync(plainToInstance(RequestEmailChangeDto, { newEmail: 'uj@kte.hu', currentPassword }));
    expect(messagesOf(email(atLimit), 'currentPassword')).toEqual([]);
    expect(messagesOf(email(overLimit), 'currentPassword').join(' ')).toContain('72 bájt');
  });
});
