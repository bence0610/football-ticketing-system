import { TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeHu from '@angular/common/locales/hu';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { TicketRowComponent } from './ticket-row.component';
import type { TicketResponse, TicketSource, TicketStatus } from '../../../core/models/ticket.models';

registerLocaleData(localeHu);

function ticket(source: TicketSource, status: TicketStatus = 'paid'): TicketResponse {
  return {
    id: 't1',
    status,
    source,
    pricePaid: '0.00',
    currency: 'HUF',
    scannedAt: status === 'used' ? '2026-11-01T17:40:00Z' : undefined,
    match: { id: 'm1', homeTeam: 'KTE', awayTeam: 'Fehérvár', venue: 'Stadion', kickoffAt: '2026-11-20T18:00:00Z' },
    seat: { id: 's1', section: 'B', sectorName: 'B szektor', gate: 3, row: '5', number: 12, category: 'standard' },
  };
}

describe('TicketRowComponent', () => {
  function render(source: TicketSource, status: TicketStatus = 'paid'): HTMLElement {
    TestBed.configureTestingModule({
      imports: [TicketRowComponent],
      providers: [
        provideNoopAnimations(),
        { provide: LOCALE_ID, useValue: 'hu-HU' },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
      ],
    });
    const fixture = TestBed.createComponent(TicketRowComponent);
    fixture.componentRef.setInput('ticket', ticket(source, status));
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('marks a loan ticket as borrowed from another pass', () => {
    expect(render('loan').querySelector('[data-testid="borrowed-badge"]')).not.toBeNull();
  });

  it('does not mark a single purchase as borrowed', () => {
    expect(render('single').querySelector('[data-testid="borrowed-badge"]')).toBeNull();
  });

  it('does not mark an own season-pass entry as borrowed', () => {
    expect(render('season_pass').querySelector('[data-testid="borrowed-badge"]')).toBeNull();
  });

  it('offers "Megnyitás" on an active ticket', () => {
    expect(render('single').querySelector('button.open')?.textContent).toContain('Megnyitás');
  });

  it('dims a used ticket, shows the scan time and has no action', () => {
    const el = render('single', 'used');
    expect(el.querySelector('.row--used')).not.toBeNull();
    expect(el.querySelector('[data-testid="scanned-at"]')).not.toBeNull();
    expect(el.querySelector('button.open')).toBeNull();
  });

  it('tells the holder which gate to use', () => {
    const el = render('single');
    expect(el.querySelector('[data-testid="ticket-gate"]')?.textContent).toContain('3-as kapu');
  });
});
