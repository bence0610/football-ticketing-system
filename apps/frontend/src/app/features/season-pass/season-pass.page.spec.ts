import { provideHttpClient, withInterceptors } from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { registerLocaleData } from "@angular/common";
import localeHu from "@angular/common/locales/hu";
import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { MatSnackBar } from "@angular/material/snack-bar";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { AuthService } from "../../core/auth/auth.service";
import { errorInterceptor } from "../../core/interceptors/error.interceptor";
import type {
  SeasonOverview,
  SeasonPassPrice,
} from "../../core/models/season-pass.models";
import { StripeService } from "../../core/stripe/stripe.service";
import { SeasonPassPageComponent } from "./season-pass.page";

registerLocaleData(localeHu);

const PRICE: SeasonPassPrice = {
  sectionId: "sec-b",
  sectionName: "B",
  price: 30000,
  currency: "HUF",
  seasonLabel: "2026/2027",
};

const SEASON: SeasonOverview = {
  seasonLabel: "2026/2027",
  loyaltyPoints: 500,
  homeMatches: [],
};

/**
 * Goes through the REAL HttpClient + errorInterceptor, so it covers both what
 * the inline block shows and that the global snackbar does not fire on top.
 */
describe("SeasonPassPageComponent — purchase failure presentation", () => {
  let fixture: ComponentFixture<SeasonPassPageComponent>;
  let httpMock: HttpTestingController;
  let snackBar: jasmine.SpyObj<MatSnackBar>;

  beforeEach(() => {
    snackBar = jasmine.createSpyObj("MatSnackBar", ["open"]) as jasmine.SpyObj<MatSnackBar>;
    TestBed.configureTestingModule({
      imports: [SeasonPassPageComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBar },
        { provide: AuthService, useValue: { isAuthenticated: signal(true) } },
        { provide: StripeService, useValue: {} },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SeasonPassPageComponent);
    fixture.detectChanges();
    httpMock
      .expectOne((r) => r.url.endsWith("/season-passes/prices"))
      .flush([PRICE]);
    httpMock.expectOne((r) => r.url.endsWith("/season-passes/season")).flush(SEASON);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  /** Tier -> sector -> seat -> hold: the purchase intent is asked for once a seat is held. */
  async function failPurchaseWith409(message: string): Promise<void> {
    (
      fixture.componentInstance as unknown as {
        selectSection(p: SeasonPassPrice): void;
      }
    ).selectSection(PRICE);
    httpMock
      .expectOne((r) => r.url.endsWith("/season-passes/tiers/sec-b/sectors"))
      .flush({
        tier: "sec-b",
        seasonLabel: "2026/2027",
        price: 30000,
        sectors: [
          { section: "B/1", name: "B/1 szektor", arc: "lower", position: 1, gate: 2, covered: true, total: 4, freeSeats: 4 },
        ],
      });
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="sector-option"]')!
      .click();
    httpMock
      .expectOne((r) => r.url.endsWith("/season-passes/seats") && r.params.get("section") === "B/1")
      .flush({
        section: "B/1",
        name: "B/1 szektor",
        arc: "lower",
        gate: 2,
        covered: true,
        tier: "sec-b",
        price: 30000,
        seasonLabel: "2026/2027",
        aisles: [],
        longestRun: 4,
        seats: [1, 2, 3, 4].map((n) => ({
          id: `b1-1-${n}`,
          section: "B/1",
          row: "1",
          number: n,
          category: "standard",
          price: 30000,
          status: "available",
          isAccessible: false,
        })),
      });
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button[data-id="b1-1-2"]')!
      .click();
    httpMock
      .expectOne((r) => r.method === "POST" && r.url.endsWith("/season-passes/seats/b1-1-2/hold"))
      .flush({
        seatId: "b1-1-2",
        holdToken: "tok",
        ttlSeconds: 600,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    await fixture.whenStable();
    httpMock
      .expectOne(
        (r) => r.method === "POST" && r.url.endsWith("/season-passes/purchase"),
      )
      .flush(
        { statusCode: 409, message, code: "holder_already_has_pass" },
        { status: 409, statusText: "Conflict" },
      );
  }

  it("a 409 from /season-passes/purchase reaches the user as the server's message", async () => {
    const message = "Erre a szezonra már van bérleted.";
    await failPurchaseWith409(message);
    await fixture.whenStable();
    fixture.detectChanges();

    const box: HTMLElement | null = fixture.nativeElement.querySelector(
      '.kte-season-pass__error[role="alert"]',
    );
    expect(box).withContext("inline error block").not.toBeNull();
    expect(box!.textContent!.trim()).toBe(message);
    expect(fixture.nativeElement.textContent).not.toContain(
      "Http failure response",
    );
    expect(fixture.nativeElement.textContent).not.toContain("409 Conflict");
  });

  it("reports the failure once: inline block only, no snackbar on top", async () => {
    await failPurchaseWith409("Erre a szezonra már van bérleted.");
    await fixture.whenStable();
    fixture.detectChanges();

    expect(snackBar.open).not.toHaveBeenCalled();
    expect(
      fixture.nativeElement.querySelectorAll(
        '.kte-season-pass__error[role="alert"]',
      ).length,
    ).toBe(1);
  });
});
