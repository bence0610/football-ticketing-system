import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, of, throwError } from 'rxjs';
import { TicketScanResponse } from '../../core/models/ticket.models';
import { MatchResource, MatchesService } from '../../core/services/matches.service';
import { TicketsService } from '../../core/services/tickets.service';
import { CameraError, CameraFailure, GateCamera } from './gate-camera.service';
import { GateFeedback } from './gate-feedback.service';
import { GatePageComponent, currentMatch } from './gate.page';

const b64url = (o: unknown): string =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const TOKEN = `h.${b64url({ sub: 'ticket-1' })}.s`;

const SEAT = { id: 's', section: 'B', row: '5', number: 12, category: 'standard' };
const MATCH = {
  id: 'm1',
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Újpest FC',
  venue: 'Széktói',
  kickoffAt: new Date(Date.now() + 3600_000).toISOString(),
};
const ADMITTED: TicketScanResponse = {
  success: true,
  result: 'ok',
  ticketId: 'ticket-1',
  holderName: 'Nagy Kata',
  source: 'season_pass',
  seat: SEAT,
  match: MATCH,
};
const USED: TicketScanResponse = {
  success: false,
  result: 'already_used',
  ticketId: 'ticket-1',
  scannedAt: new Date().toISOString(),
  holderName: 'Nagy Kata',
  seat: SEAT,
  match: MATCH,
};

class FakeFeedback {
  played: boolean[] = [];
  needsTap = () => false;
  prime = jasmine.createSpy('prime');
  play(admitted: boolean): void {
    this.played.push(admitted);
  }
}

describe('GatePageComponent', () => {
  let fixture: ComponentFixture<GatePageComponent>;
  let onFrame: (code: string | null) => void;
  let stopped: boolean;
  let cameraFailure: CameraFailure | null;
  let scan: jasmine.Spy<(id: string, token: string) => Observable<TicketScanResponse>>;
  let feedback: FakeFeedback;
  let cameraStarts: number;

  const el = (): HTMLElement => fixture.nativeElement;
  const q = (sel: string): HTMLElement | null => el().querySelector(sel);
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

  function create(matches: MatchResource[] = []): void {
    TestBed.configureTestingModule({
      imports: [GatePageComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TicketsService, useValue: { scan } },
        { provide: MatchesService, useValue: { listAll: () => of(matches) } },
        { provide: GateFeedback, useValue: feedback },
        {
          provide: GateCamera,
          useValue: {
            start: async (_v: HTMLVideoElement, cb: (c: string | null) => void) => {
              cameraStarts++;
              if (cameraFailure) throw new CameraError(cameraFailure);
              onFrame = cb;
              return { stop: () => (stopped = true) };
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(GatePageComponent);
    fixture.detectChanges();
  }

  /** Lets the async camera start settle and re-renders. */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    stopped = false;
    cameraFailure = null;
    cameraStarts = 0;
    feedback = new FakeFeedback();
    scan = jasmine.createSpy('scan').and.returnValue(of(ADMITTED));
    sessionStorage.removeItem('kte.gate.admitted');
  });

  afterEach(() => window.dispatchEvent(new Event('online')));

  describe('scanning screen', () => {
    it('shows the live dot, the running count and the camera caption, with one way to manual entry', async () => {
      create([{ ...MATCH, status: 'on_sale' } as unknown as MatchResource]);
      await settle();
      expect(q('[data-testid="live"]')?.textContent).toContain('Beléptetés');
      expect(q('[data-testid="admitted-count"] strong')?.textContent).toBe('0');
      expect(el().textContent).toContain('Tartsd a QR-kódot a keretbe');
      expect(q('[data-testid="fixture"]')?.textContent).toContain('Kecskeméti TE – Újpest FC');
      expect(button('Kézi bevitel')).toBeDefined();
      expect(q('.frame')).not.toBeNull();
    });

    it('has no header, navigation, profile link or chat bubble of its own', async () => {
      create();
      await settle();
      expect(q('header.kte-shell__toolbar, kte-chatbot-widget, nav, a[href]')).toBeNull();
    });

    it('asks for the camera only when the page is created', async () => {
      expect(cameraStarts).toBe(0);
      create();
      await settle();
      expect(cameraStarts).toBe(1);
    });

    it('releases the camera when the page is left', async () => {
      create();
      await settle();
      fixture.destroy();
      expect(stopped).toBeTrue();
    });
  });

  describe('camera refused or missing', () => {
    for (const reason of ['denied', 'unavailable', 'insecure'] as const) {
      it(`${reason}: says so and the page stays usable through manual entry`, async () => {
        cameraFailure = reason;
        create();
        await settle();
        expect(q('[data-testid="camera-notice"]')).not.toBeNull();
        button('Kézi bevitel')!.click();
        fixture.detectChanges();
        expect(q('textarea[aria-label="QR token"]')).not.toBeNull();
        expect(button('Ellenőrzés')).toBeDefined();
      });
    }
  });

  describe('a scan', () => {
    it('admits: shows the seat, the holder (not the buyer), the ticket type and plays the admitted sound', fakeAsync(() => {
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick();
      fixture.detectChanges();

      expect(scan).toHaveBeenCalledOnceWith('ticket-1', TOKEN);
      expect(q('[data-testid="verdict-admitted"]')).not.toBeNull();
      expect(q('[data-testid="verdict-title"]')?.textContent).toBe('BELÉPHET');
      expect(el().textContent).toContain('B szektor · 5. sor · 12. szék');
      expect(q('[data-testid="gate-holder"]')?.textContent).toBe('Nagy Kata');
      expect(el().textContent).toContain('Bérlet');
      expect(feedback.played).toEqual([true]);
      expect(q('[data-testid="admitted-count"] strong')?.textContent).toBe('1');
      flush();
    }));

    it('already used: amber verdict with when, the seat, and the instruction to the service desk', fakeAsync(() => {
      scan.and.returnValue(of(USED));
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick();
      fixture.detectChanges();

      expect(q('[data-testid="verdict-used"]')?.className).toContain('verdict--warn');
      expect(q('[data-testid="scanned-when"]')?.textContent).toMatch(/Beolvasva: ma \d{2}:\d{2}/);
      expect(el().textContent).toContain('B szektor · 5. sor · 12. szék');
      expect(q('[data-testid="verdict-instruction"]')?.textContent).toContain('ügyfélszolgálati pult');
      expect(feedback.played).toEqual([false]);
      expect(q('[data-testid="admitted-count"] strong')?.textContent).toBe('0');
      flush();
    }));

    it('invalid code is red and never looks like already-used', fakeAsync(() => {
      scan.and.returnValue(of({ success: false, result: 'invalid', message: 'invalid_signature' }));
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick();
      fixture.detectChanges();

      const used = 'verdict--warn';
      const verdict = q('[data-testid="verdict-invalid"]');
      expect(verdict?.className).toContain('verdict--bad');
      expect(verdict?.className).not.toContain(used);
      expect(q('[data-testid="verdict-title"]')?.textContent).toBe('ÉRVÉNYTELEN KÓD');
      expect(feedback.played).toEqual([false]);
      flush();
    }));

    it('a code that is not a ticket at all is refused without asking the server', fakeAsync(() => {
      create();
      tick();
      fixture.detectChanges();
      onFrame('https://example.com/poster');
      tick();
      fixture.detectChanges();
      expect(scan).not.toHaveBeenCalled();
      expect(q('[data-testid="verdict-invalid"]')).not.toBeNull();
      flush();
    }));

    it('reads a code that stays in view only once', fakeAsync(() => {
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      onFrame(TOKEN);
      onFrame(TOKEN);
      tick();
      expect(scan).toHaveBeenCalledTimes(1);
      flush();
    }));

    it('ignores a press on "Következő" for a moment so a stray tap cannot skip the verdict', fakeAsync(() => {
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick(10);
      fixture.detectChanges();
      button('Következő')!.click();
      fixture.detectChanges();
      expect(q('[data-testid="verdict-admitted"]')).not.toBeNull();
      tick(500);
      button('Következő')!.click();
      fixture.detectChanges();
      expect(q('[role="alert"]')).toBeNull();
      flush();
    }));

    it('"Következő" returns to scanning and keeps the camera running', fakeAsync(() => {
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick(500);
      fixture.detectChanges();
      button('Következő')!.click();
      fixture.detectChanges();
      expect(q('[role="alert"]')).toBeNull();
      expect(stopped).toBeFalse();
      expect(cameraStarts).toBe(1);
      flush();
    }));
  });

  describe('no network: refuse, never queue', () => {
    it('offline before the scan: refuses at once, without sending anything', fakeAsync(() => {
      create();
      tick();
      fixture.detectChanges();
      window.dispatchEvent(new Event('offline'));
      fixture.detectChanges();
      expect(q('[data-testid="offline-notice"]')).not.toBeNull();
      expect(q('[data-testid="live"]')?.textContent).toContain('Nincs hálózat');

      onFrame(TOKEN);
      tick();
      fixture.detectChanges();
      expect(scan).not.toHaveBeenCalled();
      expect(q('[data-testid="verdict-offline"]')).not.toBeNull();
      expect(q('[data-testid="verdict-title"]')?.textContent).toBe('NINCS HÁLÓZAT');
      expect(q('[data-testid="verdict-instruction"]')?.textContent).toContain('nem léphet be');
      expect(feedback.played).toEqual([false]);
      expect(q('[data-testid="admitted-count"] strong')?.textContent).toBe('0');
      flush();
    }));

    it('the request failing with no connection refuses, and "Újra" checks the same code again', fakeAsync(() => {
      scan.and.returnValues(
        throwError(() => new HttpErrorResponse({ status: 0 })),
        of(ADMITTED),
      );
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick(500);
      fixture.detectChanges();
      expect(q('[data-testid="verdict-offline"]')).not.toBeNull();
      expect(q('[data-testid="admitted-count"] strong')?.textContent).toBe('0');

      button('Újra')!.click();
      tick(500);
      fixture.detectChanges();
      expect(scan).toHaveBeenCalledTimes(2);
      expect(scan.calls.argsFor(1)).toEqual(['ticket-1', TOKEN]);
      expect(q('[data-testid="verdict-admitted"]')).not.toBeNull();
      flush();
    }));

    it('a server error refuses too, and offers a retry', fakeAsync(() => {
      scan.and.returnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick(500);
      fixture.detectChanges();
      expect(q('[data-testid="verdict-server"]')).not.toBeNull();
      expect(button('Újra')).toBeDefined();
      flush();
    }));

    it('a missing gate permission is not shown as a bad ticket', fakeAsync(() => {
      scan.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
      create();
      tick();
      fixture.detectChanges();
      onFrame(TOKEN);
      tick(500);
      fixture.detectChanges();
      expect(q('[data-testid="verdict-denied"]')).not.toBeNull();
      expect(q('[data-testid="verdict-invalid"]')).toBeNull();
      flush();
    }));
  });

  describe('manual entry', () => {
    async function openManual(): Promise<void> {
      create();
      await settle();
      button('Kézi bevitel')!.click();
      fixture.detectChanges();
    }
    function type(text: string): void {
      const field = q('textarea') as HTMLTextAreaElement;
      field.value = text;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('takes the full token and offers Vissza and Ellenőrzés — no keypad pretending to redeem short codes', async () => {
      await openManual();
      expect(button('Vissza')).toBeDefined();
      expect(button('Ellenőrzés')).toBeDefined();
      expect(button('Ellenőrzés')!.disabled).toBeTrue();
      expect(el().textContent).toContain('A rövid azonosító nem váltható be');
      expect(q('.keypad, [data-key]')).toBeNull();
    });

    it('stops the camera while typing and starts it again on Vissza', async () => {
      await openManual();
      expect(stopped).toBeTrue();
      button('Vissza')!.click();
      await settle();
      expect(cameraStarts).toBe(2);
    });

    it('points at the mistake for text that is not a token, without sending it', async () => {
      await openManual();
      type('1234-5678');
      button('Ellenőrzés')!.click();
      fixture.detectChanges();
      expect(q('[data-testid="manual-error"]')).not.toBeNull();
      expect(scan).not.toHaveBeenCalled();
    });

    it('checks a pasted token', async () => {
      await openManual();
      type(`  ${TOKEN}\n`);
      button('Ellenőrzés')!.click();
      fixture.detectChanges();
      expect(scan).toHaveBeenCalledOnceWith('ticket-1', TOKEN);
      expect(q('[data-testid="verdict-admitted"]')).not.toBeNull();
    });
  });

  describe('currentMatch', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    const m = (id: string, kickoffAt: string, status = 'on_sale'): MatchResource =>
      ({ id, kickoffAt, status }) as unknown as MatchResource;

    it('picks the earliest match that has not finished', () => {
      const picked = currentMatch(
        [m('late', '2026-11-20T18:00:00Z'), m('soon', '2026-11-09T18:00:00Z'), m('gone', '2026-11-01T18:00:00Z')],
        now,
      );
      expect(picked?.id).toBe('soon');
    });
    it('keeps a match that kicked off a little while ago', () => {
      expect(currentMatch([m('on', '2026-11-09T10:00:00Z')], now)?.id).toBe('on');
    });
    it('skips cancelled and finished matches, and returns null for none', () => {
      expect(currentMatch([m('x', '2026-11-10T18:00:00Z', 'cancelled')], now)).toBeNull();
      expect(currentMatch([], now)).toBeNull();
    });
  });
});
