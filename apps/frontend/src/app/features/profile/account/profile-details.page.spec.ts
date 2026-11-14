import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { UserProfile } from '../../../shared/models/auth.model';
import { AuthApiService } from '../../../shared/services/auth.api.service';
import { ProfileDetailsPageComponent } from './profile-details.page';

const PROFILE: UserProfile = {
  id: 'u-1',
  email: 'bela@kte.hu',
  firstName: 'Béla',
  lastName: 'Kovács',
  phoneNumber: '+36301234567',
  dateOfBirth: '1990-01-15',
  role: 'fan',
  loyaltyTier: 'bronze',
  loyaltyPoints: 0,
  emailVerified: true,
  twoFactorEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function fail(status: number, error: Record<string, unknown>): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { statusCode: status, ...error } });
}

describe('ProfileDetailsPageComponent', () => {
  let fixture: ComponentFixture<ProfileDetailsPageComponent>;
  let api: jasmine.SpyObj<AuthApiService>;
  let auth: jasmine.SpyObj<AuthService>;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string) => el().querySelector<HTMLElement>(sel);
  const input = (id: string) => el().querySelector<HTMLInputElement>(`#${id}`)!;
  const type = (id: string, value: string) => {
    const i = input(id);
    i.value = value;
    i.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const blur = (id: string) => {
    input(id).dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const submit = (form: 'details-form' | 'email-form') => {
    q(`[data-testid="${form}"] button[type="submit"]`)!.click();
    fixture.detectChanges();
  };
  const text = (sel: string) => q(sel)?.textContent?.trim() ?? '';

  async function open(me: Observable<UserProfile> = of(PROFILE)): Promise<void> {
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', [
      'me',
      'updateProfile',
      'requestEmailChange',
    ]);
    api.me.and.returnValue(me);
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['syncProfile']);
    await TestBed.configureTestingModule({
      imports: [ProfileDetailsPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthApiService, useValue: api },
        { provide: AuthService, useValue: auth },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfileDetailsPageComponent);
    fixture.detectChanges();
  }

  describe('personal details', () => {
    it('shows a loading state, then the four fields prefilled from GET /users/me', async () => {
      const pending = new Subject<UserProfile>();
      await open(pending);
      expect(q('[data-testid="details-loading"]')).not.toBeNull();
      pending.next(PROFILE);
      fixture.detectChanges();
      expect(q('h1')!.textContent).toContain('Adataim szerkesztése');
      expect(input('pd-last').value).toBe('Kovács');
      expect(input('pd-first').value).toBe('Béla');
      expect(input('pd-phone').value).toBe('+36301234567');
      expect(input('pd-birth').value).toBe('1990-01-15');
      expect(input('pd-phone').getAttribute('autocomplete')).toBe('tel');
      expect(input('pd-phone').type).toBe('tel');
      expect(input('pd-birth').type).toBe('date');
    });

    it('a failed load says so and can be retried', async () => {
      await open(throwError(() => fail(500, { message: 'x' })));
      expect(q('[data-testid="details-load-error"]')).not.toBeNull();
      api.me.and.returnValue(of(PROFILE));
      (el().querySelector('button.kte-auth-secondary') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(input('pd-first').value).toBe('Béla');
    });

    it('saves exactly the four editable fields; an emptied phone is sent as "" to clear it', async () => {
      await open();
      const saved: UserProfile = { ...PROFILE, firstName: 'Bence', phoneNumber: undefined };
      api.updateProfile.and.returnValue(of(saved));
      type('pd-first', 'Bence');
      type('pd-phone', '');
      submit('details-form');
      expect(api.updateProfile).toHaveBeenCalledOnceWith({
        firstName: 'Bence',
        lastName: 'Kovács',
        phoneNumber: '',
        dateOfBirth: '1990-01-15',
      });
      expect(text('[data-testid="details-saved"]')).toBe('Mentve.');
      expect(auth.syncProfile).toHaveBeenCalledOnceWith(saved);
      expect(input('pd-phone').value).toBe('');
      // "Mentve." is about the saved values: typing again takes it away
      type('pd-first', 'Bence2');
      expect(q('[data-testid="details-saved"]')).toBeNull();
    });

    it('an empty birth date is left out of the request', async () => {
      await open(of({ ...PROFILE, dateOfBirth: undefined }));
      api.updateProfile.and.returnValue(of(PROFILE));
      submit('details-form');
      expect(api.updateProfile.calls.mostRecent().args[0]).toEqual({
        firstName: 'Béla',
        lastName: 'Kovács',
        phoneNumber: '+36301234567',
      });
    });

    it('emptying a saved birth date sends null, which clears it; once cleared, it is left out again', async () => {
      await open();
      const cleared: UserProfile = { ...PROFILE, dateOfBirth: undefined };
      api.updateProfile.and.returnValue(of(cleared));
      type('pd-birth', '');
      submit('details-form');
      expect(api.updateProfile.calls.mostRecent().args[0]).toEqual({
        firstName: 'Béla',
        lastName: 'Kovács',
        phoneNumber: '+36301234567',
        dateOfBirth: null,
      });
      expect(input('pd-birth').value).toBe('');

      // the saved profile has no date any more: a later save sends nothing about it
      api.updateProfile.and.returnValue(of(cleared));
      type('pd-first', 'Bence');
      submit('details-form');
      expect(api.updateProfile.calls.mostRecent().args[0]).toEqual({
        firstName: 'Bence',
        lastName: 'Kovács',
        phoneNumber: '+36301234567',
      });
    });

    it('client-side rules stop a bad value before any call', async () => {
      await open();
      type('pd-first', 'B');
      type('pd-birth', '2999-01-01');
      submit('details-form');
      expect(api.updateProfile).not.toHaveBeenCalled();
      expect(text('#pd-first-err')).toContain('Legalább 2');
      expect(text('#pd-birth-err')).toContain('jövőben');
    });

    it('shows a field error only after the field is left', async () => {
      await open();
      type('pd-phone', 'abc');
      expect(text('#pd-phone-msg [role="alert"]')).toBe('');
      blur('pd-phone');
      expect(text('#pd-phone-msg [role="alert"]')).toContain('csak számjegyet');
      type('pd-phone', '12345');
      expect(text('#pd-phone-msg [role="alert"]')).toContain('6-32 karakter');
      type('pd-phone', '+36 (30) 123-4567');
      expect(text('#pd-phone-msg [role="alert"]')).toBe('');
    });

    it('a 400 validation body is spread onto the fields it names; the rest goes to the error block', async () => {
      await open();
      api.updateProfile.and.returnValue(
        throwError(() =>
          fail(400, {
            message: [
              'A telefonszám legfeljebb 32 karakter lehet.',
              'dateOfBirth must be a Date instance',
              'Valami egészen más.',
            ],
          }),
        ),
      );
      submit('details-form');
      expect(text('#pd-phone-msg [role="alert"]')).toBe('A telefonszám legfeljebb 32 karakter lehet.');
      expect(text('#pd-birth-err')).toBe('dateOfBirth must be a Date instance');
      expect(q('#pd-first-err')).toBeNull();
      expect(text('[data-testid="details-error"]')).toBe('Valami egészen más.');
      expect(input('pd-phone').getAttribute('aria-invalid')).toBe('true');
      type('pd-phone', '+3630');
      expect(text('#pd-phone-msg [role="alert"]')).toBe('');
    });

    it('429 is the plain rate-limit message', async () => {
      await open();
      api.updateProfile.and.returnValue(throwError(() => fail(429, { code: 'rate_limited', message: 'x' })));
      submit('details-form');
      expect(text('[data-testid="details-error"]')).toBe('Túl sok próbálkozás. Próbáld újra később.');
    });
  });

  describe('e-mail address', () => {
    const fillEmail = (email = 'uj@kte.hu', password = 'Jelszo123') => {
      type('pd-new-email', email);
      type('pd-email-password', password);
    };

    it('shows the current address read-only, and help that says the account keeps everything', async () => {
      await open();
      expect(text('[data-testid="current-email"]')).toContain('bela@kte.hu');
      expect(el().querySelector('[data-testid="current-email"] input')).toBeNull();
      const help = text('[data-testid="email-help"]');
      expect(help).toContain('csak akkor változik meg, ha azt megnyitod');
      for (const word of ['jegyeid', 'bérleteid', 'hűségpontjaid', 'meghívóid', 'megmaradnak']) {
        expect(help).toContain(word);
      }
      expect(input('pd-new-email').getAttribute('autocomplete')).toBe('email');
      expect(input('pd-email-password').getAttribute('autocomplete')).toBe('current-password');
    });

    it('after 202 shows the waiting message with the pending address; the current one is unchanged', async () => {
      await open();
      api.requestEmailChange.and.returnValue(of({ message: 'ok', pendingEmail: 'uj@kte.hu' }));
      fillEmail();
      submit('email-form');
      expect(api.requestEmailChange).toHaveBeenCalledOnceWith({
        newEmail: 'uj@kte.hu',
        currentPassword: 'Jelszo123',
      });
      expect(text('[data-testid="email-pending"]')).toBe(
        'Elküldtünk egy megerősítő levelet a uj@kte.hu címre. A cím addig nem változik, amíg meg nem erősíted, és a régi címre is értesítést küldtünk.',
      );
      expect(text('[data-testid="current-email"]')).toContain('bela@kte.hu');
      expect(q('[data-testid="email-form"]')).toBeNull();
      expect(auth.syncProfile).not.toHaveBeenCalled();
    });

    it('a pending change on load shows the waiting state, with a way to send again', async () => {
      await open(of({ ...PROFILE, pendingEmail: 'var@kte.hu' }));
      expect(text('[data-testid="email-pending"]')).toContain('a var@kte.hu címre');
      q('[data-testid="email-resend"]')!.click();
      fixture.detectChanges();
      expect(input('pd-new-email').value).toBe('var@kte.hu');
      api.requestEmailChange.and.returnValue(of({ message: 'ok', pendingEmail: 'var@kte.hu' }));
      type('pd-email-password', 'Jelszo123');
      submit('email-form');
      expect(api.requestEmailChange).toHaveBeenCalledOnceWith({
        newEmail: 'var@kte.hu',
        currentPassword: 'Jelszo123',
      });
      expect(q('[data-testid="email-pending"]')).not.toBeNull();
    });

    it('the current address itself is refused before any call', async () => {
      await open();
      fillEmail('BELA@kte.hu');
      submit('email-form');
      expect(api.requestEmailChange).not.toHaveBeenCalled();
      expect(text('#pd-new-email-err')).toContain('Ez a jelenlegi e-mail-címed');
    });

    const cases: ReadonlyArray<readonly [string, number, string, string]> = [
      ['current_password_incorrect', 400, 'pd-email-password-msg', 'A jelenlegi jelszó nem megfelelő.'],
      ['email_unchanged', 400, 'pd-new-email-err', 'Ez a jelenlegi e-mail-címed. Adj meg egy másikat.'],
      ['email_taken', 409, 'pd-new-email-err', 'Ehhez az e-mail-címhez már tartozik fiók.'],
    ];
    for (const [code, status, target, message] of cases) {
      it(`${status} ${code} is an error at the right field`, async () => {
        await open();
        api.requestEmailChange.and.returnValue(throwError(() => fail(status, { code, message: 'szerver' })));
        fillEmail();
        submit('email-form');
        expect(text(`#${target}`)).toContain(message);
        expect(q('[data-testid="email-error"]')).toBeNull();
        expect(q('[data-testid="email-pending"]')).toBeNull();
      });
    }

    it('a validation message about the current password (server wording) lands at that field', async () => {
      await open();
      api.requestEmailChange.and.returnValue(
        throwError(() => fail(400, { message: ['Add meg a jelenlegi jelszavad.'] })),
      );
      fillEmail();
      submit('email-form');
      expect(text('#pd-email-password-msg')).toContain('Add meg a jelenlegi jelszavad.');
      expect(q('[data-testid="email-error"]')).toBeNull();
    });

    it('429 is the plain rate-limit message', async () => {
      await open();
      api.requestEmailChange.and.returnValue(throwError(() => fail(429, { message: 'x' })));
      fillEmail();
      submit('email-form');
      expect(text('[data-testid="email-error"]')).toBe('Túl sok próbálkozás. Próbáld újra később.');
    });
  });

  it('fits 360px: no horizontal overflow and every control is at least 44px tall', async () => {
    await open();
    const host = el();
    host.style.display = 'block';
    host.style.width = '360px';
    fixture.detectChanges();
    expect(host.isConnected).toBeTrue();
    expect(host.scrollWidth).toBeLessThanOrEqual(360);
    const targets = host.querySelectorAll<HTMLElement>(
      '.kte-field__box, .kte-field__toggle, button[type="submit"], [data-testid="back-to-profile"]',
    );
    expect(targets.length).toBe(10);
    for (const c of Array.from(targets)) {
      expect(c.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
