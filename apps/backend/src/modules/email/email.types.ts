/**
 * Strongly typed payloads for every transactional email the platform sends.
 * Adding a new template means adding a new union variant here so the
 * EmailService.send() method is exhaustive at compile time.
 */
export type EmailTemplateName =
  | 'ticket-confirmation'
  | 'loan-invitation'
  | 'loan-confirmation'
  | 'loan-cancelled'
  | 'tier-upgraded'
  | 'waitlist-notification'
  | 'seat-refund'
  | 'password-reset'
  | 'password-changed';

export interface TicketConfirmationContext {
  recipientName: string;
  matchTitle: string;
  matchVenue: string;
  matchKickoffLabel: string;
  tickets: Array<{
    seatLabel: string;
    categoryLabel: string;
    pricePaidLabel: string;
    gateLabel?: string;
  }>;
  totalLabel: string;
  ticketsUrl: string;
  qrImageDataUrls: Array<{ ticketId: string; seatLabel: string; dataUrl: string }>;
}

export interface LoanInvitationContext {
  recipientName: string;
  lenderName: string;
  matchTitle: string;
  matchVenue: string;
  matchKickoffLabel: string;
  seatLabel: string;
  expiresAtLabel: string;
  acceptUrl: string;
}

export interface LoanConfirmationContext {
  recipientName: string;
  borrowerName: string;
  matchTitle: string;
  matchVenue: string;
  matchKickoffLabel: string;
  seatLabel: string;
  qrDataUrl: string;
  qrUrl: string;
  isLender: boolean;
}

export interface LoanCancelledContext {
  recipientName: string;
  matchTitle: string;
  matchKickoffLabel: string;
  reason?: string;
  isLender: boolean;
}

export interface TierUpgradedContext {
  recipientName: string;
  newTierLabel: string;
  newDiscountPercent: number;
  pointsBalance: number;
  loyaltyDashboardUrl: string;
}

export interface WaitlistNotificationContext {
  recipientName: string;
  matchTitle: string;
  matchVenue: string;
  matchKickoffLabel: string;
  windowMinutes: number;
  expiresAtLabel: string;
  confirmUrl: string;
}

export interface SeatRefundContext {
  recipientName: string;
  matchTitle: string;
  matchKickoffLabel: string;
  takenSeatCount: number;
  refundLabel: string;
}

export interface PasswordResetContext {
  recipientName: string;
  resetUrl: string;
  /** "60 perc" / "1 óra", for the sentence about how long the link works. */
  validForLabel: string;
}

export interface PasswordChangedContext {
  recipientName: string;
  /** When the password was changed, in the stadium timezone. */
  changedAtLabel: string;
  /** "Chrome, Windows · 84.2.51.x" - only what is known; absent when nothing is. */
  clientLabel?: string;
  supportEmail: string;
}

export type EmailContextMap = {
  'ticket-confirmation': TicketConfirmationContext;
  'loan-invitation': LoanInvitationContext;
  'loan-confirmation': LoanConfirmationContext;
  'loan-cancelled': LoanCancelledContext;
  'tier-upgraded': TierUpgradedContext;
  'waitlist-notification': WaitlistNotificationContext;
  'seat-refund': SeatRefundContext;
  'password-reset': PasswordResetContext;
  'password-changed': PasswordChangedContext;
};

export interface SendEmailRequest<T extends EmailTemplateName = EmailTemplateName> {
  to: string;
  subject: string;
  template: T;
  context: EmailContextMap[T];
  /** Used for idempotency / retry deduplication logging. */
  correlationId?: string;
}
