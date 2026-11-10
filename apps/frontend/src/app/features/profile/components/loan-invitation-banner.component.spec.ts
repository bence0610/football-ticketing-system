import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LoanInvitationBannerComponent } from './loan-invitation-banner.component';
import type { IncomingLoan } from '../../../core/models/season-pass.models';

const NOW = Date.parse('2026-11-10T10:00:00Z');

function inv(id: string, token: string, hoursLeft: number): IncomingLoan {
  return {
    id,
    invitationToken: token,
    lenderName: 'Kovács Béla',
    matchTitle: 'KTE FC - Videoton FC',
    kickoffAt: '2026-11-15T17:00:00.000Z',
    seatSection: 'B',
    seatRow: '3',
    seatNumber: 12,
    expiresAt: new Date(NOW + hoursLeft * 3_600_000).toISOString(),
  };
}

describe('LoanInvitationBannerComponent', () => {
  function render(list: IncomingLoan[]): HTMLElement {
    TestBed.configureTestingModule({
      imports: [LoanInvitationBannerComponent],
      providers: [provideRouter([]), provideNoopAnimations()],
    });
    const fixture = TestBed.createComponent(LoanInvitationBannerComponent);
    fixture.componentRef.setInput('invitations', list);
    fixture.componentRef.setInput('now', NOW);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('says who is handing over the seat, the fixture, the seat and the time left', () => {
    const el = render([inv('1', 'tok-1', 50)]);
    const text = el.textContent!;
    expect(text).toContain('Kovács Béla átadja neked a helyét');
    expect(text).toContain('KTE FC - Videoton FC');
    expect(text).toContain('B szektor · 3. sor · 12. szék');
    expect(el.querySelector('[data-testid="loan-invitation-left"]')!.textContent).toContain('még 2 nap');
  });

  it('"Megnézem" leads to the accept page for that invitation', () => {
    const el = render([inv('1', 'tok-1', 5)]);
    const link = el.querySelector('[data-testid="loan-invitation-open"]')!;
    expect(link.textContent).toContain('Megnézem');
    expect(link.getAttribute('href')).toBe('/loans/accept/tok-1');
  });

  it('gives every pending invitation its own banner', () => {
    const el = render([inv('1', 'tok-1', 5), inv('2', 'tok-2', 30)]);
    const banners = el.querySelectorAll('[data-testid="loan-invitation"]');
    expect(banners.length).toBe(2);
    const hrefs = Array.from(el.querySelectorAll('[data-testid="loan-invitation-open"]')).map((a) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(['/loans/accept/tok-1', '/loans/accept/tok-2']);
  });

  it('renders nothing when there are none', () => {
    expect(render([]).querySelectorAll('[data-testid="loan-invitation"]').length).toBe(0);
  });
});
