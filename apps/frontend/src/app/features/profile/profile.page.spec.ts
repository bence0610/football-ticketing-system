import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { LoyaltyService } from '../../core/services/loyalty.service';
import { MatchesService } from '../../core/services/matches.service';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import { TicketsService } from '../../core/services/tickets.service';
import { UserProfile } from '../../shared/models/auth.model';
import { AuthApiService } from '../../shared/services/auth.api.service';
import { WaitlistApiService } from '../../shared/services/waitlist.api.service';
import { ProfilePageComponent } from './profile.page';

const PROFILE: UserProfile = {
  id: 'u-1',
  email: 'bela@kte.hu',
  firstName: 'Béla',
  lastName: 'Kovács',
  role: 'fan',
  loyaltyTier: 'bronze',
  loyaltyPoints: 0,
  emailVerified: true,
  twoFactorEnabled: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('ProfilePageComponent (account links)', () => {
  let fixture: ComponentFixture<ProfilePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthApiService, useValue: { me: () => of(PROFILE) } },
        { provide: AuthService, useValue: { logout: () => of(undefined) } },
        { provide: TicketsService, useValue: { listMine: () => of([]) } },
        {
          provide: SeasonPassesService,
          useValue: { listMine: () => of([]), listIncomingLoans: () => of([]) },
        },
        { provide: LoyaltyService, useValue: { getSnapshot: () => of(null) } },
        { provide: MatchesService, useValue: { listUpcoming: () => of([]) } },
        { provide: WaitlistApiService, useValue: { listMine: () => of([]) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('the sidebar Fiók card links to both account pages, above the logout button, with 44px targets', () => {
    const el = fixture.nativeElement as HTMLElement;
    const nav = el.querySelector<HTMLElement>('aside [data-testid="account-links"]')!;
    expect(nav).not.toBeNull();
    const card = nav.closest('section')!;
    expect(card.querySelector('.card__title')!.textContent).toContain('Fiók');

    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a'));
    expect(links.map((a) => a.querySelector('span')!.textContent!.trim())).toEqual([
      'Adataim szerkesztése',
      'Jelszó módosítása',
    ]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/profile/details', '/profile/password']);
    for (const a of links) {
      expect(a.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }

    const logout = Array.from(card.querySelectorAll('button')).find((b) =>
      b.textContent!.includes('Kijelentkezés'),
    )!;
    expect(nav.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ProfilePageComponent (e-mail verification notice)', () => {
  async function open(profile: UserProfile, resend = () => of({ message: 'Új megerősítő levelet küldtünk.', alreadyVerified: false })) {
    const api = { me: () => of(profile), resendVerification: jasmine.createSpy('resend').and.callFake(resend) };
    await TestBed.configureTestingModule({
      imports: [ProfilePageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: AuthApiService, useValue: api },
        { provide: AuthService, useValue: { logout: () => of(undefined) } },
        { provide: TicketsService, useValue: { listMine: () => of([]) } },
        {
          provide: SeasonPassesService,
          useValue: { listMine: () => of([]), listIncomingLoans: () => of([]) },
        },
        { provide: LoyaltyService, useValue: { getSnapshot: () => of(null) } },
        { provide: MatchesService, useValue: { listUpcoming: () => of([]) } },
        { provide: WaitlistApiService, useValue: { listMine: () => of([]) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ProfilePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, api, el: fixture.nativeElement as HTMLElement };
  }

  it('says which address is unverified, what that costs, and offers a new link', async () => {
    const { el, api, fixture } = await open({ ...PROFILE, emailVerified: false });
    const notice = el.querySelector<HTMLElement>('[data-testid="verify-notice"]')!;
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('bela@kte.hu');
    expect(notice.textContent).toContain('bérletkölcsön-meghívókat');
    el.querySelector<HTMLButtonElement>('[data-testid="verify-resend"]')!.click();
    await fixture.whenStable();
    expect(api.resendVerification).toHaveBeenCalledTimes(1);
  });

  it('shows nothing for a verified address', async () => {
    const { el } = await open({ ...PROFILE, emailVerified: true });
    expect(el.querySelector('[data-testid="verify-notice"]')).toBeNull();
  });

  it('drops the notice when the server says the address is already verified', async () => {
    const { el, fixture } = await open({ ...PROFILE, emailVerified: false }, () =>
      of({ message: 'Már meg van erősítve.', alreadyVerified: true }),
    );
    el.querySelector<HTMLButtonElement>('[data-testid="verify-resend"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="verify-notice"]')).toBeNull();
  });
});
