import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { EmailChangeConfirmed, UserProfile } from '../../shared/models/auth.model';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { ConfirmEmailPageComponent } from './confirm-email.page';

const PROFILE = { id: 'u-1', email: 'uj@kte.hu', firstName: 'Béla', lastName: 'Kovács' } as UserProfile;

function fail(status: number, code?: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { statusCode: status, message: 'szerver szövege', ...(code ? { code } : {}) },
  });
}

describe('ConfirmEmailPageComponent', () => {
  let fixture: ComponentFixture<ConfirmEmailPageComponent>;
  let api: jasmine.SpyObj<AuthApiService>;
  let auth: { isAuthenticated: ReturnType<typeof signal<boolean>>; syncProfile: jasmine.Spy };

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string) => el().querySelector<HTMLElement>(sel);

  async function open(
    confirm: Observable<EmailChangeConfirmed>,
    { token = 'tok-1' as string | null, signedIn = false } = {},
  ): Promise<void> {
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', ['confirmEmailChange', 'me']);
    api.confirmEmailChange.and.returnValue(confirm);
    api.me.and.returnValue(of(PROFILE));
    auth = { isAuthenticated: signal(signedIn), syncProfile: jasmine.createSpy('syncProfile') };
    await TestBed.configureTestingModule({
      imports: [ConfirmEmailPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => token } } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ConfirmEmailPageComponent);
    fixture.detectChanges();
  }

  it('confirms on arrival, with no form, and shows the new address', async () => {
    const pending = new Subject<EmailChangeConfirmed>();
    await open(pending);
    expect(q('[data-testid="confirm-checking"]')).not.toBeNull();
    expect(el().querySelector('form, input')).toBeNull();
    expect(api.confirmEmailChange).toHaveBeenCalledOnceWith('tok-1');
    pending.next({ message: 'ok', email: 'uj@kte.hu' });
    fixture.detectChanges();
    expect(q('[data-testid="confirm-done"]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Az új e-mail-címed: uj@kte.hu',
    );
    expect(q('[data-testid="to-login"]')!.getAttribute('href')).toBe('/login');
  });

  it('is built in the shared auth layout', async () => {
    await open(of({ message: 'ok', email: 'uj@kte.hu' }));
    expect(q('.auth__brand')).not.toBeNull();
    expect(q('.auth__form-inner h1')!.textContent).toContain('E-mail-cím megerősítése');
  });

  it('signed out: does not fetch the profile', async () => {
    await open(of({ message: 'ok', email: 'uj@kte.hu' }));
    expect(api.me).not.toHaveBeenCalled();
    expect(auth.syncProfile).not.toHaveBeenCalled();
  });

  it('signed in: refreshes the stored user so the new address shows up, and links to the profile', async () => {
    await open(of({ message: 'ok', email: 'uj@kte.hu' }), { signedIn: true });
    expect(api.me).toHaveBeenCalledTimes(1);
    expect(auth.syncProfile).toHaveBeenCalledOnceWith(PROFILE);
    expect(q('[data-testid="to-profile"]')!.getAttribute('href')).toBe('/profile');
  });

  const refusals: ReadonlyArray<readonly [string, number, string]> = [
    ['email_change_token_expired', 400, 'lejárt'],
    ['email_change_token_used', 400, 'már felhasználták'],
    ['email_change_token_invalid', 400, 'érvénytelen'],
    ['email_change_token_password_changed', 400, 'jelszavad megváltoztatása előtt'],
    ['email_taken', 409, 'másik fiók már használja'],
  ];
  for (const [code, status, words] of refusals) {
    it(`${status} ${code}: says why, and offers a new link from /profile/details`, async () => {
      await open(throwError(() => fail(status, code)));
      expect(q('[data-testid="confirm-refused"]')!.textContent).toContain(words);
      expect(q('[data-testid="confirm-done"]')).toBeNull();
      const link = q('[data-testid="request-again"]')!;
      expect(link.getAttribute('href')).toBe('/profile/details');
      expect(el().textContent).toContain('bejelentkezés után');
    });
  }

  it('signed in, a refusal does not ask to log in first', async () => {
    await open(throwError(() => fail(400, 'email_change_token_expired')), { signedIn: true });
    expect(el().textContent).not.toContain('bejelentkezés után');
    expect(q('[data-testid="request-again"]')).not.toBeNull();
  });

  it('a link with no token is refused without a call', async () => {
    await open(of({ message: 'ok', email: 'x' }), { token: null });
    expect(api.confirmEmailChange).not.toHaveBeenCalled();
    expect(q('[data-testid="confirm-refused"]')!.textContent).toContain('érvénytelen');
  });

  it('no answer from the server can be retried', async () => {
    await open(throwError(() => new HttpErrorResponse({ status: 0 })));
    expect(q('[data-testid="confirm-failed"]')!.textContent).toContain('Nem sikerült elérni a szervert');
    api.confirmEmailChange.and.returnValue(of({ message: 'ok', email: 'uj@kte.hu' }));
    q('[data-testid="confirm-retry"]')!.click();
    fixture.detectChanges();
    expect(api.confirmEmailChange).toHaveBeenCalledTimes(2);
    expect(q('[data-testid="confirm-done"]')).not.toBeNull();
  });
});
