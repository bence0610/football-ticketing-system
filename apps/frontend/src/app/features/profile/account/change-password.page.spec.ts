import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { AuthResponse, AuthUser } from '../../../shared/models/auth.model';
import { ChangePasswordPageComponent } from './change-password.page';

const USER: AuthUser = {
  id: 'u-1',
  email: 'bela@kte.hu',
  firstName: 'Béla',
  lastName: 'Kovács',
  role: 'fan',
  loyaltyTier: 'bronze',
  loyaltyPoints: 0,
};

function fail(status: number, error: Record<string, unknown>): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { statusCode: status, ...error } });
}

describe('ChangePasswordPageComponent', () => {
  let fixture: ComponentFixture<ChangePasswordPageComponent>;
  let auth: { changePassword: jasmine.Spy; user: ReturnType<typeof signal<AuthUser | null>> };

  const el = () => fixture.nativeElement as HTMLElement;
  const input = (id: string) => el().querySelector<HTMLInputElement>(`#${id}`)!;
  const type = (id: string, value: string) => {
    const i = input(id);
    i.value = value;
    i.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submit = () => {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();
  };
  const fill = () => {
    type('cp-current', 'Jelszo123');
    type('cp-new', 'UjJelszo456');
  };
  const errorOf = (id: string) => el().querySelector(`#${id}`)?.textContent ?? '';

  beforeEach(async () => {
    auth = { changePassword: jasmine.createSpy('changePassword'), user: signal<AuthUser | null>(USER) };
    await TestBed.configureTestingModule({
      imports: [ChangePasswordPageComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: AuthService, useValue: auth }],
    }).compileComponents();
    fixture = TestBed.createComponent(ChangePasswordPageComponent);
    fixture.detectChanges();
  });

  it('has the title, a way back to the profile, and correct autocomplete hints', () => {
    expect(el().querySelector('h1')!.textContent).toContain('Jelszó módosítása');
    expect(el().querySelector('[data-testid="back-to-profile"]')!.getAttribute('href')).toBe('/profile');
    expect(input('cp-current').getAttribute('autocomplete')).toBe('current-password');
    expect(input('cp-new').getAttribute('autocomplete')).toBe('new-password');
    const username = el().querySelector<HTMLInputElement>('input[autocomplete="username"]')!;
    expect(username.value).toBe('bela@kte.hu');
    // Registration has no confirm field, so neither does this form.
    expect(el().querySelectorAll('input[type="password"]').length).toBe(2);
  });

  describe('uses the registration rule and meter', () => {
    const meter = () => el().querySelector('[data-testid="strength"]')!;

    it('states the same rule line as registration', () => {
      expect(el().querySelector('[data-testid="password-rule"]')!.textContent).toContain(
        'Legalább 8 karakter, benne legalább egy betű (a–z) és egy szám.',
      );
    });

    it('a password the server rejects is never green', () => {
      for (const pw of ['12345678', 'abcdefgh', 'abc1234']) {
        type('cp-new', pw);
        expect(meter().getAttribute('data-level')).toBe('rejected');
        expect(meter().querySelectorAll('.meter__seg--on').length).toBeLessThanOrEqual(2);
      }
      type('cp-new', 'Jelszo123');
      expect(meter().getAttribute('data-level')).toBe('accepted');
      type('cp-new', 'Jelszo123456');
      expect(meter().getAttribute('data-level')).toBe('long');
    });

    it('does not send a new password the rule refuses, and says which rule is missing', () => {
      type('cp-current', 'Jelszo123');
      type('cp-new', 'abcdefgh');
      submit();
      expect(auth.changePassword).not.toHaveBeenCalled();
      expect(errorOf('cp-new-err')).toContain('szám');
    });
  });

  it('an empty submit marks both fields and sends nothing', () => {
    submit();
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(errorOf('cp-current-err')).toContain('jelenlegi jelszavadat');
    expect(errorOf('cp-new-err')).toContain('Adj meg egy jelszót');
  });

  it('the same password twice is refused before any call', () => {
    type('cp-current', 'Jelszo123');
    type('cp-new', 'Jelszo123');
    submit();
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(errorOf('cp-new-err')).toContain('Az új jelszó nem egyezhet a jelenlegivel.');
  });

  it('shows the loading state while saving', () => {
    auth.changePassword.and.returnValue(new Subject<AuthResponse>());
    fill();
    submit();
    const btn = el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.disabled).toBeTrue();
    expect(btn.textContent).toContain('Mentés…');
  });

  it('on success goes through AuthService (which applies the tokens), says so, and clears the form', () => {
    auth.changePassword.and.returnValue(
      of({ accessToken: 'a', refreshToken: 'r', expiresIn: 900, user: USER } satisfies AuthResponse),
    );
    fill();
    submit();
    expect(auth.changePassword).toHaveBeenCalledOnceWith({
      currentPassword: 'Jelszo123',
      newPassword: 'UjJelszo456',
    });
    expect(el().querySelector('[data-testid="password-changed"]')!.textContent).toContain(
      'A jelszavad megváltozott. Ezen az eszközön bejelentkezve maradsz, a többi eszközről kiléptettünk. Értesítő levelet is küldtünk.',
    );
    expect(input('cp-current').value).toBe('');
    expect(input('cp-new').value).toBe('');
    expect(el().querySelector('#cp-current-err')).toBeNull();
    expect(el().querySelector('[data-testid="strength"]')!.getAttribute('data-level')).toBe('empty');
  });

  it('400 current_password_incorrect is an error at the current-password field (not a sign-out)', () => {
    auth.changePassword.and.returnValue(
      throwError(() => fail(400, { code: 'current_password_incorrect', message: 'Hibás jelszó.' })),
    );
    fill();
    submit();
    expect(errorOf('cp-current-err')).toContain('A jelenlegi jelszó nem megfelelő.');
    expect(input('cp-current').getAttribute('aria-invalid')).toBe('true');
    expect(errorOf('cp-new-err')).toBe('');
    expect(el().querySelector('[data-testid="password-error"]')).toBeNull();
    // ...and it goes away once the field is edited
    type('cp-current', 'Jelszo1234');
    expect(el().querySelector('#cp-current-err')).toBeNull();
  });

  it('400 password_unchanged is an error at the new-password field', () => {
    auth.changePassword.and.returnValue(
      throwError(() => fail(400, { code: 'password_unchanged', message: 'x' })),
    );
    fill();
    submit();
    expect(errorOf('cp-new-err')).toContain('Az új jelszó nem egyezhet a jelenlegivel.');
    expect(el().querySelector('#cp-current-err')).toBeNull();
  });

  it('a 400 validation message about the new password lands at that field', () => {
    auth.changePassword.and.returnValue(
      throwError(() => fail(400, { message: ['A jelszó legalább 8 karakter legyen.'] })),
    );
    fill();
    submit();
    expect(errorOf('cp-new-err')).toContain('A jelszó legalább 8 karakter legyen.');
    expect(el().querySelector('[data-testid="password-error"]')).toBeNull();
  });

  it('a "current password" validation message in the server wording lands at that field', () => {
    auth.changePassword.and.returnValue(
      throwError(() => fail(400, { message: ['Add meg a jelenlegi jelszavad.'] })),
    );
    fill();
    submit();
    expect(errorOf('cp-current-err')).toContain('Add meg a jelenlegi jelszavad.');
    expect(errorOf('cp-new-err')).toBe('');
  });

  it('409 password_changed_concurrently shows the server message in the error block', () => {
    auth.changePassword.and.returnValue(
      throwError(() =>
        fail(409, {
          code: 'password_changed_concurrently',
          message: 'A jelszavad közben megváltozott. Töltsd újra az oldalt, és próbáld újra.',
        }),
      ),
    );
    fill();
    submit();
    expect(el().querySelector('[data-testid="password-error"]')!.textContent).toContain('közben megváltozott');
  });

  it('429 is the plain rate-limit message', () => {
    auth.changePassword.and.returnValue(
      throwError(() => fail(429, { code: 'rate_limited', message: 'ThrottlerException: Too Many Requests' })),
    );
    fill();
    submit();
    expect(el().querySelector('[data-testid="password-error"]')!.textContent!.trim()).toBe(
      'Túl sok próbálkozás. Próbáld újra később.',
    );
  });

  it('fits 360px: no horizontal overflow and every control is at least 44px tall', () => {
    const host = el();
    host.style.display = 'block';
    host.style.width = '360px';
    fixture.detectChanges();
    expect(host.isConnected).toBeTrue();
    expect(host.scrollWidth).toBeLessThanOrEqual(360);
    const targets = host.querySelectorAll<HTMLElement>(
      '.kte-field__box, .kte-field__toggle, button[type="submit"], [data-testid="back-to-profile"]',
    );
    expect(targets.length).toBe(6);
    for (const c of Array.from(targets)) {
      expect(c.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
