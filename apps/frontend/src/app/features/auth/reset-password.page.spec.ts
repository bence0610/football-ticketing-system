import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { ResetPasswordPageComponent } from './reset-password.page';

function refusal(code: string, message: string): HttpErrorResponse {
  return new HttpErrorResponse({ status: 400, error: { statusCode: 400, code, message } });
}

describe('ResetPasswordPageComponent', () => {
  let fixture: ComponentFixture<ResetPasswordPageComponent>;
  let api: jasmine.SpyObj<AuthApiService>;

  const el = () => fixture.nativeElement as HTMLElement;
  const type = (value: string) => {
    const i = el().querySelector<HTMLInputElement>('#reset-password')!;
    i.value = value;
    i.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submit = () => {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();
  };

  async function open(token: string | null = 'tok-abc', check = of(undefined as void)): Promise<void> {
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', [
      'checkPasswordResetToken',
      'resetPassword',
    ]);
    api.checkPasswordResetToken.and.returnValue(check);
    await TestBed.configureTestingModule({
      imports: [ResetPasswordPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => token } } },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ResetPasswordPageComponent);
    fixture.detectChanges();
  }

  it('checks the link on arrival, then shows the form', async () => {
    const pending = new Subject<void>();
    await open('tok-abc', pending as never);
    expect(el().querySelector('[data-testid="reset-checking"]')).not.toBeNull();
    pending.next();
    fixture.detectChanges();
    expect(api.checkPasswordResetToken).toHaveBeenCalledOnceWith('tok-abc');
    expect(el().querySelector('#reset-password')).not.toBeNull();
  });

  it('is built in the shared auth layout', async () => {
    await open();
    expect(el().querySelector('.auth__brand')).not.toBeNull();
    expect(el().querySelector('.auth__form-inner h1')!.textContent).toContain('Új jelszó beállítása');
  });

  for (const [code, message] of [
    ['reset_token_expired', 'A visszaállító link lejárt. Kérj új linket.'],
    ['reset_token_used', 'Ezt a visszaállító linket már felhasználták, vagy közben újat kértél.'],
    ['reset_token_invalid', 'Ez a visszaállító link érvénytelen. Kérj új linket.'],
  ] as const) {
    it(`${code}: shows the server's message and offers a new link instead of the form`, async () => {
      await open('tok-abc', throwError(() => refusal(code, message)) as never);
      expect(el().querySelector('[data-testid="reset-refused"]')!.textContent).toContain(message);
      expect(el().querySelector('#reset-password')).toBeNull();
      const link = el().querySelector('[data-testid="request-new"]')!;
      expect(link.textContent).toContain('Új link kérése');
      expect(link.getAttribute('href')).toBe('/forgot-password');
    });
  }

  it('a link with no code at all is refused as invalid', async () => {
    await open(null);
    expect(el().querySelector('[data-testid="reset-refused"]')).not.toBeNull();
    expect(api.checkPasswordResetToken).not.toHaveBeenCalled();
  });

  it('keeps the strength meter truthful: a password the server rejects is never green', async () => {
    await open();
    for (const pw of ['12345678', 'abcdefgh', 'abc1234']) {
      type(pw);
      const meter = el().querySelector('[data-testid="strength"]')!;
      expect(meter.getAttribute('data-level')).toBe('rejected');
      expect(meter.querySelectorAll('.meter__seg--on').length).toBeLessThanOrEqual(2);
    }
    type('Jelszo1234');
    expect(el().querySelector('[data-testid="strength"]')!.getAttribute('data-level')).toBe('accepted');
  });

  it('states the same password rule as registration', async () => {
    await open();
    expect(el().querySelector('[data-testid="password-rule"]')!.textContent).toContain(
      'Legalább 8 karakter, benne legalább egy betű (a–z) és egy szám.',
    );
  });

  it('does not send a password the server would refuse', async () => {
    await open();
    type('abcdefgh');
    submit();
    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(el().querySelector('#reset-password-err')!.textContent).toContain('szám');
  });

  it('saves the new password with the link token, then goes to login with a notice flag', async () => {
    await open();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    api.resetPassword.and.returnValue(of({ message: 'ok' }));
    type('Jelszo1234');
    submit();
    expect(api.resetPassword).toHaveBeenCalledOnceWith('tok-abc', 'Jelszo1234');
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reset: '1' } });
  });

  it('shows a loading state while saving', async () => {
    await open();
    api.resetPassword.and.returnValue(new Subject<{ message: string }>());
    type('Jelszo1234');
    submit();
    const btn = el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.disabled).toBeTrue();
    expect(btn.textContent).toContain('Mentés…');
  });

  it('a link that turns out used at save time switches to the refusal with a new-link offer', async () => {
    await open();
    api.resetPassword.and.returnValue(
      throwError(() => refusal('reset_token_used', 'Ezt a visszaállító linket már felhasználták.')),
    );
    type('Jelszo1234');
    submit();
    expect(el().querySelector('[data-testid="reset-refused"]')!.textContent).toContain('már felhasználták');
    expect(el().querySelector('[data-testid="request-new"]')).not.toBeNull();
  });

  it('any other failure stays on the form, in the standard error block', async () => {
    await open();
    api.resetPassword.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: { message: 'Szerverhiba.' } })),
    );
    type('Jelszo1234');
    submit();
    const block = el().querySelector('[data-testid="reset-error"]')!;
    expect(block.classList).toContain('error-block');
    expect(block.textContent).toContain('Szerverhiba.');
    expect(el().querySelector('#reset-password')).not.toBeNull();
  });
});
