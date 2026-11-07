import { TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TicketCardComponent } from './ticket-card.component';
import type { TicketResponse, TicketSource } from '../../../core/models/ticket.models';

registerLocaleData(localeHu);

function ticket(source: TicketSource): TicketResponse {
  return {
    id: 't1',
    status: 'paid',
    source,
    pricePaid: '0.00',
    currency: 'HUF',
    match: { id: 'm1', homeTeam: 'KTE', awayTeam: 'Fehérvár', venue: 'Stadion', kickoffAt: '2026-11-20T18:00:00Z' },
    seat: { id: 's1', section: 'B', row: '5', number: 12, category: 'standard' },
  };
}

describe('TicketCardComponent — borrowed entries', () => {
  function render(source: TicketSource): HTMLElement {
    TestBed.configureTestingModule({
      imports: [TicketCardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'hu-HU' },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
      ],
    });
    const fixture = TestBed.createComponent(TicketCardComponent);
    fixture.componentRef.setInput('ticket', ticket(source));
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('marks a loan ticket as borrowed from another pass', () => {
    const el = render('loan');
    const badge = el.querySelector('[data-testid="borrowed-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('Kölcsönkapott');
  });

  it('does not mark own tickets (single purchase or own season pass)', () => {
    expect(render('single').querySelector('[data-testid="borrowed-badge"]')).toBeNull();
    TestBed.resetTestingModule();
    expect(render('season_pass').querySelector('[data-testid="borrowed-badge"]')).toBeNull();
  });
});
