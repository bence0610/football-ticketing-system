import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import localeHu from '@angular/common/locales/hu';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import type {
  SeasonOverview,
  SeasonPassPrice,
  SeasonPassSeatMap,
  SeasonPassTierSectors,
  SeasonSeatHold,
} from '../../core/models/season-pass.models';
import { StripeService } from '../../core/stripe/stripe.service';
import type { SeatAvailability, SeatStatus } from '../../shared/models/seat.model';
import { SeasonPassPageComponent } from './season-pass.page';

registerLocaleData(localeHu);

const TIER: SeasonPassPrice = {
  sectionId: 'lower',
  sectionName: 'Alsó ív',
  price: 30000,
  currency: 'HUF',
  seasonLabel: '2026/2027',
  freeSeats: 40,
  totalSeats: 200,
};

const SEASON: SeasonOverview = { seasonLabel: '2026/2027', loyaltyPoints: 500, homeMatches: [] };

const SECTORS: SeasonPassTierSectors = {
  tier: 'lower',
  seasonLabel: '2026/2027',
  price: 30000,
  sectors: [
    { section: 'D/1', name: 'D/1 szektor', arc: 'lower', position: 1, gate: 3, covered: true, total: 120, freeSeats: 12 },
    { section: 'D/2', name: 'D/2 szektor', arc: 'lower', position: 2, gate: 3, covered: false, total: 120, freeSeats: 0 },
  ],
};

function seat(n: number, status: SeatAvailability = 'available'): SeatStatus {
  return { id: `d1-1-${n}`, section: 'D/1', row: '1', number: n, category: 'standard', price: 30000, status, isAccessible: false };
}

function seatMap(seats: SeatStatus[] = [seat(1), seat(2), seat(3), seat(4, 'season_pass'), seat(5, 'locked')]): SeasonPassSeatMap {
  return {
    section: 'D/1',
    name: 'D/1 szektor',
    arc: 'lower',
    gate: 3,
    covered: true,
    tier: 'lower',
    price: 30000,
    seasonLabel: '2026/2027',
    aisles: [],
    longestRun: 3,
    seats,
  };
}

function holdFor(seatId: string, ttlSeconds = 600, token = `tok-${seatId}`): SeasonSeatHold {
  return { seatId, holdToken: token, ttlSeconds, expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString() };
}

const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('SeasonPassPageComponent — choosing the seat', () => {
  let fixture: ComponentFixture<SeasonPassPageComponent>;
  let http: HttpTestingController;
  let isAuthenticated: WritableSignal<boolean>;
  let confirmPayment: jasmine.Spy;

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => el().querySelector<T>(sel);
  const seatBtn = (id: string): HTMLButtonElement => q<HTMLButtonElement>(`button[data-id="${id}"]`)!;
  const purchaseReq = (): TestRequest =>
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/season-passes/purchase'));
  const holdReq = (id: string): TestRequest =>
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith(`/season-passes/seats/${id}/hold`));
  const seatsReq = (): TestRequest =>
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/season-passes/seats') && r.params.get('section') === 'D/1');

  function setup(auth = true): void {
    isAuthenticated = signal(auth);
    confirmPayment = jasmine.createSpy('confirmPayment').and.resolveTo({
      paymentIntent: { id: 'pi_1', status: 'succeeded' },
    });
    const paymentElement = {
      on: (event: string, cb: () => void) => {
        if (event === 'ready') cb();
      },
      mount: () => undefined,
      destroy: () => undefined,
    };
    const stripeStub = {
      createElements: () =>
        Promise.resolve({ stripe: { confirmPayment }, elements: { create: () => paymentElement } }),
    };
    TestBed.configureTestingModule({
      imports: [SeasonPassPageComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated } },
        { provide: StripeService, useValue: stripeStub },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SeasonPassPageComponent);
    // like the running app: the Stripe host element must be rendered before the mount timer fires
    fixture.autoDetectChanges(true);
    fixture.detectChanges();
    http.expectOne((r) => r.url.endsWith('/season-passes/prices')).flush([TIER]);
    http.expectOne((r) => r.url.endsWith('/season-passes/season')).flush(SEASON);
    fixture.detectChanges();
  }

  /** Picks the tier and opens the list of its sectors. */
  function openTier(): void {
    q<HTMLButtonElement>('.sector__cta')!.click();
    http.expectOne((r) => r.url.endsWith('/season-passes/tiers/lower/sectors')).flush(SECTORS);
    fixture.detectChanges();
  }

  /** ... then the first sector's board. */
  function openSector(map = seatMap()): void {
    openTier();
    q<HTMLButtonElement>('[data-testid="sector-option"]')!.click();
    seatsReq().flush(map);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  describe('the sector list', () => {
    beforeEach(() => setup());

    it('shows each sector with its arc, gate, cover and free pass seats', () => {
      openTier();
      const options = Array.from(el().querySelectorAll('[data-testid="sector-option"]'));
      expect(options.length).toBe(2);
      const first = text(options[0]);
      expect(first).toContain('D/1 szektor');
      expect(first).toContain('Főépület oldala');
      expect(first).toContain('3-as kapu');
      expect(first).toContain('Fedett');
      expect(first).toContain('12 szabad bérletes hely');
    });

    it('says "elfogyott" for a sold-out sector and does not let it be opened', () => {
      openTier();
      const soldOut = el().querySelectorAll<HTMLButtonElement>('[data-testid="sector-option"]')[1];
      expect(text(soldOut.querySelector('[data-testid="sector-free"]'))).toBe('elfogyott');
      expect(soldOut.disabled).toBeTrue();
      soldOut.click();
      fixture.detectChanges();
      http.expectNone((r) => r.url.endsWith('/season-passes/seats'));
      expect(q('[data-testid="seat-step"]')).toBeNull();
    });

    it('a failed sector list says so and can be retried', () => {
      q<HTMLButtonElement>('.sector__cta')!.click();
      http
        .expectOne((r) => r.url.endsWith('/season-passes/tiers/lower/sectors'))
        .flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(text(q('[data-testid="sector-step"] [role="alert"]'))).toContain('Újra');
    });
  });

  describe('the board', () => {
    beforeEach(() => setup());

    it('opens the one seat grid in season mode, without the match-only parts', () => {
      openSector();
      const grid = q('kte-seat-grid');
      expect(grid).not.toBeNull();
      const legend = text(q('[data-testid="grid-legend"]'));
      expect(legend).toContain('Már bérlet tartozik rá');
      expect(legend).not.toContain('Elkelt');
      expect(q('kte-best-seats-panel')).toBeNull();
      expect(q('kte-seat-summary')).toBeNull();
      // the grid's help text speaks of pass seats
      expect(text(q('[data-testid="grid-help"]'))).toContain('bérletes helyre');
    });

    it('a seat ticketed for an upcoming match has its own glyph and legend entry', () => {
      openSector(seatMap([seat(1), seat(2, 'ticketed')]));
      const b = seatBtn('d1-1-2');
      expect(text(b)).toBe('J');
      expect(b.classList).toContain('kte-seat--ticketed');
      expect(b.getAttribute('aria-label')).toContain('közelgő meccsre már van jegy, bérletre nem választható');
      expect(text(q('[data-testid="grid-legend"]'))).toContain('J Közelgő meccsre már van jegy: nem váltható bérletre');
    });
  });

  describe('saying why a seat cannot be chosen', () => {
    beforeEach(() => setup());

    const reason = (): string => text(q('[data-testid="seat-unavailable-reason"]'));

    it('the reason line is a polite live region, empty until a seat needs explaining', () => {
      openSector();
      const line = q('[data-testid="seat-unavailable-reason"]')!;
      expect(line.getAttribute('aria-live')).toBe('polite');
      expect(reason()).toBe('');
    });

    for (const [status, words] of [
      ['ticketed', 'Erre a helyre már van jegy egy közelgő mérkőzésre, ezért nem váltható bérletre.'],
      ['season_pass', 'Erre a helyre már szól bérlet ebben a szezonban.'],
      ['locked', 'Másik vásárló épp fizet erre a helyre.'],
      ['disabled', 'Ez a hely nem értékesíthető.'],
    ] as const) {
      it(`a tap on a ${status} seat says why and holds nothing`, () => {
        openSector(seatMap([seat(1), seat(2, status)]));
        seatBtn('d1-1-2').click();
        fixture.detectChanges();
        http.expectNone((r) => r.url.includes('/hold'));
        expect(reason()).toBe(words);
        // not an error: the error line stays empty
        expect(q('[data-testid="seat-message"]')).toBeNull();
      });
    }

    it('choosing a free seat afterwards clears the reason', async () => {
      openSector(seatMap([seat(1), seat(2, 'ticketed')]));
      seatBtn('d1-1-2').click();
      fixture.detectChanges();
      expect(reason()).not.toBe('');
      seatBtn('d1-1-1').click();
      holdReq('d1-1-1').flush(holdFor('d1-1-1'));
      await fixture.whenStable();
      purchaseReq().flush({ paymentIntentId: 'pi_1', clientSecret: null, status: 'x', seasonPassId: null, succeeded: false, seasonLabel: '', amount: 0, currency: 'HUF' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(reason()).toBe('');
    });
  });

  describe('holding a seat', () => {
    beforeEach(() => setup());

    it('a tap on a free seat holds it, marks it chosen, shows the summary and enables paying', async () => {
      openSector();
      expect(q<HTMLButtonElement>('[data-testid="hold-continue"]')!.disabled).toBeTrue();

      seatBtn('d1-1-2').click();
      holdReq('d1-1-2').flush(holdFor('d1-1-2'));
      await fixture.whenStable();
      const intent = purchaseReq();
      expect(intent.request.body).toEqual(
        jasmine.objectContaining({ sectionId: 'lower', seatId: 'd1-1-2', holdToken: 'tok-d1-1-2' }),
      );
      intent.flush({ paymentIntentId: 'pi_1', clientSecret: 'cs_1', status: 'requires_payment_method', seasonPassId: null, succeeded: false, seasonLabel: '2026/2027', amount: 30000, currency: 'HUF' });
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0)); // the payment element mounts on the next tick
      await fixture.whenStable();
      fixture.detectChanges();

      expect(seatBtn('d1-1-2').getAttribute('aria-pressed')).toBe('true');
      const summary = text(q('[data-testid="hold-summary"]'));
      expect(summary).toContain('D/1 szektor · 1. sor · 2. hely');
      expect(summary).toContain('30 000');
      expect(text(q('[data-testid="hold-countdown"]'))).toMatch(/(9:5\d|10:00)/);
      expect(q<HTMLButtonElement>('[data-testid="hold-continue"]')!.disabled).toBeFalse();
      expect(q<HTMLButtonElement>('[data-testid="pay"]')!.disabled).toBeFalse();
    });

    it('a tap on another seat moves the choice; a tap on the chosen seat lets it go', async () => {
      openSector();
      seatBtn('d1-1-1').click();
      holdReq('d1-1-1').flush(holdFor('d1-1-1'));
      await fixture.whenStable();
      purchaseReq().flush({ paymentIntentId: 'pi_1', clientSecret: null, status: 'x', seasonPassId: null, succeeded: false, seasonLabel: '', amount: 0, currency: 'HUF' });
      await fixture.whenStable();
      fixture.detectChanges();

      seatBtn('d1-1-3').click();
      holdReq('d1-1-3').flush(holdFor('d1-1-3'));
      await fixture.whenStable();
      purchaseReq().flush({ paymentIntentId: 'pi_2', clientSecret: null, status: 'x', seasonPassId: null, succeeded: false, seasonLabel: '', amount: 0, currency: 'HUF' });
      await fixture.whenStable();
      fixture.detectChanges();
      expect(seatBtn('d1-1-1').getAttribute('aria-pressed')).toBeNull();
      expect(seatBtn('d1-1-3').getAttribute('aria-pressed')).toBe('true');

      seatBtn('d1-1-3').click();
      const release = http.expectOne(
        (r) => r.method === 'DELETE' && r.url.endsWith('/season-passes/seats/d1-1-3/hold'),
      );
      expect(release.request.params.get('holdToken')).toBe('tok-d1-1-3');
      release.flush(null);
      await fixture.whenStable();
      fixture.detectChanges();
      expect(seatBtn('d1-1-3').getAttribute('aria-pressed')).toBeNull();
      expect(q<HTMLButtonElement>('[data-testid="hold-continue"]')!.disabled).toBeTrue();
      expect(q('[data-testid="pay"]')).toBeNull();
    });

    for (const [code, words] of [
      ['seat_held', 'épp egy másik vásárló fizeti ki'],
      ['seat_taken', 'közben már valaki bérletet vett'],
      ['seat_ticketed', 'már van jegy egy közelgő mérkőzésre, ezért nem váltható rá bérlet'],
    ] as const) {
      it(`a 409 ${code} is told in plain words and the board is reloaded`, async () => {
        openSector();
        seatBtn('d1-1-2').click();
        holdReq('d1-1-2').flush(
          { statusCode: 409, code, message: 'Conflict' },
          { status: 409, statusText: 'Conflict' },
        );
        await fixture.whenStable();
        const now: SeatAvailability = code === 'seat_held' ? 'locked' : code === 'seat_ticketed' ? 'ticketed' : 'season_pass';
        seatsReq().flush(seatMap([seat(1), seat(2, now), seat(3)]));
        fixture.detectChanges();
        expect(text(q('[data-testid="seat-message"]'))).toContain(words);
        expect(text(el())).not.toContain('Conflict');
        expect(seatBtn('d1-1-2').getAttribute('aria-pressed')).toBeNull();
        expect(q<HTMLButtonElement>('[data-testid="hold-continue"]')!.disabled).toBeTrue();
      });
    }

    it('when the hold runs out it says so, disables paying and lets the buyer pick again', fakeAsync(() => {
      openSector();
      seatBtn('d1-1-2').click();
      holdReq('d1-1-2').flush(holdFor('d1-1-2', 3));
      tick();
      purchaseReq().flush({ paymentIntentId: 'pi_1', clientSecret: 'cs_1', status: 'x', seasonPassId: null, succeeded: false, seasonLabel: '', amount: 0, currency: 'HUF' });
      tick();
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(q<HTMLButtonElement>('[data-testid="pay"]')!.disabled).toBeFalse();

      tick(4000);
      seatsReq().flush(seatMap());
      fixture.detectChanges();
      expect(text(q('[data-testid="hold-expired"]'))).toContain('Lejárt az idő');
      expect(q<HTMLButtonElement>('[data-testid="hold-continue"]')!.disabled).toBeTrue();
      expect(q('[data-testid="pay"]')).toBeNull();
      // re-pick
      expect(seatBtn('d1-1-2').getAttribute('aria-disabled')).toBeNull();
      discardPeriodicTasks();
      flush();
    }));
  });

  describe('paying', () => {
    it('the purchase carries the seat and the hold token, and so does the finalising call', async () => {
      setup();
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      openSector();
      seatBtn('d1-1-2').click();
      holdReq('d1-1-2').flush(holdFor('d1-1-2'));
      await fixture.whenStable();
      purchaseReq().flush({ paymentIntentId: 'pi_1', clientSecret: 'cs_1', status: 'x', seasonPassId: null, succeeded: false, seasonLabel: '', amount: 0, currency: 'HUF' });
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r, 0));
      await fixture.whenStable();
      fixture.detectChanges();

      q<HTMLButtonElement>('[data-testid="pay"]')!.click();
      await fixture.whenStable();
      expect(confirmPayment).toHaveBeenCalled();
      const finalize = purchaseReq();
      expect(finalize.request.body).toEqual(
        jasmine.objectContaining({ sectionId: 'lower', seatId: 'd1-1-2', holdToken: 'tok-d1-1-2' }),
      );
      finalize.flush({ paymentIntentId: 'pi_1', clientSecret: null, status: 'succeeded', seasonPassId: 'sp_1', succeeded: true, seasonLabel: '2026/2027', amount: 30000, currency: 'HUF' });
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledWith(
        ['/season-pass/confirmation'],
        jasmine.objectContaining({
          state: jasmine.objectContaining({ seasonPassId: 'sp_1', seatLabel: 'D/1 szektor, 1. sor, 2. hely' }),
        }),
      );
    });

    it('buying for someone else: no payment until the holder is confirmed, then seat + holder are sent', async () => {
      setup();
      openSector();
      seatBtn('d1-1-2').click();
      holdReq('d1-1-2').flush(holdFor('d1-1-2'));
      await fixture.whenStable();
      purchaseReq().flush({ paymentIntentId: 'pi_1', clientSecret: null, status: 'x', seasonPassId: null, succeeded: false, seasonLabel: '', amount: 0, currency: 'HUF' });
      await fixture.whenStable();
      fixture.detectChanges();

      q<HTMLInputElement>('[data-testid="holder-other"]')!.click();
      fixture.detectChanges();
      const name = q<HTMLInputElement>('[data-testid="holder-name"]')!;
      name.value = 'Kovács Anna';
      name.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      http.expectNone((r) => r.url.endsWith('/season-passes/purchase'));

      q<HTMLButtonElement>('[data-testid="holder-apply"]')!.click();
      const req = purchaseReq();
      expect(req.request.body).toEqual({
        sectionId: 'lower',
        seatId: 'd1-1-2',
        holdToken: 'tok-d1-1-2',
        holderName: 'Kovács Anna',
      });
      req.flush({ paymentIntentId: 'pi_2', clientSecret: null, status: 'x', seasonPassId: null, succeeded: false, seasonLabel: '', amount: 0, currency: 'HUF' });
      await fixture.whenStable();
    });

    it('a hold_lost from the purchase drops the hold and asks for a new seat', async () => {
      setup();
      openSector();
      seatBtn('d1-1-2').click();
      holdReq('d1-1-2').flush(holdFor('d1-1-2'));
      await fixture.whenStable();
      purchaseReq().flush(
        { statusCode: 409, code: 'hold_lost', message: 'x' },
        { status: 409, statusText: 'Conflict' },
      );
      await fixture.whenStable();
      seatsReq().flush(seatMap());
      fixture.detectChanges();
      expect(text(q('[data-testid="seat-message"]'))).toContain('Válaszd ki újra a helyet');
      expect(q('[data-testid="pay"]')).toBeNull();
    });

    it('a seat_ticketed from the purchase drops the hold, says why and reloads the board', async () => {
      setup();
      openSector();
      seatBtn('d1-1-2').click();
      holdReq('d1-1-2').flush(holdFor('d1-1-2'));
      await fixture.whenStable();
      purchaseReq().flush(
        { statusCode: 409, code: 'seat_ticketed', message: 'x' },
        { status: 409, statusText: 'Conflict' },
      );
      await fixture.whenStable();
      seatsReq().flush(seatMap([seat(1), seat(2, 'ticketed')]));
      fixture.detectChanges();
      expect(text(q('[data-testid="seat-message"]'))).toContain('már van jegy egy közelgő mérkőzésre');
      expect(q('[data-testid="pay"]')).toBeNull();
      expect(text(seatBtn('d1-1-2'))).toBe('J');
    });
  });

  describe('signed out', () => {
    it('can look at the board, but a tap asks to sign in and holds nothing', () => {
      setup(false);
      openSector();
      seatBtn('d1-1-2').click();
      fixture.detectChanges();
      http.expectNone((r) => r.url.includes('/hold'));
      expect(text(q('[data-testid="seat-message"]'))).toContain('be kell jelentkezned');
      expect(text(q('[data-testid="hold-summary"]'))).toContain('Bejelentkezés');
    });
  });
});
