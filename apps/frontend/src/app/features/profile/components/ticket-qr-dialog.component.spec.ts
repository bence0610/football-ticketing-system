import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import {
  QR_SIZE_PX,
  TicketQrDialogComponent,
  shortTicketCode,
} from './ticket-qr-dialog.component';

describe('shortTicketCode', () => {
  it('groups the last 8 hex digits', () => {
    expect(shortTicketCode('0b5f3c1e-aaaa-bbbb-cccc-1234567890ab')).toBe('5678-90AB');
  });
  it('is undefined without a usable id', () => {
    expect(shortTicketCode(undefined)).toBeUndefined();
    expect(shortTicketCode('zz')).toBeUndefined();
  });
});

describe('TicketQrDialogComponent', () => {
  function render(): HTMLElement {
    TestBed.configureTestingModule({
      imports: [TicketQrDialogComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            matchTitle: 'KTE – Fehérvár',
            seatLabel: 'B szektor · 5. sor · 12. szék',
            qrLoader$: of({
              ticketId: '0b5f3c1e-aaaa-bbbb-cccc-1234567890ab',
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              token: 'a.b.c',
            }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(TicketQrDialogComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  it('renders a 212px QR image and a short monospace code, not the raw token', () => {
    const el = render();
    const img = el.querySelector('img.qr') as HTMLImageElement;
    expect(img.width).toBe(QR_SIZE_PX);
    expect(QR_SIZE_PX).toBe(212);
    expect(el.querySelector('[data-testid="qr-code"]')?.textContent?.trim()).toBe('5678-90AB');
    expect(el.textContent).not.toContain('a.b.c');
  });
});
