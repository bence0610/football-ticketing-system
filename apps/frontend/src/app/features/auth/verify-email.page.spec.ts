import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { EmailVerified, UserProfile } from '../../shared/models/auth.model';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { VerifyEmailPageComponent } from './verify-email.page';

const PROFILE = { id: 'u-1', email: 'uj@kte.hu', firstName: 'Béla', lastName: 'Kovács' } as UserProfile;

function fail(status: number, code?: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    error: { statusCode: status, message: 'szerver szövege', ...(code ? { code } : {}) },
  });
}

describe('VerifyEmailPageComponent', () => {
  let fixture: ComponentFixture<VerifyEmailPageComponent>;
  let api: jasmine.SpyObj<AuthApiService>;
  let auth: { isAuthenticated: ReturnType<typeof signal<boolean>>; syncProfile: jasmine.Spy };

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string) => el().querySelector<HTMLElement>(sel);

  async function open(
    verify: Observable<EmailVerified>,
    { token = 'tok-1' as string | null, signedIn = false } = {},
  ): Promise<void> {
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', ['verifyEmail', 'me']);
    api.verifyEmail.and.returnValue(verify);
    api.me.and.returnValue(of(PROFILE));
    auth = { isAuthenticated: signal(signedIn), syncProfile: jasmine.createSpy('syncProfile') };
    await TestBed.configureTestingModule({
      imports: [VerifyEmailPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => token } } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(VerifyEmailPageComponent);
    fixture.detectChanges();
  }

  it('verifies on arrival, with no form, and says what the verified address unlocks', async () => {
    const pending = new Subject<EmailVerified>();
    await open(pending);
    expect(q('[data-testid="verify-checking"]')).not.toBeNull();
    expect(el().querySelector('form, input')).toBeNull();
    expect(api.verifyEmail).toHaveBeenCalledOnceWith('tok-1');
    pending.next({ message: 'ok', email: 'uj@kte.hu' });
    fixture.detectChanges();
    expect(q('[data-testid="verify-done"]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Megerősítettük az e-mail-címedet: uj@kte.hu',
    );
    expect(el().textContent).toContain('bérletkölcsön-meghívókat');
    expect(q('[data-testid="to-login"]')!.getAttribute('href')).toBe('/login');
  });

  it('refreshes the stored profile when someone is signed in', async () => {
    await open(of({ message: 'ok', email: 'uj@kte.hu' }), { signedIn: true });
    expect(api.me).toHaveBeenCalled();
    expect(auth.syncProfile).toHaveBeenCalledWith(PROFILE);
    expect(q('[data-testid="to-profile"]')).not.toBeNull();
  });

  for (const [code, text] of [
    ['verification_token_invalid', 'érvénytelen'],
    ['verification_token_used', 'már felhasználták'],
    ['verification_token_expired', 'lejárt'],
  ] as const) {
    it(`words the refusal ${code}`, async () => {
      await open(throwError(() => fail(400, code)));
      expect(q('[data-testid="verify-refused"]')!.textContent).toContain(text);
      expect(q('[data-testid="request-again"]')).not.toBeNull();
    });
  }

  it('a missing token is refused without asking the server', async () => {
    await open(of({ message: 'ok', email: 'x' }), { token: null });
    expect(api.verifyEmail).not.toHaveBeenCalled();
    expect(q('[data-testid="verify-refused"]')).not.toBeNull();
  });

  it('a network failure can be retried (the link may still be good)', async () => {
    await open(throwError(() => fail(0)));
    expect(q('[data-testid="verify-failed"]')).not.toBeNull();
    api.verifyEmail.and.returnValue(of({ message: 'ok', email: 'uj@kte.hu' }));
    q('[data-testid="verify-retry"]')!.click();
    fixture.detectChanges();
    expect(q('[data-testid="verify-done"]')).not.toBeNull();
  });
});
