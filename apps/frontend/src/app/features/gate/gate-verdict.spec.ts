import {
  isAdmission,
  whenLabel,
  verdictFromFailure,
  verdictFromResponse,
  verdictNotATicket,
} from './gate-verdict';
import { TicketScanResponse } from '../../core/models/ticket.models';

const seat = { id: 's', section: 'B', row: '5', number: 12, category: 'standard' };
const match = {
  id: 'm',
  homeTeam: 'KTE',
  awayTeam: 'Újpest',
  venue: 'v',
  kickoffAt: '2026-11-09T18:00:00Z',
};

describe('gate verdicts', () => {
  it('admits with the holder, seat and ticket type', () => {
    const v = verdictFromResponse({
      success: true,
      result: 'ok',
      holderName: 'Kiss Anna',
      seat,
      match,
      source: 'season_pass',
    });
    expect(v).toEqual(
      jasmine.objectContaining({
        kind: 'admitted',
        tone: 'ok',
        title: 'BELÉPHET',
        holderName: 'Kiss Anna',
        seat: 'B szektor · 5. sor · 12. szék',
        typeLabel: 'Bérlet',
        fixture: 'KTE – Újpest',
      }),
    );
    expect(isAdmission(v)).toBeTrue();
  });

  it('already used is amber, names the time and sends the person to the desk', () => {
    const v = verdictFromResponse({
      success: false,
      result: 'already_used',
      scannedAt: '2026-11-09T17:40:00Z',
      seat,
      holderName: 'Kiss Anna',
    });
    expect(v.kind).toBe('used');
    expect(v.tone).toBe('warn');
    expect(v.glyph).toBe('warning');
    expect(v.instruction).toContain('ügyfélszolgálati pult');
    expect(v.scannedAt).toBe('2026-11-09T17:40:00Z');
    expect(isAdmission(v)).toBeFalse();
  });

  it('invalid and already-used never share colour, glyph or wording', () => {
    const used = verdictFromResponse({ success: false, result: 'already_used' });
    const invalid = verdictFromResponse({
      success: false,
      result: 'invalid',
      message: 'invalid_signature',
    });
    expect(invalid.tone).toBe('bad');
    expect(invalid.tone).not.toBe(used.tone);
    expect(invalid.glyph).not.toBe(used.glyph);
    expect(invalid.title).not.toBe(used.title);
  });

  it('expired is red but has its own glyph and wording, apart from invalid', () => {
    const expired = verdictFromResponse({ success: false, result: 'expired' });
    const invalid = verdictFromResponse({ success: false, result: 'invalid' });
    expect(expired.tone).toBe('bad');
    expect(expired.glyph).not.toBe(invalid.glyph);
    expect(expired.title).not.toBe(invalid.title);
  });

  it('an expired token reported as invalid is shown as expired', () => {
    const v = verdictFromResponse({ success: false, result: 'invalid', message: 'expired' });
    expect(v.kind).toBe('expired');
  });

  it('explains why a code was refused when the server says why', () => {
    const v = verdictFromResponse({
      success: false,
      result: 'invalid',
      message: 'ticket_status_cancelled',
    });
    expect(v.instruction).toBe('A jegyet visszamondták.');
  });

  it('a success flag without result ok is never an admission', () => {
    const odd = { success: true, result: 'invalid' } as TicketScanResponse;
    expect(isAdmission(verdictFromResponse(odd))).toBeFalse();
  });

  it('a code that is not a ticket is refused as invalid', () => {
    expect(verdictNotATicket().tone).toBe('bad');
  });

  describe('when the check could not be made', () => {
    it('no network: refuses, says why, offers a retry - no queueing, no admission', () => {
      const v = verdictFromFailure(0);
      expect(v.kind).toBe('offline');
      expect(v.tone).toBe('down');
      expect(v.retryable).toBeTrue();
      expect(v.instruction).toContain('nem léphet be');
      expect(isAdmission(v)).toBeFalse();
    });
    it('server error: refuses with a retry', () => {
      const v = verdictFromFailure(503);
      expect(v.kind).toBe('server');
      expect(v.retryable).toBeTrue();
    });
    it('no permission: refuses, no retry', () => {
      expect(verdictFromFailure(403).kind).toBe('denied');
      expect(verdictFromFailure(401).retryable).toBeFalse();
    });
    it('is a different tone from every ticket verdict', () => {
      expect(verdictFromFailure(0).tone).not.toBe(verdictNotATicket().tone);
    });
  });

  describe('whenLabel', () => {
    const now = new Date('2026-11-09T20:00:00');
    it('says "ma" for today', () => {
      const iso = new Date('2026-11-09T17:40:00').toISOString();
      expect(whenLabel(iso, now)).toMatch(/^ma \d{2}:\d{2}$/);
    });
    it('gives the date for another day', () => {
      const iso = new Date('2026-11-08T17:40:00').toISOString();
      expect(whenLabel(iso, now)).toMatch(/nov\. 8\. \d{2}:\d{2}$/);
    });
    it('is undefined for nothing or garbage', () => {
      expect(whenLabel(undefined, now)).toBeUndefined();
      expect(whenLabel('nope', now)).toBeUndefined();
    });
  });
});
