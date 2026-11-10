import { registerLocaleData } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import localeHu from '@angular/common/locales/hu';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import type { SeasonOverview, SeasonPassPrice } from '../../core/models/season-pass.models';
import { StripeService } from '../../core/stripe/stripe.service';
import { SeasonPassPageComponent } from './season-pass.page';

registerLocaleData(localeHu);

const DAY = 24 * 60 * 60 * 1000;

function price(over: Partial<SeasonPassPrice> = {}): SeasonPassPrice {
  return {
    sectionId: 'A',
    sectionName: 'A szektor',
    price: 30000,
    currency: 'HUF',
    seasonLabel: '2026/2027',
    ...over,
  };
}

function season(n: number, over: Partial<SeasonOverview> = {}): SeasonOverview {
  return {
    seasonLabel: '2026/2027',
    loyaltyPoints: 640,
    homeMatches: Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      awayTeam: `Ellenfél ${i + 1}`,
      kickoffAt: new Date(Date.now() + (i + 1) * 7 * DAY).toISOString(),
      status: 'on_sale',
    })),
    ...over,
  };
}

describe('SeasonPassPageComponent — what the page claims', () => {
  let fixture: ComponentFixture<SeasonPassPageComponent>;
  let httpMock: HttpTestingController;

  function render(prices: SeasonPassPrice[], overview: SeasonOverview | 'fail'): HTMLElement {
    TestBed.configureTestingModule({
      imports: [SeasonPassPageComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { isAuthenticated: signal(false) } },
        { provide: StripeService, useValue: {} },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SeasonPassPageComponent);
    fixture.detectChanges();
    httpMock.expectOne((r) => r.url.endsWith('/season-passes/prices')).flush(prices);
    const req = httpMock.expectOne((r) => r.url.endsWith('/season-passes/season'));
    if (overview === 'fail') {
      req.flush({ message: 'x' }, { status: 500, statusText: 'Server Error' });
    } else {
      req.flush(overview);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => httpMock.verify());

  const text = (el: HTMLElement): string => (el.textContent ?? '').replace(/\s+/g, ' ');

  it('puts the real home-match count in the headline and the fixtures heading', () => {
    const el = render([price()], season(3));
    expect(el.querySelector('h1')!.textContent).toContain('Egy hely, 3 meccs');
    expect(text(el)).toContain('A szezon 3 hazai mérkőzése');
    expect(el.querySelectorAll('[data-testid="fixtures"] li').length).toBe(3);
  });

  it('claims no number and shows no fixture list when the season could not be loaded', () => {
    const el = render([price()], 'fail');
    expect(el.querySelector('h1')!.textContent).toContain('Egy hely az egész szezonra');
    expect(el.querySelector('[data-testid="fixtures"]')).toBeNull();
    // The loyalty reward comes from the same call; without it the line is not shown.
    expect(text(el)).not.toContain('hűségpont');
  });

  it('states the loyalty points from the API, not a hard-coded number', () => {
    const el = render([price()], season(2, { loyaltyPoints: 640 }));
    expect(text(el)).toContain('+640 hűségpont');
    expect(text(el)).not.toContain('+500');
  });

  it('shows the savings panel with the three real figures', () => {
    const el = render(
      [price({ price: 30000, singleMatchTotal: 45000, upcomingHomeMatches: 10 })],
      season(10),
    );
    const panel = el.querySelector('[data-testid="savings"]')!;
    const t = text(panel as HTMLElement);
    expect(t).toContain('10 hazai meccs külön-külön');
    expect(t).toContain('45 000');
    expect(t).toContain('30 000');
    expect(t).toContain('15 000');
  });

  it('shows no savings panel when the match-by-match total is unknown', () => {
    const el = render([price({ singleMatchTotal: null, upcomingHomeMatches: 10 })], season(10));
    expect(el.querySelector('[data-testid="savings"]')).toBeNull();
  });

  it('drops the difference row when the pass is not cheaper', () => {
    const el = render(
      [price({ price: 30000, singleMatchTotal: 25000, upcomingHomeMatches: 5 })],
      season(5),
    );
    const t = text(el.querySelector('[data-testid="savings"]') as HTMLElement);
    expect(t).toContain('25 000');
    expect(t).not.toContain('Különbség');
  });

  it('sold-out sector says so and offers no button', () => {
    const el = render(
      [
        price({ sectionId: 'A', sectionName: 'A szektor', freeSeats: 0, totalSeats: 100 }),
        price({ sectionId: 'B', sectionName: 'B szektor', freeSeats: 150, totalSeats: 200 }),
      ],
      season(2),
    );
    const [a, b] = Array.from(el.querySelectorAll('article.sector'));
    expect(a.textContent).toContain('Elfogyott');
    expect(a.querySelector('button')).toBeNull();
    expect(b.textContent).toContain('150 szabad hely');
    expect(b.querySelector('button')).not.toBeNull();
  });

  it('colours availability by level', () => {
    const el = render(
      [
        price({ sectionId: 'A', freeSeats: 150, totalSeats: 200 }),
        price({ sectionId: 'B', freeSeats: 40, totalSeats: 200 }),
        price({ sectionId: 'C', freeSeats: 5, totalSeats: 200 }),
      ],
      season(2),
    );
    expect(el.querySelector('.sector__avail--plenty')).not.toBeNull();
    expect(el.querySelector('.sector__avail--few')).not.toBeNull();
    expect(el.querySelector('.sector__avail--nearly-gone')).not.toBeNull();
  });

  it('puts the ribbon only on a single sector that leads in passes sold', () => {
    let el = render(
      [
        price({ sectionId: 'A', passesSold: 3 }),
        price({ sectionId: 'B', sectionName: 'B szektor', passesSold: 9 }),
      ],
      season(2),
    );
    const ribbons = el.querySelectorAll('.sector__ribbon');
    expect(ribbons.length).toBe(1);
    expect(ribbons[0].closest('article')!.textContent).toContain('B szektor');
    fixture.destroy();
    TestBed.resetTestingModule();

    el = render([price({ passesSold: 0 }), price({ sectionId: 'B', passesSold: 0 })], season(2));
    expect(el.querySelector('.sector__ribbon')).toBeNull();
  });

  it('shows a per-match equivalent only when it can be derived', () => {
    const el = render(
      [
        price({ sectionId: 'A', price: 30000, upcomingHomeMatches: 15 }),
        price({ sectionId: 'B' }),
      ],
      season(15),
    );
    const [a, b] = Array.from(el.querySelectorAll('article.sector'));
    expect(text(a as HTMLElement)).toContain('/ meccs');
    // hu-HU does not group four-digit numbers: 2000 Ft.
    expect(text(a as HTMLElement)).toContain('2000');
    expect(text(b as HTMLElement)).not.toContain('/ meccs');
  });

  it('does not list rights that do not exist', () => {
    const el = render([price()], season(2));
    const t = text(el);
    for (const invented of ['VIP catering', 'parkolás', 'kupa', 'elővásárlási']) {
      expect(t.toLowerCase()).not.toContain(invented.toLowerCase());
    }
    expect(t).toContain('véglegesen nem ruházható át, csak meccsenként kölcsönadható');
  });
});
