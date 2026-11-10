import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SeasonPassCardComponent, scanTimeLabel } from './season-pass-card.component';
import { MatchesService } from '../../../core/services/matches.service';
import { SeasonPassesService } from '../../../core/services/season-passes.service';
import type { MatchResource } from '../../../core/services/matches.service';
import type { SeasonPassResponse, PassLoanResponse } from '../../../core/models/season-pass.models';
import type { TicketResponse } from '../../../core/models/ticket.models';

registerLocaleData(localeHu);

const FUTURE_MS = Date.now() + 7 * 24 * 60 * 60 * 1000;
const PAST_MS = Date.now() - 7 * 24 * 60 * 60 * 1000;
const MATCH_ID = 'match-1';

const baseMatch: MatchResource = {
  id: MATCH_ID,
  homeTeam: 'KTE',
  awayTeam: 'Fehérvár',
  competition: 'NB1',
  venue: 'Széktói Stadion',
  kickoffAt: new Date(FUTURE_MS).toISOString(),
  status: 'on_sale',
  capacity: 5000,
  basePrice: '2000',
  isSeasonPassEligible: true,
};

const basePass: SeasonPassResponse = {
  holderName: 'Teszt Elek',
  isBuyer: true,
  isHolder: true,
  id: 'pass-1',
  status: 'active',
  seasonLabel: '2026/2027',
  validFrom: '2026-08-01T00:00:00Z',
  validUntil: '2027-06-30T00:00:00Z',
  // The server's reading of the two dates in Europe/Budapest (CEST, UTC+2):
  // 1 Aug 00:00 local .. 1 Jul 00:00 local (the last day is covered in full).
  coversFrom: '2026-07-31T22:00:00Z',
  coversBefore: '2027-06-30T22:00:00Z',
  seatLabel: 'B / 5. sor / 12. szék',
  section: 'B',
  purchasedAt: '2026-07-01T10:00:00Z',
  loans: [],
};

function makeLoan(override: Partial<PassLoanResponse>): PassLoanResponse {
  return {
    id: 'loan-1',
    status: 'pending',
    borrowerEmail: 'friend@test.hu',
    matchId: MATCH_ID,
    expiresAt: new Date(FUTURE_MS).toISOString(),
    createdAt: new Date().toISOString(),
    ...override,
  };
}

function makeTicket(override: Partial<TicketResponse>): TicketResponse {
  return {
    id: 'ticket-1',
    status: 'paid',
    source: 'season_pass',
    pricePaid: '0.00',
    currency: 'HUF',
    match: {
      id: MATCH_ID,
      homeTeam: 'KTE',
      awayTeam: 'Fehérvár',
      venue: 'Stadion',
      kickoffAt: new Date(PAST_MS).toISOString(),
    },
    seat: { id: 'seat-1', section: 'B', row: '5', number: 12, category: 'standard' },
    ...override,
  };
}

describe('SeasonPassCardComponent — five match-row states', () => {
  let matchesServiceSpy: jasmine.SpyObj<MatchesService>;
  let seasonPassesServiceSpy: jasmine.SpyObj<SeasonPassesService>;

  beforeEach(async () => {
    matchesServiceSpy = jasmine.createSpyObj<MatchesService>('MatchesService', [
      'listAll',
      'findOne',
    ]) as unknown as jasmine.SpyObj<MatchesService>;
    seasonPassesServiceSpy = jasmine.createSpyObj<SeasonPassesService>(
      'SeasonPassesService',
      [
        'listMine',
        'listMy',
        'listPrices',
        'purchase',
        'createLoan',
        'cancelLoan',
        'acceptLoan',
        'previewLoan',
        'getMatchQr',
      ],
    ) as unknown as jasmine.SpyObj<SeasonPassesService>;

    await TestBed.configureTestingModule({
      imports: [SeasonPassCardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'hu-HU' },
        { provide: MatchesService, useValue: matchesServiceSpy },
        { provide: SeasonPassesService, useValue: seasonPassesServiceSpy },
        {
          provide: MatDialog,
          useValue: {
            open: jasmine
              .createSpy('open')
              .and.returnValue({ afterClosed: () => of(undefined) }),
          },
        },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
      ],
    }).compileComponents();
  });

  async function createFixture(
    loans: PassLoanResponse[],
    tickets: TicketResponse[],
    kickoffAt = new Date(FUTURE_MS).toISOString(),
  ): Promise<ComponentFixture<SeasonPassCardComponent>> {
    matchesServiceSpy.listAll.and.returnValue(
      of([{ ...baseMatch, kickoffAt }]),
    );

    const fixture = TestBed.createComponent(SeasonPassCardComponent);
    // setInput() properly triggers ngOnChanges (direct assignment does not)
    fixture.componentRef.setInput('pass', { ...basePass, loans });
    fixture.componentRef.setInput('myTickets', tickets);
    fixture.detectChanges(); // ngOnChanges + ngOnInit + initial render
    await fixture.whenStable(); // flush signal scheduler microtasks
    fixture.detectChanges(); // re-render with settled signal values
    return fixture;
  }

  // Boundaries of the coverage window (Europe/Budapest, CEST = UTC+2).
  // The pass is valid 2026-08-01 .. 2027-06-30; both days are covered in full.
  const boundaryCases: Array<[string, string, boolean]> = [
    ['first day, just after midnight (00:30 local)', '2026-07-31T22:30:00Z', true],
    ['the evening before the first day (23:59 local)', '2026-07-31T21:59:00Z', false],
    ['final day, 02:00 local (the old UTC-midnight cut-off)', '2027-06-30T00:00:00Z', true],
    ['final day, late evening (23:30 local)', '2027-06-30T21:30:00Z', true],
    ['the day after the final day (00:00 local)', '2027-06-30T22:00:00Z', false],
  ];
  for (const [label, kickoff, covered] of boundaryCases) {
    it(`match list: ${label} is ${covered ? 'listed' : 'not listed'}`, async () => {
      const fixture = await createFixture([], [], kickoff);
      const rows = (fixture.nativeElement as HTMLElement).querySelectorAll('.match-row');
      expect(rows.length).toBe(covered ? 1 : 0);
    });
  }

  it('state 1 (mine_upcoming): QR button and Átadás button visible, no nincs-QR text', async () => {
    const fixture = await createFixture([], []);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="qr-btn"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="loan-btn"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="no-qr-text"]')).toBeNull();
  });

  it('state 2 (loaned_accepted): no QR button, "nincs QR-od" plain text, Visszavonás button present', async () => {
    const fixture = await createFixture([makeLoan({ status: 'accepted' })], []);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="qr-btn"]')).toBeNull();
    const noQrEl = el.querySelector('[data-testid="no-qr-text"]');
    expect(noQrEl).not.toBeNull();
    expect(noQrEl!.tagName.toLowerCase()).not.toBe('button');
    expect(el.querySelector('[data-testid="revoke-btn"]')).not.toBeNull();
  });

  it('state 3 (invitation_pending): "Meghívó kiküldve" text and Visszavonás button, no QR button', async () => {
    const fixture = await createFixture([makeLoan({ status: 'pending' })], []);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="invitation-text"]')).not.toBeNull();
    expect(el.textContent).toContain('Meghívó kiküldve');
    expect(el.querySelector('[data-testid="revoke-btn"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="qr-btn"]')).toBeNull();
  });

  it('state 4 (used_by_me): "Felhasználva" text, no QR button, no Visszavonás', async () => {
    const ticket = makeTicket({ status: 'used', source: 'season_pass' });
    const fixture = await createFixture([], [ticket], new Date(PAST_MS).toISOString());
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="used-text"]')).not.toBeNull();
    expect(el.textContent).toContain('Felhasználva');
    expect(el.querySelector('[data-testid="qr-btn"]')).toBeNull();
    expect(el.querySelector('[data-testid="revoke-btn"]')).toBeNull();
  });

  it('state 5 (loaned_completed): "Átadva volt" text, no QR button, no Visszavonás', async () => {
    const fixture = await createFixture(
      [makeLoan({ status: 'completed' })],
      [],
      new Date(PAST_MS).toISOString(),
    );
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-testid="loaned-past-text"]')).not.toBeNull();
    expect(el.textContent).toContain('Átadva volt');
    expect(el.querySelector('[data-testid="qr-btn"]')).toBeNull();
    expect(el.querySelector('[data-testid="revoke-btn"]')).toBeNull();
  });

  describe('scan time in the "Felhasználva" line', () => {
    const SCANNED = '2026-09-12T16:45:00Z';

    it('shows the scan time when the ticket has one', async () => {
      const ticket = makeTicket({ status: 'used', scannedAt: SCANNED });
      const fixture = await createFixture([], [ticket], new Date(PAST_MS).toISOString());
      const text = fixture.nativeElement.querySelector('[data-testid="used-text"]').textContent;
      expect(text).toMatch(/Felhasználva — beolvasva \d{2}:\d{2}-kor/);
    });

    it('falls back to usedAt when scannedAt is missing', async () => {
      const ticket = makeTicket({ status: 'used', usedAt: SCANNED });
      const fixture = await createFixture([], [ticket], new Date(PAST_MS).toISOString());
      const text = fixture.nativeElement.querySelector('[data-testid="used-text"]').textContent;
      expect(text).toMatch(/beolvasva \d{2}:\d{2}-kor/);
    });

    it('drops the whole clause when no scan time is known — no "beolvasva -kor"', async () => {
      const ticket = makeTicket({ status: 'used' });
      const fixture = await createFixture([], [ticket], new Date(PAST_MS).toISOString());
      const text = fixture.nativeElement.querySelector('[data-testid="used-text"]').textContent;
      expect(text).toContain('Felhasználva');
      expect(text).not.toContain('beolvasva');
      expect(text).not.toContain('-kor');
    });

    it('drops the clause for an unparseable timestamp instead of printing a hole', async () => {
      const ticket = makeTicket({ status: 'used', scannedAt: 'not-a-date' });
      const fixture = await createFixture([], [ticket], new Date(PAST_MS).toISOString());
      const text = fixture.nativeElement.querySelector('[data-testid="used-text"]').textContent;
      expect(text).not.toContain('beolvasva');
      expect(text).not.toContain('-kor');
    });

    it('scanTimeLabel never returns an empty string', () => {
      expect(scanTimeLabel(undefined)).toBeUndefined();
      expect(scanTimeLabel('')).toBeUndefined();
      expect(scanTimeLabel('garbage')).toBeUndefined();
      expect(scanTimeLabel(SCANNED)).toMatch(/^\d{2}:\d{2}$/);
    });
  });

  describe('validity window', () => {
    it('lists only matches whose kickoff is inside the pass validity window', async () => {
      const inside = { ...baseMatch, id: 'in', homeTeam: 'Belül', kickoffAt: new Date(FUTURE_MS).toISOString() };
      const before = { ...baseMatch, id: 'before', homeTeam: 'Előtte', kickoffAt: '2026-07-31T18:00:00Z' };
      const after = { ...baseMatch, id: 'after', homeTeam: 'Utána', kickoffAt: '2027-07-01T18:00:00Z' };
      matchesServiceSpy.listAll.and.returnValue(of([before, inside, after]));
      const fixture = TestBed.createComponent(SeasonPassCardComponent);
      fixture.componentRef.setInput('pass', { ...basePass, loans: [] });
      fixture.componentRef.setInput('myTickets', []);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('Belül');
      expect(text).not.toContain('Előtte');
      expect(text).not.toContain('Utána');
    });
  });
});
