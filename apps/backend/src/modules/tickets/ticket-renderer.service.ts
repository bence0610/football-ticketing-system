import { Injectable } from '@nestjs/common';
import { Match, Seat, Sector, Ticket } from '../../database/entities';
import { gateLabel } from '../seats/gate-label';

const SEAT_CATEGORY_LABELS: Record<string, string> = {
  standard: 'Normál',
  premium: 'Normál', // legacy rows only: new seats are standard or vip
  vip: 'VIP',
  standing: 'Állóhely',
};

export interface RenderedTicketSection {
  seatLabel: string;
  categoryLabel: string;
  pricePaidLabel: string;
  /** "3-as kapu", when the sector's gate is known. */
  gateLabel?: string;
}

export interface MatchSummary {
  title: string;
  venue: string;
  kickoffLabel: string;
}

@Injectable()
export class TicketRendererService {
  formatMatchTitle(match: Match): string {
    return `${match.homeTeam} - ${match.awayTeam}`;
  }

  formatKickoff(date: Date): string {
    // Stable Hungarian date string. Avoids locale runtime drift on different
    // OS images by formatting manually.
    const days = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
    const months = [
      'január',
      'február',
      'március',
      'április',
      'május',
      'június',
      'július',
      'augusztus',
      'szeptember',
      'október',
      'november',
      'december',
    ];
    const d = new Date(date);
    const year = d.getFullYear();
    const month = months[d.getMonth()];
    const day = d.getDate();
    const dayName = days[d.getDay()];
    const hour = d.getHours().toString().padStart(2, '0');
    const minute = d.getMinutes().toString().padStart(2, '0');
    return `${year}. ${month} ${day}. (${dayName}) ${hour}:${minute}`;
  }

  /** `sectorName` is the display name from the sectors table ("D/1 szektor", "VIP"). */
  formatSeat(seat: Seat, sectorName?: string): string {
    return `${sectorName ?? `${seat.section} szektor`} / ${seat.row}. sor / ${seat.number}. szék`;
  }

  formatPrice(amount: string | number, currency: string): string {
    const num = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
    return `${num.toLocaleString('hu-HU')} ${currency}`;
  }

  renderTicketSection(
    ticket: Ticket,
    sectors: ReadonlyMap<string, Sector> = new Map(),
  ): RenderedTicketSection {
    if (!ticket.seat) {
      throw new Error(`Ticket ${ticket.id} has no seat relation loaded`);
    }
    const sector = sectors.get(ticket.seat.section);
    return {
      seatLabel: this.formatSeat(ticket.seat, sector?.name),
      gateLabel: gateLabel(sector?.gate),
      categoryLabel: SEAT_CATEGORY_LABELS[ticket.seat.category] ?? ticket.seat.category,
      pricePaidLabel: this.formatPrice(ticket.pricePaid, ticket.currency),
    };
  }

  matchSummary(match: Match): MatchSummary {
    return {
      title: this.formatMatchTitle(match),
      venue: match.venue,
      kickoffLabel: this.formatKickoff(match.kickoffAt),
    };
  }

  computeTotal(tickets: Ticket[]): string {
    const total = tickets.reduce((acc, t) => acc + Number.parseFloat(t.pricePaid), 0);
    return this.formatPrice(total, tickets[0]?.currency ?? 'HUF');
  }
}
