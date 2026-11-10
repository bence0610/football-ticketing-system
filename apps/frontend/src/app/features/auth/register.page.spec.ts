import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Subject, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { RegisterPageComponent } from './register.page';

describe('RegisterPageComponent', () => {
  let fixture: ComponentFixture<RegisterPageComponent>;
  let auth: jasmine.SpyObj<AuthService>;

  const el = () => fixture.nativeElement as HTMLElement;
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
  const submit = () => {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    fixture.detectChanges();
  };
  const fillValid = () => {
    type('reg-last', 'Kovács');
    type('reg-first', 'Béla');
    type('reg-email', 'bela@kte.hu');
    type('reg-password', 'Jelszo123');
  };

  beforeEach(async () => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['register']);
    await TestBed.configureTestingModule({
      imports: [RegisterPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RegisterPageComponent);
    fixture.detectChanges();
  });

  it('has the h1, the link to login, the email hint, and no terms checkbox', () => {
    expect(el().querySelector('h1')!.textContent).toContain('Fiók létrehozása');
    expect(el().textContent).toContain('Van már fiókod?');
    expect(el().querySelector('a[href="/login"]')).not.toBeNull();
    expect(el().textContent).toContain('visszaigazolásokat és a QR-kódokat');
    expect(el().querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('shows no error while typing; the field error comes after it is left', () => {
    type('reg-first', 'B');
    expect(el().querySelector('#reg-first-err')).toBeNull();
    blur('reg-first');
    expect(el().querySelector('#reg-first-err')!.textContent).toContain('Legalább 2');
  });

  describe('the strength meter tells the server rule, not its own', () => {
    const meter = () => el().querySelector('[data-testid="strength"]')!;
    const filled = () => meter().querySelectorAll('.meter__seg--on').length;

    it('states the rule the server enforces', () => {
      expect(el().querySelector('[data-testid="password-rule"]')!.textContent).toContain(
        'Legalább 8 karakter, benne legalább egy betű (a–z) és egy szám.',
      );
    });

    it('a password the server rejects is never green and never above two segments', () => {
      for (const pw of ['12345678', 'abcdefgh', 'abc1234', 'abcdefghijklmnopqrstuvwxyz']) {
        type('reg-password', pw);
        expect(meter().getAttribute('data-level')).toBe('rejected');
        expect(filled()).toBeLessThanOrEqual(2);
      }
    });

    it('fills three segments for an accepted password and four from 12 characters', () => {
      type('reg-password', 'Jelszo123');
      expect(filled()).toBe(3);
      expect(meter().getAttribute('data-level')).toBe('accepted');
      type('reg-password', 'Jelszo123456');
      expect(filled()).toBe(4);
    });

    it('names the first rule that is missing once the field is left', () => {
      type('reg-password', 'abcdefgh');
      blur('reg-password');
      expect(el().querySelector('#reg-password-err')!.textContent).toContain('szám');
    });
  });

  it('submitting an empty form shows the errors at the fields and calls nothing', () => {
    submit();
    expect(auth.register).not.toHaveBeenCalled();
    for (const id of ['reg-last-err', 'reg-first-err', 'reg-password-err']) {
      expect(el().querySelector(`#${id}`)).not.toBeNull();
    }
    expect(el().querySelector('[data-testid="register-error"]')).toBeNull();
  });

  it('sends exactly the fields the server knows, and shows the loading state', () => {
    auth.register.and.returnValue(new Subject<never>());
    fillValid();
    submit();
    expect(auth.register).toHaveBeenCalledOnceWith({
      email: 'bela@kte.hu',
      password: 'Jelszo123',
      firstName: 'Béla',
      lastName: 'Kovács',
    });
    const btn = el().querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(btn.disabled).toBeTrue();
    expect(btn.textContent).toContain('Fiók létrehozása…');
  });

  it('an email already in use is said at the email field, with a link to login', () => {
    auth.register.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { message: 'Ez az e-mail cím már regisztrálva van.' },
          }),
      ),
    );
    fillValid();
    submit();
    const msg = el().querySelector('[data-testid="email-taken"]')!;
    expect(msg.textContent).toContain('már tartozik fiók');
    expect(msg.querySelector('a')!.getAttribute('href')).toBe('/login');
    expect(el().querySelector('[data-testid="register-error"]')).toBeNull();
    // ...and it goes away as soon as the address changes
    type('reg-email', 'masik@kte.hu');
    expect(el().querySelector('[data-testid="email-taken"]')).toBeNull();
  });

  it('any other failure is the standard error block with the server message', () => {
    auth.register.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { message: ['A jelszó tartalmazzon legalább egy betűt és egy számot.'] },
          }),
      ),
    );
    fillValid();
    submit();
    const block = el().querySelector('[data-testid="register-error"]')!;
    expect(block.classList).toContain('error-block');
    expect(block.textContent).toContain('A jelszó tartalmazzon');
  });
});
