import { gateLabel } from '../../shared/utils/gate';
import { hungarianArticle } from '../../shared/utils/hungarian-article';
import { sectorName } from '../../shared/utils/sector-name';
import { TicketScanResponse, TicketSource } from '../../core/models/ticket.models';

/**
 * What the steward is shown. Each kind gets its own colour, glyph, wording
 * AND sound, so no verdict relies on colour alone, and the two that need
 * different actions can never be mistaken for each other:
 *  - `used`    amber, warning triangle: a real ticket, a person to redirect.
 *  - `invalid` red, crossed circle:     usually a wrong code - scan again.
 */
export type VerdictKind =
  | 'admitted'
  | 'used'
  | 'invalid'
  | 'expired'
  | 'other_match'
  | 'offline'
  | 'server'
  | 'denied';

/** Colour family: ok = green, warn = amber, bad = red, down = could not check. */
export type VerdictTone = 'ok' | 'warn' | 'bad' | 'down';

export interface Verdict {
  kind: VerdictKind;
  tone: VerdictTone;
  /** Material icon name. */
  glyph: string;
  title: string;
  /** What the steward should do next. */
  instruction?: string;
  holderName?: string;
  /** "B szektor · 5. sor · 12. szék". */
  seat?: string;
  /** The entrance gate (1..4) of the ticket's sector; null/absent = unknown. Information only. */
  gate?: number | null;
  /** "Kecskeméti TE – Újpest FC". */
  fixture?: string;
  typeLabel?: string;
  /** ISO time the ticket was scanned (already-used only). */
  scannedAt?: string;
  /** The check never happened: nobody may be admitted, retry is offered. */
  retryable: boolean;
}

export const SOURCE_LABELS: Readonly<Record<TicketSource, string>> = {
  single: 'Egyedi jegy',
  season_pass: 'Bérlet',
  loan: 'Kölcsönzött bérlet',
};

/** Why the server refused a code, in words a steward can act on. */
const INVALID_REASONS: Readonly<Record<string, string>> = {
  revoked: 'Ezt a kódot lecserélték vagy visszavonták. Kérd, hogy nyissa meg újra a jegyét.',
  ticket_status_cancelled: 'A jegyet visszamondták.',
  ticket_status_refunded: 'A jegy árát visszatérítették.',
  ticket_status_pending_payment: 'A jegy még nincs kifizetve.',
};
const INVALID_DEFAULT = 'Ez a kód nem érvényes jegy. Olvasd be újra, vagy kérj másik jegyet.';

export function seatText(seat: TicketScanResponse['seat']): string | undefined {
  return seat
    ? `${sectorName(seat.section, seat.sectorName)} · ${seat.row}. sor · ${seat.number}. szék`
    : undefined;
}

function fixtureText(match: TicketScanResponse['match']): string | undefined {
  return match ? `${match.homeTeam} – ${match.awayTeam}` : undefined;
}

function expired(common: Partial<Verdict>, instruction: string): Verdict {
  return {
    ...common,
    kind: 'expired',
    tone: 'bad',
    glyph: 'schedule',
    title: 'LEJÁRT JEGY',
    instruction,
    retryable: false,
  };
}

/** The verdict for an answer the scan endpoint actually gave. */
export function verdictFromResponse(res: TicketScanResponse): Verdict {
  const common = {
    holderName: res.holderName,
    seat: seatText(res.seat),
    gate: res.seat?.gate ?? null,
    fixture: fixtureText(res.match),
    typeLabel: res.source ? SOURCE_LABELS[res.source] : undefined,
    retryable: false,
  };

  if (res.success && res.result === 'ok') {
    return { ...common, kind: 'admitted', tone: 'ok', glyph: 'check_circle', title: 'BELÉPHET' };
  }

  switch (res.result) {
    case 'already_used':
      return {
        ...common,
        kind: 'used',
        tone: 'warn',
        glyph: 'warning',
        title: 'MÁR FELHASZNÁLVA',
        instruction: 'Küldd az ügyfélszolgálati pulthoz.',
        scannedAt: res.scannedAt,
      };
    case 'expired':
      return expired(common, 'A jegy érvényessége lejárt, nem léphet be.');
    case 'wrong_match':
      return {
        ...common,
        kind: 'other_match',
        tone: 'bad',
        glyph: 'swap_horiz',
        title: 'MÁSIK MÉRKŐZÉS',
        instruction: 'Ez a jegy nem erre a mérkőzésre szól.',
      };
    default:
      // The token itself can be past its expiry: same refusal as an expired ticket.
      if (res.message === 'expired') {
        return expired(common, 'A kód érvényessége lejárt, nem léphet be.');
      }
      return {
        ...common,
        kind: 'invalid',
        tone: 'bad',
        glyph: 'cancel',
        title: 'ÉRVÉNYTELEN KÓD',
        instruction: (res.message && INVALID_REASONS[res.message]) || INVALID_DEFAULT,
      };
  }
}

/** A scanned code that is not even shaped like a ticket token. */
export function verdictNotATicket(): Verdict {
  return {
    kind: 'invalid',
    tone: 'bad',
    glyph: 'cancel',
    title: 'ÉRVÉNYTELEN KÓD',
    instruction: 'Ez nem jegy QR-kódja. Olvasd be újra, vagy kérj másik jegyet.',
    retryable: false,
  };
}

/**
 * The check could not be done. Nobody is admitted on this verdict: the gate
 * has no offline mode, because an offline scan cannot know whether the ticket
 * was already used at another gate.
 */
export function verdictFromFailure(status: number | null): Verdict {
  if (status === 401 || status === 403) {
    return {
      kind: 'denied',
      tone: 'down',
      glyph: 'lock',
      title: 'NINCS JOGOSULTSÁG',
      instruction: 'Jelentkezz be újra beléptető fiókkal. Ezt a jegyet még nem ellenőrizte senki.',
      retryable: false,
    };
  }
  if (status === 0 || status === null) {
    return {
      kind: 'offline',
      tone: 'down',
      glyph: 'wifi_off',
      title: 'NINCS HÁLÓZAT',
      instruction:
        'A jegy nem ellenőrizhető, ezért nem léphet be. Várd meg a kapcsolatot, majd próbáld újra.',
      retryable: true,
    };
  }
  if (status === 400 || status === 422) {
    return verdictNotATicket();
  }
  return {
    kind: 'server',
    tone: 'down',
    glyph: 'cloud_off',
    title: 'A SZERVER NEM VÁLASZOL',
    instruction: 'A jegy nem ellenőrizhető, ezért nem léphet be. Próbáld újra.',
    retryable: true,
  };
}

/** Admitted gets one sound/buzz pattern; every other verdict gets the refusal pattern. */
export function isAdmission(v: Verdict): boolean {
  return v.kind === 'admitted';
}

/** "ma 17:40" for today, "nov. 8. 17:40" otherwise. */
export function whenLabel(iso: string | undefined, now: Date): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const time = d.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `ma ${time}`;
  return `${d.toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' })} ${time}`;
}

/** "3-as kapu", the words under the seat line; null when the gate is unknown. */
export function gateText(gate: number | null | undefined): string | null {
  return gateLabel(gate);
}

/**
 * The amber note when a ticket belongs to another gate than the one this
 * steward is standing at: "Ez a jegy az 1-es kapuhoz tartozik."
 *
 * ADVISORY ONLY. It is shown next to the verdict and never replaces or changes
 * it: a steward must never turn anyone away over a gate number, so the person is
 * admitted exactly as before. Null when either gate is unknown or they match.
 */
export function gateNote(ticketGate: number | null | undefined, myGate: number | null): string | null {
  const label = gateLabel(ticketGate);
  if (!label || myGate === null || ticketGate === myGate) {
    return null;
  }
  return `Ez a jegy ${hungarianArticle(label)} ${label}hoz tartozik.`;
}
