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

export const TICKET_STATUS_COLORS: Record<TicketStatus, string> = {
  pending_payment: '#FFC700',
  paid: '#4CAF50',
  cancelled: '#777777',
  refunded: '#777777',
  used: '#4B8EC9',
  expired: '#C94B1E',
};
