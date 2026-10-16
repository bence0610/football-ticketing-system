export type TicketStatus = 'pending_payment' | 'paid' | 'cancelled' | 'refunded' | 'used' | 'expired';
export type TicketSource = 'single' | 'season_pass' | 'loan';

export interface MatchSummary {
  id: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  kickoffAt: string;
}

export interface SeatSummary {
  id: string;
  section: string;
  row: string;
  number: number;
  category: string;
}

export interface TicketResponse {
  id: string;
  status: TicketStatus;
  source: TicketSource;
  pricePaid: string;
  currency: string;
  match: MatchSummary;
  seat: SeatSummary;
  scannedAt?: string;
  expiredAt?: string;
  usedAt?: string;
}

export interface TicketQrResponse {
  ticketId: string;
  dataUrl: string;
  token: string;
}

export type ScanResult = 'ok' | 'already_used' | 'invalid' | 'expired' | 'wrong_match';

export interface ScanMatchInfo {
  id: string;
  homeTeam: string;
  awayTeam: string;
  venue: string;
  kickoffAt: string;
}

export interface ScanSeatInfo {
  id: string;
  section: string;
  row: string;
  number: number;
  category: string;
}

export interface TicketScanResponse {
  success: boolean;
  result: ScanResult;
  ticketId?: string;
  scannedAt?: string;
  message?: string;
  match?: ScanMatchInfo;
  seat?: ScanSeatInfo;
}

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending_payment: 'Fizetésre vár',
  paid: 'Aktív',
  cancelled: 'Visszamondva',
  refunded: 'Visszatérítve',
  used: 'Felhasznált',
  expired: 'Lejárt',
};

/**
 * Status chip background colors. Values mirror the semantic design tokens
 * (--kte-warn, --kte-success, --kte-faint, --kte-brand-mid, --kte-danger)
 * from styles.scss — kept as raw hex here because they are bound inline
 * via `[style.background]`, which does not reliably resolve CSS custom
 * properties cross-browser. Keep these in sync with styles.scss.
 */
export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  pending_payment: '#C77700', // --kte-seat-locked (warning amber)
  paid: '#2E7D4F',             // --kte-success
  cancelled: '#9D96A8',        // --kte-faint
  refunded: '#9D96A8',         // --kte-faint
  used: '#1F5C8B',             // --kte-seat-pass
  expired: '#8A1C1C',          // --kte-danger
};
