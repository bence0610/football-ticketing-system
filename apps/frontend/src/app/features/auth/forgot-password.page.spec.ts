import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, of, throwError } from 'rxjs';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { ForgotPasswordPageComponent } from './forgot-password.page';

const SERVER_ANSWER =
  'Ha ez az e-mail-cím regisztrálva van, elküldtük a jelszó-visszaállító linket. A link 1 óra múlva lejár.';

describe('ForgotPasswordPageComponent', () => {
  let fixture: ComponentFixture<ForgotPasswordPageComponent>;
  let api: jasmine.SpyObj<AuthApiService>;

  const el = () => fixture.nativeElement as HTMLElement;
  const type = (value: string) => {
    const i = el().querySelector<HTMLInputElement>('#forgot-email')!;
    i.value = value;
    i.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submit = () => {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();
  };

  beforeEach(async () => {
    api = jasmine.createSpyObj<AuthApiService>('AuthApiService', ['requestPasswordReset']);
    await TestBed.configureTestingModule({
      imports: [ForgotPasswordPageComponent],
      providers: [provideRouter([]), provideNoopAnimations(), { provide: AuthApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ForgotPasswordPageComponent);
    fixture.detectChanges();
  });

  it('asks for the e-mail address and links back to login', () => {
    expect(el().querySelector('h1')!.textContent).toContain('Elfelejtett jelszó');
    expect(el().querySelector('#forgot-email')).not.toBeNull();
    expect(el().querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('is built in the shared auth layout, like login and register', () => {
    expect(el().querySelector('.auth__brand')).not.toBeNull();
    expect(el().querySelector('.auth__form-inner h1')).not.toBeNull();
  });

  it('shows a field error only after the field was left, and sends nothing for a bad address', () => {
    type('nem-email');
    expect(el().querySelector('#forgot-email-err')).toBeNull();
    el().querySelector<HTMLInputElement>('#forgot-email')!.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(el().querySelector('#forgot-email-err')!.textContent).toContain('nem érvényes e-mail');
    submit();
    expect(api.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('shows the server answer as it is, with a loading state while waiting', () => {
    const pending = new Subject<{ message: string }>();
    api.requestPasswordReset.and.returnValue(pending);
    type('a@kte.hu');
    submit();
    const btn = el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.disabled).toBeTrue();
    expect(btn.textContent).toContain('Küldés…');

    pending.next({ message: SERVER_ANSWER });
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="reset-requested"]')!.textContent).toContain(SERVER_ANSWER);
    expect(api.requestPasswordReset).toHaveBeenCalledOnceWith('a@kte.hu');
  });

  it('never says whether the address has an account', () => {
    api.requestPasswordReset.and.returnValue(of({ message: SERVER_ANSWER }));
    type('valaki@kte.hu');
    submit();
    const text = el().textContent!;
    expect(text).not.toMatch(/nincs ilyen|nem található|nem regisztrált|ismeretlen/i);
    expect(text).toContain('Ha ez az e-mail-cím regisztrálva van');
  });

  it('offers a new link after sending, and goes back to the form for it', () => {
    api.requestPasswordReset.and.returnValue(of({ message: SERVER_ANSWER }));
    type('a@kte.hu');
    submit();
    el().querySelector<HTMLButtonElement>('[data-testid="request-again"]')!.click();
    fixture.detectChanges();
    expect(el().querySelector('#forgot-email')).not.toBeNull();
    expect(el().querySelector('[data-testid="reset-requested"]')).toBeNull();
  });

  it('a rate-limit answer is shown in the standard error block', () => {
    api.requestPasswordReset.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 429, error: { message: 'x' } })),
    );
    type('a@kte.hu');
    submit();
    const block = el().querySelector('[data-testid="forgot-error"]')!;
    expect(block.classList).toContain('error-block');
    expect(block.textContent).toContain('Túl sok kérés');
  });
});
