import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { AcceptLoanPageComponent } from './accept-loan.page';
import { SeasonPassesService } from '../../core/services/season-passes.service';
import type { LoanPreview, PassLoanResponse } from '../../core/models/season-pass.models';

function fakeRoute(token: string | null): Pick<ActivatedRoute, 'snapshot'> {
  return {
    snapshot: {
      paramMap: {
        get: (k: string) => (k === 'token' ? token : null),
        has: () => false,
        getAll: () => [],
        keys: [],
      } as unknown as ActivatedRoute['snapshot']['paramMap'],
      queryParamMap: {
        get: () => null,
        has: () => false,
        getAll: () => [],
        keys: [],
      } as unknown as ActivatedRoute['snapshot']['queryParamMap'],
    } as ActivatedRoute['snapshot'],
  };
}

function loanError(code: string, status = 400): HttpErrorResponse {
  return new HttpErrorResponse({ error: { statusCode: status, message: 'test', code }, status });
}

const stubPreview: LoanPreview = {
  matchTitle: 'KTE FC - Videoton FC',
  matchVenue: 'Széktói Stadion',
  kickoffAt: '2026-11-15T17:00:00.000Z',
  seatSection: 'B',
  seatRow: '3',
  seatNumber: 12,
  lenderName: 'Kovács Béla',
  expiresAt: '2026-11-01T12:00:00.000Z',
};

const stubLoan: PassLoanResponse = {
  id: 'loan-1',
  status: 'accepted',
  borrowerEmail: 'b@test.hu',
  matchId: 'match-1',
  matchTitle: 'KTE FC - Videoton FC',
  kickoffAt: '2026-11-15T17:00:00.000Z',
  expiresAt: '2026-11-01T12:00:00.000Z',
  createdAt: '2026-10-25T10:00:00.000Z',
};

describe('AcceptLoanPageComponent', () => {
  let fixture: ComponentFixture<AcceptLoanPageComponent>;
  let serviceSpy: jasmine.SpyObj<SeasonPassesService>;

  beforeEach(async () => {
    serviceSpy = jasmine.createSpyObj<SeasonPassesService>(
      'SeasonPassesService',
      ['acceptLoan', 'previewLoan', 'getMatchQr'],
    ) as unknown as jasmine.SpyObj<SeasonPassesService>;
    // Default: preview loads successfully
    serviceSpy.previewLoan.and.returnValue(of(stubPreview));

    await TestBed.configureTestingModule({
      imports: [AcceptLoanPageComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ActivatedRoute, useValue: fakeRoute('tok-abc') },
        { provide: SeasonPassesService, useValue: serviceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AcceptLoanPageComponent);
    fixture.detectChanges();
  });

  // ── preview state ────────────────────────────────────────────────────

  it('renders the invitation card with lender name in the heading', () => {
    const heading: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="pending-heading"]');
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toContain('Kovács Béla átadja a helyét');
  });

  it('shows match title in the preview card', () => {
    expect(fixture.nativeElement.textContent).toContain('KTE FC - Videoton FC');
  });

  it('shows seat details in the preview card', () => {
    expect(fixture.nativeElement.textContent).toContain('B szektor');
    expect(fixture.nativeElement.textContent).toContain('12. szék');
  });

  it('renders accept and decline buttons', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="accept-button"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="decline-button"]')).not.toBeNull();
  });

  it('calls previewLoan with the route token on init', () => {
    expect(serviceSpy.previewLoan).toHaveBeenCalledOnceWith('tok-abc');
  });

  // ── acceptance flow ──────────────────────────────────────────────────

  it('calls acceptLoan exactly once with the route token when accept is clicked', () => {
    serviceSpy.acceptLoan.and.returnValue(of(stubLoan));
    (fixture.nativeElement.querySelector('[data-testid="accept-button"]') as HTMLButtonElement).click();
    expect(serviceSpy.acceptLoan).toHaveBeenCalledOnceWith('tok-abc');
  });

  it('shows the success state after a successful accept', () => {
    serviceSpy.acceptLoan.and.returnValue(of(stubLoan));
    (fixture.nativeElement.querySelector('[data-testid="accept-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Megvan a helyed');
    expect(fixture.nativeElement.querySelector('[data-testid="accept-button"]')).toBeNull();
  });

  // ── failure from accept ──────────────────────────────────────────────

  it('shows "A meghívó lejárt" for the loan_expired error code on accept', () => {
    serviceSpy.acceptLoan.and.returnValue(throwError(() => loanError('loan_expired', 400)));
    (fixture.nativeElement.querySelector('[data-testid="accept-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A meghívó lejárt');
    expect(fixture.nativeElement.textContent).not.toContain('Megvan a helyed');
  });

  it('shows "A tulajdonos visszavonta" for the loan_revoked error code on accept', () => {
    serviceSpy.acceptLoan.and.returnValue(throwError(() => loanError('loan_revoked', 400)));
    (fixture.nativeElement.querySelector('[data-testid="accept-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A tulajdonos visszavonta');
  });

  it('shows "A helyet már használták" for the seat_already_used error code on accept', () => {
    serviceSpy.acceptLoan.and.returnValue(throwError(() => loanError('seat_already_used', 409)));
    (fixture.nativeElement.querySelector('[data-testid="accept-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A helyet már használták');
  });

  it('shows the network error state for an unrecognised error on accept', () => {
    serviceSpy.acceptLoan.and.returnValue(
      throwError(() => new HttpErrorResponse({ error: { message: 'Unknown failure' }, status: 500 })),
    );
    (fixture.nativeElement.querySelector('[data-testid="accept-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A szerver nem érhető el');
  });

  // ── failure from previewLoan ─────────────────────────────────────────

  it('shows "A meghívó lejárt" when previewLoan returns loan_expired', () => {
    serviceSpy.previewLoan.and.returnValue(throwError(() => loanError('loan_expired', 400)));
    const fresh = TestBed.createComponent(AcceptLoanPageComponent);
    fresh.detectChanges();
    expect(fresh.nativeElement.textContent).toContain('A meghívó lejárt');
  });

  it('shows "A tulajdonos visszavonta" when previewLoan returns loan_revoked', () => {
    serviceSpy.previewLoan.and.returnValue(throwError(() => loanError('loan_revoked', 400)));
    const fresh = TestBed.createComponent(AcceptLoanPageComponent);
    fresh.detectChanges();
    expect(fresh.nativeElement.textContent).toContain('A tulajdonos visszavonta');
  });

  it('shows "A helyet már használták" when previewLoan returns seat_already_used', () => {
    serviceSpy.previewLoan.and.returnValue(throwError(() => loanError('seat_already_used', 409)));
    const fresh = TestBed.createComponent(AcceptLoanPageComponent);
    fresh.detectChanges();
    expect(fresh.nativeElement.textContent).toContain('A helyet már használták');
  });
});
