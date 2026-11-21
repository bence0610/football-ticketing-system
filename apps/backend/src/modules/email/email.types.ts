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
  | 'password-changed'
  | 'email-change-confirm'
  | 'email-change-requested'
  | 'email-changed';

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
  /** Points for entering the match (once per person per match). Buying earns none. */
  attendancePoints: number;
  ticketsUrl: string;
  qrImageDataUrls: Array<{ ticketId: string; seatLabel: string; dataUrl: string }>;
}

export interface LoanInvitationContext {
  /** The invitee may have no account, so there is deliberately no recipient name. */
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
  lenderName: string;
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
  /** Absent when the borrower has no account (we only know the address). */
  recipientName?: string;
  lenderName: string;
  matchTitle: string;
  matchKickoffLabel: string;
  reason?: string;
  isLender: boolean;
  /** True when the borrower had already accepted, i.e. a QR code was issued that now stops working. */
  qrIssued: boolean;
}

export interface TierUpgradedContext {
  recipientName: string;
  newTierLabel: string;
  newDiscountPercent: number;
  pointsBalance: number;
  /** The tier after this one, when there is one. */
  nextTierLabel?: string;
  pointsToNextTier?: number;
  /** Points for entering a match, once per person per match. */
  attendancePoints: number;
  /** Share of the balance kept at the 30 June conversion (0-100). */
  carryoverPercent: number;
  /** The tier discount applies to at most this many tickets per buyer per match. */
  discountTicketLimit: number;
  loyaltyDashboardUrl: string;
}

export interface WaitlistNotificationContext {
  recipientName: string;
  matchTitle: string;
  matchVenue: string;
  matchKickoffLabel: string;
  /** Display name of the sector the freed seat is in ("D/1 szektor"); absent when not known. */
  freedSectorName?: string;
  windowMinutes: number;
  expiresAtLabel: string;
  confirmUrl: string;
}

export interface SeatRefundContext {
  recipientName: string;
  matchTitle: string;
  matchKickoffLabel: string;
  takenSeatCount: number;
  /** True when nothing was issued and the whole payment is refunded. */
  wholePayment?: boolean;
  /** True when the seat turned out to be a season-pass seat for this match. */
  passSeat?: boolean;
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
  /** True when it was changed signed in, on the profile page; false/absent: with a reset link. */
  viaSettings?: boolean;
}

/** Sent to the NEW address: the link that makes the change happen. */
export interface EmailChangeConfirmContext {
  recipientName: string;
  newEmail: string;
  confirmUrl: string;
  /** "60 perc" / "1 óra". */
  validForLabel: string;
}

/** Sent to the CURRENT address when a change is asked for; nothing has changed yet. */
export interface EmailChangeRequestedContext {
  recipientName: string;
  /** The requested address, masked: "j***@d***.hu". */
  maskedNewEmail: string;
  requestedAtLabel: string;
  clientLabel?: string;
  supportEmail: string;
}

/** Sent to the OLD address once the new one is confirmed. Carries no token. */
export interface EmailChangedContext {
  recipientName: string;
  maskedNewEmail: string;
  changedAtLabel: string;
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
  'email-change-confirm': EmailChangeConfirmContext;
  'email-change-requested': EmailChangeRequestedContext;
  'email-changed': EmailChangedContext;
};

export interface SendEmailRequest<T extends EmailTemplateName = EmailTemplateName> {
  to: string;
  subject: string;
  template: T;
  context: EmailContextMap[T];
  /** Used for idempotency / retry deduplication logging. */
  correlationId?: string;
}
