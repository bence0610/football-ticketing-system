import { formatFullName } from '../../common/format-name';
import loyaltyConfig from '../../config/loyalty.config';
import { TIER_DEFINITIONS } from '../loyalty/loyalty.constants';
import { TicketRendererService } from '../tickets/ticket-renderer.service';
import { matchSubject } from './email-subject';
import { EmailContextMap, EmailTemplateName } from './email.types';

/**
 * One realistic example of every e-mail, built with the same helpers the services use (match
 * summary, tier table, loyalty rule, name and subject formatting) so previews, the template spec
 * and the Mailtrap smoke send all exercise the real wording and numbers.
 */
export interface EmailFixture<T extends EmailTemplateName = EmailTemplateName> {
  template: T;
  /** Short note on which variant this is (several templates serve two audiences). */
  variant: string;
  subject: string;
  context: EmailContextMap[T];
}

const BASE_URL = 'https://jegy.kte.hu';
const SUPPORT = 'jegy@kte.hu';

const match = {
  homeTeam: 'Kecskeméti TE',
  awayTeam: 'Újpest FC',
  venue: 'Széktói Stadion',
  kickoffAt: new Date('2026-11-29T14:00:00Z'), // 15:00 Budapest
};

export function buildFixtures(qrDataUrl: string): EmailFixture[] {
  const summary = new TicketRendererService().matchSummary(match as never);
  const lender = { firstName: 'Bence', lastName: 'Szabó' };
  const borrower = { firstName: 'Anna', lastName: 'Kiss' };
  const lenderName = formatFullName(lender);
  const borrowerName = formatFullName(borrower);
  const matchInfo = {
    matchTitle: summary.title,
    matchVenue: summary.venue,
    matchKickoffLabel: summary.kickoffLabel,
  };
  const seatLabel = 'D/1 szektor / 7. sor / 12. szék';
  const attendancePoints = loyaltyConfig().attendancePoints;
  const tier = TIER_DEFINITIONS[1]; // Ezüst
  const nextTier = TIER_DEFINITIONS[2];
  const tickets = [
    { seatLabel, categoryLabel: 'Normál', pricePaidLabel: '4 500 HUF', gateLabel: '2-es kapu' },
    {
      seatLabel: 'D/1 szektor / 7. sor / 13. szék',
      categoryLabel: 'Normál',
      pricePaidLabel: '4 500 HUF',
      gateLabel: '2-es kapu',
    },
  ];

  const fixtures: EmailFixture[] = [
    {
      template: 'loan-invitation',
      variant: 'borrower, may have no account',
      subject: matchSubject(`${lenderName} átadja a helyét`, match),
      context: {
        lenderName,
        ...matchInfo,
        seatLabel,
        expiresAtLabel: '2026. november 29. (vasárnap) 15:00',
        acceptUrl: `${BASE_URL}/loans/accept/TOKEN-0123456789abcdef`,
      },
    },
    {
      template: 'loan-confirmation',
      variant: 'to the lender',
      subject: matchSubject(`${borrowerName} elfogadta a helyedet`, match),
      context: {
        recipientName: lender.firstName,
        lenderName,
        borrowerName,
        ...matchInfo,
        seatLabel,
        qrDataUrl: '',
        qrUrl: `${BASE_URL}/profile/loans/LOAN-ID`,
        isLender: true,
      },
    },
    {
      template: 'loan-confirmation',
      variant: 'to the borrower, with QR',
      subject: matchSubject(`${lenderName} helye a tiéd, itt a belépőd`, match),
      context: {
        recipientName: borrower.firstName,
        lenderName,
        borrowerName,
        ...matchInfo,
        seatLabel,
        qrDataUrl,
        qrUrl: `${BASE_URL}/profile/loans/LOAN-ID`,
        isLender: false,
      },
    },
    {
      template: 'loan-cancelled',
      variant: 'to the borrower, QR was issued (amber)',
      subject: matchSubject(`${lenderName} visszavonta a kölcsönt`, match),
      context: {
        recipientName: borrower.firstName,
        lenderName,
        matchTitle: summary.title,
        matchKickoffLabel: summary.kickoffLabel,
        isLender: false,
        qrIssued: true,
      },
    },
    {
      template: 'ticket-confirmation',
      variant: 'two seats',
      subject: matchSubject('Megvan a jegyed', match),
      context: {
        recipientName: borrower.firstName,
        ...matchInfo,
        tickets,
        totalLabel: '9 000 HUF',
        attendancePoints,
        ticketsUrl: `${BASE_URL}/profile`,
        qrImageDataUrls: tickets.map((t, i) => ({
          ticketId: `T${i}`,
          seatLabel: t.seatLabel,
          dataUrl: qrDataUrl,
        })),
      },
    },
    {
      template: 'tier-upgraded',
      variant: 'Ezüst',
      subject: `Új hűségszinted: ${tier.label} — ${tier.discountPercent}% kedvezmény a jegyekből`,
      context: {
        recipientName: borrower.firstName,
        newTierLabel: tier.label,
        newDiscountPercent: tier.discountPercent,
        pointsBalance: 550,
        nextTierLabel: nextTier.label,
        pointsToNextTier: nextTier.minPoints - 550,
        attendancePoints,
        carryoverPercent: loyaltyConfig().carryoverPercent,
        loyaltyDashboardUrl: `${BASE_URL}/loyalty`,
      },
    },
    {
      template: 'waitlist-notification',
      variant: 'sector known',
      subject: matchSubject('Felszabadult egy hely: D/1 szektor', match),
      context: {
        recipientName: borrower.firstName,
        ...matchInfo,
        freedSectorName: 'D/1 szektor',
        windowMinutes: 15,
        expiresAtLabel: '2026. november 20. 18:15',
        confirmUrl: `${BASE_URL}/profile?waitlistMatchId=MATCH-ID`,
      },
    },
    {
      template: 'seat-refund',
      variant: 'one seat taken',
      subject: matchSubject('Visszatérítés folyamatban', match),
      context: {
        recipientName: borrower.firstName,
        matchTitle: summary.title,
        matchKickoffLabel: summary.kickoffLabel,
        takenSeatCount: 1,
        refundLabel: '4 500 Ft',
      },
    },
    {
      template: 'password-reset',
      variant: 'default',
      subject: 'Jelszó-visszaállítás - KTE Jegyportál',
      context: {
        recipientName: borrower.firstName,
        resetUrl: `${BASE_URL}/reset-password/TOKEN-0123456789abcdef0123456789abcdef`,
        validForLabel: '60 perc',
      },
    },
    {
      template: 'password-changed',
      variant: 'via reset link',
      subject: 'A jelszavad megváltozott - KTE Jegyportál',
      context: {
        recipientName: borrower.firstName,
        changedAtLabel: '2026. november 16. 19:45',
        clientLabel: 'Chrome, Windows · 84.2.51.x',
        supportEmail: SUPPORT,
      },
    },
    {
      template: 'email-change-confirm',
      variant: 'to the new address',
      subject: 'Erősítsd meg az új e-mail-címed - KTE Jegyportál',
      context: {
        recipientName: borrower.firstName,
        newEmail: 'anna.uj@pelda.hu',
        confirmUrl: `${BASE_URL}/confirm-email/TOKEN-0123456789abcdef`,
        validForLabel: '60 perc',
      },
    },
    {
      template: 'email-change-requested',
      variant: 'to the current address',
      subject: 'E-mail-cím módosítását kérték - KTE Jegyportál',
      context: {
        recipientName: borrower.firstName,
        maskedNewEmail: 'a***@p***.hu',
        requestedAtLabel: '2026. november 16. 19:30',
        clientLabel: 'Chrome, Windows · 84.2.51.x',
        supportEmail: SUPPORT,
      },
    },
    {
      template: 'email-changed',
      variant: 'to the old address',
      subject: 'Az e-mail-címed megváltozott - KTE Jegyportál',
      context: {
        recipientName: borrower.firstName,
        maskedNewEmail: 'a***@p***.hu',
        changedAtLabel: '2026. november 16. 19:45',
        clientLabel: 'Chrome, Windows · 84.2.51.x',
        supportEmail: SUPPORT,
      },
    },
  ] as EmailFixture[];
  return fixtures;
}
