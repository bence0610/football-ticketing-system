import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideMockStore } from '@ngrx/store/testing';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { AuthResponse } from '../../shared/models/auth.model';
import { MatchListItem } from '../../shared/models/match.model';
import { selectAllMatches } from '../../state/matches';
import { LoginPageComponent } from './login.page';

registerLocaleData(localeHu);

const NEXT: MatchListItem = {
  id: 'm1',
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Újpest FC',
  competition: 'NB1',
  venue: 'Széktói Stadion',
  kickoffAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  status: 'on_sale',
  basePrice: 2000,
  capacity: 5000,
  availableSeats: 4000,
  isHome: true,
  isSeasonPassEligible: true,
};

describe('LoginPageComponent', () => {
  // provideMockStore pins a result on this app-wide memoized selector; without this it stays
  // pinned for every spec that runs afterwards.
  afterEach(() => selectAllMatches.clearResult());

  let fixture: ComponentFixture<LoginPageComponent>;
  let auth: jasmine.SpyObj<AuthService>;

  const el = () => fixture.nativeElement as HTMLElement;
  const input = (id: string) => el().querySelector<HTMLInputElement>(`#${id}`)!;
  const type = (id: string, value: string) => {
    const i = input(id);
    i.value = value;
    i.dispatchEvent(new Event('input'));
  };
  const blur = (id: string) => {
    input(id).dispatchEvent(new Event('blur'));
    fixture.detectChanges();
  };
  const submitButton = () => el().querySelector<HTMLButtonElement>('button[type="submit"]')!;

  let query: Record<string, string> = {};

  async function create(matches: MatchListItem[] = [NEXT]): Promise<void> {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['login']);
    await TestBed.configureTestingModule({
      imports: [LoginPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'hu-HU' },
        { provide: AuthService, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: (k: string) => (k === 'reset' ? query['reset'] ?? null : null) } } },
        },
        provideMockStore({ selectors: [{ selector: selectAllMatches, value: matches }] }),
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPageComponent);
    fixture.detectChanges();
  }

  it('has the h1, the link to registration and the primary submit', async () => {
    await create();
    expect(el().querySelector('h1')!.textContent).toContain('Bejelentkezés');
    expect(el().textContent).toContain('Nincs még fiókod?');
    expect(el().querySelector('a[href="/register"]')).not.toBeNull();
    expect(submitButton().classList).toContain('kte-auth-submit');
  });

  it('links to the password reset page, which exists, and to no terms page, which does not', async () => {
    await create();
    const forgot = el().querySelector('[data-testid="forgot-link"]')!;
    expect(forgot.textContent).toContain('Elfelejtett jelszó?');
    expect(forgot.getAttribute('href')).toBe('/forgot-password');
    const text = el().textContent!.toLowerCase();
    expect(text).not.toContain('felhasználási feltétel');
    expect(text).not.toContain('adatkezelés');
  });

  it('says the password was changed when it arrives from the reset page, and not otherwise', async () => {
    query = {};
    await create();
    expect(el().querySelector('[data-testid="login-reset-done"]')).toBeNull();
  });

  it('shows that notice after a reset', async () => {
    query = { reset: '1' };
    await create();
    expect(el().querySelector('[data-testid="login-reset-done"]')!.textContent).toContain(
      'A jelszavad megváltozott',
    );
    query = {};
  });

  it('shows the next home match from real data in the brand panel', async () => {
    await create();
    const panel = el().querySelector('[data-testid="login-next-match"]')!;
    expect(panel.textContent).toContain('Kecskeméti TE – Újpest FC');
    expect(panel.textContent).toContain('Széktói Stadion');
  });

  it('drops the match panel entirely when there is no upcoming home match', async () => {
    await create([]);
    expect(el().querySelector('[data-testid="login-next-match"]')).toBeNull();
    expect(el().querySelector('.auth__extra')!.childElementCount).toBe(0);
  });

  it('a field error appears only after the field is left, not while typing', async () => {
    await create();
    type('login-email', 'nem-email');
    fixture.detectChanges();
    expect(el().querySelector('#login-email-err')).toBeNull();
    blur('login-email');
    expect(el().querySelector('#login-email-err')!.textContent).toContain('nem érvényes e-mail');
  });

  it('the show/hide button switches the password field type', async () => {
    await create();
    const toggle = () => el().querySelector<HTMLButtonElement>('.kte-field__toggle')!;
    expect(input('login-password').type).toBe('password');
    toggle().click();
    fixture.detectChanges();
    expect(input('login-password').type).toBe('text');
    expect(toggle().getAttribute('aria-label')).toBe('Jelszó elrejtése');
  });

  it('submitting empty shows the field errors and does not call the server', async () => {
    await create();
    submitButton().click();
    fixture.detectChanges();
    expect(auth.login).not.toHaveBeenCalled();
    expect(el().querySelector('#login-email-err')).not.toBeNull();
    expect(el().querySelector('#login-password-err')).not.toBeNull();
  });

  it('while signing in: button disabled, spinner and "Bejelentkezés…"', async () => {
    await create();
    auth.login.and.returnValue(new Subject<never>());
    type('login-email', 'a@kte.hu');
    type('login-password', 'x');
    submitButton().click();
    fixture.detectChanges();
    expect(submitButton().disabled).toBeTrue();
    expect(submitButton().textContent).toContain('Bejelentkezés…');
    expect(submitButton().querySelector('.kte-auth-spinner')).not.toBeNull();
  });

  it('a failure shows the server message in the standard error block', async () => {
    await create();
    auth.login.and.returnValue(
      throwError(
        () => new HttpErrorResponse({ status: 401, error: { message: 'Hibás e-mail vagy jelszó.' } }),
      ),
    );
    type('login-email', 'a@kte.hu');
    type('login-password', 'x');
    submitButton().click();
    fixture.detectChanges();
    const block = el().querySelector('[data-testid="login-error"]')!;
    expect(block.classList).toContain('error-block');
    expect(block.textContent).toContain('Hibás e-mail vagy jelszó.');
    expect(submitButton().disabled).toBeFalse();
  });

  it('navigates to the return URL (here the default) after a successful sign-in', async () => {
    await create();
    const nav = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    auth.login.and.returnValue(of({} as unknown as AuthResponse));
    type('login-email', 'a@kte.hu');
    type('login-password', 'x');
    submitButton().click();
    expect(nav).toHaveBeenCalledWith('/');
  });
});
