import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Ticket, TicketStatus } from '../../database/entities';
import { QrService } from '../qr/qr.service';
import { TicketScanResponseDto } from './dto/scan-ticket.dto';
import { WaitlistNotificationService } from '../waitlist/waitlist-notification.service';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly qrService: QrService,
    @Optional()
    @Inject(forwardRef(() => WaitlistNotificationService))
    private readonly waitlistNotifier?: WaitlistNotificationService,
  ) {}

  async count(): Promise<number> {
    return this.ticketRepository.count();
  }

  async findForUser(userId: string): Promise<Ticket[]> {
    return this.ticketRepository.find({
      where: { userId },
      relations: ['match', 'seat'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(ticketId: string, userId?: string): Promise<Ticket> {
    const ticket = await this.ticketRepository.findOne({
      where: { id: ticketId },
      relations: ['match', 'seat'],
    });
    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    if (userId && ticket.userId !== userId) {
      throw new NotFoundException(`Ticket ${ticketId} not found`);
    }
    return ticket;
  }

  /**
   * Generates the QR data URL for a ticket. Used by the user dashboard.
   *
   * The token includes the persisted `qr_jti` so a leaked old token can be
   * rotated (admin can simply update qr_jti on the row to invalidate it).
   */
  async getQrForOwner(ticketId: string, userId: string): Promise<string> {
    const ticket = await this.findById(ticketId, userId);
    if (ticket.status !== TicketStatus.PAID && ticket.status !== TicketStatus.USED) {
      throw new BadRequestException(`Ticket ${ticketId} is not in a presentable state`);
    }
    const result = await this.qrService.generateForTicket(ticket.id, ticket.qrJti);
    return result.dataUrl;
  }

  /**
   * Marks a paid ticket as USED. Idempotent for repeat scans of the same
   * ticket (returns `already_used` instead of throwing).
   *
   * Optional `token` parameter validates the JWT QR before allowing the
   * scan to mutate state. If provided and invalid, the scan is rejected.
   */
  async scanTicket(
    ticketId: string,
    options: { token?: string; scannedByUserId?: string },
  ): Promise<TicketScanResponseDto> {
    if (options.token) {
      const verification = await this.qrService.verify(options.token, 'ticket');
      if (!verification.valid || verification.payload?.sub !== ticketId) {
        return {
          success: false,
          result: 'invalid',
          message: verification.reason ?? 'invalid_token',
        };
      }
    }

    return this.dataSource.transaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const ticket = await ticketRepo.findOne({
        where: { id: ticketId },
        relations: ['match'],
      });
      if (!ticket) {
        return { success: false, result: 'invalid', message: 'ticket_not_found' };
      }
      if (ticket.status === TicketStatus.USED) {
        return {
          success: false,
          result: 'already_used',
          ticketId: ticket.id,
          scannedAt: ticket.scannedAt?.toISOString(),
        };
      }
      if (ticket.status === TicketStatus.EXPIRED) {
        return { success: false, result: 'expired', ticketId: ticket.id };
      }
      if (ticket.status !== TicketStatus.PAID) {
        return {
          success: false,
          result: 'invalid',
          ticketId: ticket.id,
          message: `ticket_status_${ticket.status}`,
        };
      }
      const now = new Date();
      ticket.status = TicketStatus.USED;
      ticket.usedAt = now;
      ticket.scannedAt = now;
      ticket.scannedByUserId = options.scannedByUserId;
      await ticketRepo.save(ticket);
      if (ticket.qrJti) {
        await this.qrService.revoke(ticket.qrJti);
      }
      return {
        success: true,
        result: 'ok',
        ticketId: ticket.id,
        scannedAt: now.toISOString(),
      };
    });
  }

  /**
   * Cancels or refunds a ticket. The seat returns to the available pool, so
   * the next person on the match's waitlist (if any) is notified.
   *
   * Designed to be safe to call from admin tooling and from Stripe refund
   * webhooks — idempotent for repeated calls.
   */
  async cancelTicket(
    ticketId: string,
    options: { reason: 'refunded' | 'cancelled'; actorUserId?: string } = { reason: 'cancelled' },
  ): Promise<Ticket> {
    const ticket = await this.dataSource.transaction(async (manager) => {
      const ticketRepo = manager.getRepository(Ticket);
      const found = await ticketRepo.findOne({ where: { id: ticketId } });
      if (!found) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }
      if (found.status === TicketStatus.CANCELLED || found.status === TicketStatus.REFUNDED) {
        return found;
      }
      found.status = options.reason === 'refunded' ? TicketStatus.REFUNDED : TicketStatus.CANCELLED;
      await ticketRepo.save(found);
      if (found.qrJti) {
        await this.qrService.revoke(found.qrJti).catch(() => undefined);
      }
      return found;
    });

    this.logger.log(
      `Ticket ${ticketId} -> ${ticket.status} by actor=${options.actorUserId ?? 'system'}`,
    );

    // Best-effort: invite the next waitlist member.
    if (this.waitlistNotifier) {
      void this.waitlistNotifier.notifyNextInLine(ticket.matchId).catch((error: unknown) => {
        this.logger.error(
          `notifyNextInLine after cancel(${ticketId}) failed: ${(error as Error).message}`,
        );
      });
    }

    return ticket;
  }
}
