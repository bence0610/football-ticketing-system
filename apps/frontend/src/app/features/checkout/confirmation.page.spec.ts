import { registerLocaleData } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import localeHu from '@angular/common/locales/hu';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { PaymentStatusResponse } from '../../shared/models/payment.model';
import { PaymentsApiService } from '../../shared/services/payments.api.service';
import { ConfirmationPageComponent } from './confirmation.page';
import {
  CONFIRMATION_POLLING,
  ConfirmationPolling,
  DEFAULT_CONFIRMATION_POLLING,
  isSlow,
  nextDelayMs,
  paymentIntentIdFrom,
  shouldGiveUp,
} from './logic/confirmation-polling';

registerLocaleData(localeHu);

const PI = 'pi_3TestPayment123';

const issued: PaymentStatusResponse = {
  status: 'issued',
  ticketIds: ['t1', 't2'],
  amountPaid: 8312,
  currency: 'huf',
  pointsCredited: 100,
  confirmationEmailSentAt: '2026-11-08T19:00:05.000Z',
  match: { id: 'm1', homeTeam: 'Kecskeméti TE', awayTeam: 'Újpest FC', venue: 'Széktói Stadion', kickoffAt: '2026-11-09T19:00:00.000Z' },
  seats: [
    { section: 'B', row: '1', number: 1, price: 3325 },
    { section: 'A', row: '1', number: 3, price: 4987 },
  ],
};
const issuedUnsent: PaymentStatusResponse = { ...issued, confirmationEmailSentAt: null };
const processing: PaymentStatusResponse = { ...issued, status: 'processing', ticketIds: [], amountPaid: 0, pointsCredited: 0, match: null, seats: [] };
const failed: PaymentStatusResponse = { ...processing, status: 'failed' };

describe('ConfirmationPageComponent', () => {
  let fixture: ComponentFixture<ConfirmationPageComponent>;
  let script: (() => Observable<PaymentStatusResponse>)[];
  let statusCalls: number;
  let confirmCalls: number;

  const fast: ConfirmationPolling = {
    intervalMs: 5,
    relaxAfterMs: 10_000,
    relaxedIntervalMs: 20,
    nudgeAfterMs: 25,
    slowAfterMs: 40,
    giveUpAfterMs: 400,
    emailGraceMs: 60,
  };

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';
  const settle = (ms = 30) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  async function open(query: Record<string, string>, policy: ConfirmationPolling = fast): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ConfirmationPageComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
        { provide: CONFIRMATION_POLLING, useValue: policy },
        { provide: AuthService, useValue: { user: () => ({ email: 'szurkolo@example.hu' }) } },
        {
          provide: PaymentsApiService,
          useValue: {
            status: () => {
              statusCalls += 1;
              const next = script.length > 1 ? script.shift()! : script[0];
              return next();
            },
            confirmPayment: () => {
              confirmCalls += 1;
              return of({ alreadyProcessed: false, ticketIds: [] });
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ConfirmationPageComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    statusCalls = 0;
    confirmCalls = 0;
    script = [() => of(issued)];
  });

  afterEach(() => fixture?.destroy());

  it('without a payment id there is nothing to confirm', async () => {
    await open({});
    expect(el().querySelector('[data-testid="confirm-missing"]')).not.toBeNull();
    expect(statusCalls).toBe(0);
  });

  it('issued: "Megvan a jegyed", the real email, two actions and the footer row', async () => {
    await open({ payment_intent: PI });
    await settle();
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="confirm-title"]')?.textContent).toContain('Megvan a jegyed');
    expect(el().querySelector('[data-testid="confirm-lead"]')?.textContent).toContain('szurkolo@example.hu');
    expect(text()).toContain('a QR-kód pedig a profilodban található');
    expect(text()).toContain('Jegy megnyitása');
    expect(text()).toContain('Vissza a mérkőzésekhez');
    expect(el().querySelector('[data-testid="confirm-id"]')?.textContent).toContain(PI);
    expect(el().querySelector('[data-testid="confirm-amount"]')?.textContent).toMatch(/8\s?312/);
    expect(el().querySelector('[data-testid="confirm-points"]')?.textContent).toContain('+100 pont');
    expect(el().querySelector('.badge--ok')).not.toBeNull();
  });

  describe('the confirmation email claim', () => {
    const NO_CLAIM = 'A jegyed elkészült, a QR-kódot a profilodban találod.';

    it('is not made while the server has not marked the email as sent', async () => {
      script = [() => of(issuedUnsent)];
      await open({ payment_intent: PI });
      await settle(20);
      fixture.detectChanges();

      const lead = el().querySelector('[data-testid="confirm-lead"]')!.textContent!;
      expect(lead).toContain(NO_CLAIM);
      expect(lead).not.toContain('elküldtük');
      expect(lead).not.toContain('szurkolo@example.hu');
      expect(text()).not.toMatch(/e-?mail/i);
    });

    it('treats a server that does not report the field as "not sent"', async () => {
      const legacy: Record<string, unknown> = { ...issued };
      delete legacy['confirmationEmailSentAt'];
      script = [() => of(legacy as unknown as PaymentStatusResponse)];
      await open({ payment_intent: PI });
      await settle(20);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="confirm-lead"]')!.textContent).toContain(NO_CLAIM);
    });

    it('is made as soon as the email is marked as sent - and not before', async () => {
      script = [() => of(issuedUnsent), () => of(issuedUnsent), () => of(issued)];
      await open({ payment_intent: PI }, { ...fast, intervalMs: 60, emailGraceMs: 2000 });
      await settle(20);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="confirm-lead"]')!.textContent).toContain(NO_CLAIM);

      await settle(220);
      fixture.detectChanges();
      const lead = el().querySelector('[data-testid="confirm-lead"]')!.textContent!;
      expect(lead).toContain('A visszaigazolást elküldtük a');
      expect(lead).toContain('szurkolo@example.hu');
    });

    it('stops looking after the grace period and never invents the claim', async () => {
      script = [() => of(issuedUnsent)];
      await open({ payment_intent: PI }); // emailGraceMs 60 ms, poll every 5 ms
      await settle(150);
      fixture.detectChanges();
      const callsAfterGrace = statusCalls;
      await settle(60);
      expect(statusCalls).toBe(callsAfterGrace); // polling has stopped
      expect(el().querySelector('[data-testid="confirm-lead"]')!.textContent).toContain(NO_CLAIM);
      expect(text()).toContain('Megvan a jegyed'); // the ticket itself is still shown
    });
  });

  it('processing: calm "Feldolgozás alatt" with no retry and no second payment', async () => {
    script = [() => of(processing)];
    await open({ payment_intent: PI });
    await settle(10);
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="confirm-title"]')?.textContent).toContain('Feldolgozás alatt');
    expect(text()).toContain('ne fizess újra');
    const controls = Array.from(el().querySelectorAll('a, button')).map((c) => (c.textContent ?? '').trim());
    expect(controls.filter((c) => /fizet|újra|próbál|retry|pay/i.test(c))).toEqual([]);
    expect(text()).not.toContain('Megvan a jegyed');
  });

  it('refreshes by itself: processing turns into issued without a click', async () => {
    script = [() => of(processing), () => of(processing), () => of(issued)];
    await open({ payment_intent: PI });
    await settle(8);
    fixture.detectChanges();
    expect(text()).toContain('Feldolgozás alatt');

    await settle(40);
    fixture.detectChanges();
    expect(text()).toContain('Megvan a jegyed');
    expect(statusCalls).toBeGreaterThanOrEqual(3);
  });

  it('shows the way to support when it takes too long, and keeps waiting', async () => {
    script = [() => of(processing)];
    await open({ payment_intent: PI });
    await settle(10);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="confirm-support"]')).toBeNull();

    await settle(80);
    fixture.detectChanges();
    const support = el().querySelector('[data-testid="confirm-support"]')!;
    expect(support).not.toBeNull();
    expect(support.querySelector('a')?.getAttribute('href')).toContain('mailto:');
    expect(support.querySelector('a')?.getAttribute('href')).toContain(PI);
    expect(text()).toContain('Feldolgozás alatt'); // still the same calm state
  });

  it('asks the server once to finalise a payment that is still waiting (idempotent, verified with Stripe)', async () => {
    script = [() => of(processing)];
    await open({ payment_intent: PI });
    await settle(120);
    expect(confirmCalls).toBe(1);
  });

  it('a network hiccup is not shown as a failure', async () => {
    script = [() => throwError(() => new HttpErrorResponse({ status: 0 })), () => of(issued)];
    await open({ payment_intent: PI }, { ...fast, intervalMs: 80 });
    await settle(20);
    fixture.detectChanges();
    expect(text()).toContain('Feldolgozás alatt');
    expect(text()).not.toContain('nem sikerült');
    await settle(120);
    fixture.detectChanges();
    expect(text()).toContain('Megvan a jegyed');
  });

  it('failed: says so plainly and offers the cart, not a pay button', async () => {
    script = [() => of(failed)];
    await open({ payment_intent: PI });
    await settle();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="confirm-title"]')?.textContent).toContain('A fizetés nem sikerült');
    expect(text()).toContain('nem terheltük');
    expect(text()).toContain('Vissza a kosárhoz');
  });

  it("a payment that is not the user's (404) is treated as nothing to confirm", async () => {
    script = [() => throwError(() => new HttpErrorResponse({ status: 404 }))];
    await open({ payment_intent: PI });
    await settle();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="confirm-missing"]')).not.toBeNull();
  });
});

describe('confirmation polling policy', () => {
  const p = DEFAULT_CONFIRMATION_POLLING;

  it('polls often, then relaxes, and shows support before it gives up', () => {
    expect(nextDelayMs(p, 0)).toBe(p.intervalMs);
    expect(nextDelayMs(p, p.relaxAfterMs)).toBe(p.relaxedIntervalMs);
    expect(isSlow(p, p.slowAfterMs - 1)).toBeFalse();
    expect(isSlow(p, p.slowAfterMs)).toBeTrue();
    expect(p.slowAfterMs).toBeLessThan(p.giveUpAfterMs);
    expect(shouldGiveUp(p, p.giveUpAfterMs)).toBeTrue();
  });

  it('reads the payment id from Stripe\'s return_url, our redirect, or history state', () => {
    const q = (v: string | null) => ({ get: () => v });
    expect(paymentIntentIdFrom(q(PI), null)).toBe(PI);
    expect(paymentIntentIdFrom(q(null), { paymentIntentId: PI })).toBe(PI);
    expect(paymentIntentIdFrom(q('not-an-id'), null)).toBeNull();
    expect(paymentIntentIdFrom(q(null), null)).toBeNull();
  });
});
