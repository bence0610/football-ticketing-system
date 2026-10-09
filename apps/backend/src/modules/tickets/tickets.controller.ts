import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { TicketsService } from './tickets.service';
import { ScanTicketDto, TicketScanResponseDto } from './dto/scan-ticket.dto';
import { TicketResponseDto, TicketQrResponseDto } from './dto/ticket-response.dto';
import { Ticket } from '../../database/entities';

interface AuthenticatedRequest extends Request {
  user?: { sub: string; userId?: string; id?: string; role?: string };
}

function extractUserId(req: AuthenticatedRequest): string {
  const userId = req.user?.sub ?? req.user?.userId ?? req.user?.id;
  if (!userId) {
    throw new Error('Authenticated user id missing from request');
  }
  return userId;
}

function ticketToDto(ticket: Ticket): TicketResponseDto {
  if (!ticket.match || !ticket.seat) {
    throw new Error(`Ticket ${ticket.id} missing required relations`);
  }
  return {
    id: ticket.id,
    status: ticket.status,
    source: ticket.source,
    pricePaid: ticket.pricePaid,
    currency: ticket.currency,
    match: {
      id: ticket.match.id,
      homeTeam: ticket.match.homeTeam,
      awayTeam: ticket.match.awayTeam,
      venue: ticket.match.venue,
      kickoffAt: ticket.match.kickoffAt.toISOString(),
    },
    seat: {
      id: ticket.seat.id,
      section: ticket.seat.section,
      row: ticket.seat.row,
      number: ticket.seat.number,
      category: ticket.seat.category,
    },
    scannedAt: ticket.scannedAt?.toISOString(),
    expiredAt: ticket.expiredAt?.toISOString(),
    usedAt: ticket.usedAt?.toISOString(),
  };
}

@ApiTags('Tickets')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('count')
  @ApiOkResponse({ description: 'Total ticket count' })
  async count(): Promise<{ total: number }> {
    const total = await this.ticketsService.count();
    return { total };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: [TicketResponseDto] })
  async listMine(@Req() req: AuthenticatedRequest): Promise<TicketResponseDto[]> {
    const userId = extractUserId(req);
    const tickets = await this.ticketsService.findForUser(userId);
    return tickets.map(ticketToDto);
  }

  @Get(':id/qr')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: TicketQrResponseDto })
  async getQr(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TicketQrResponseDto> {
    const userId = extractUserId(req);
    const dataUrl = await this.ticketsService.getQrForOwner(id, userId);
    return { ticketId: id, dataUrl };
  }

  @Patch(':id/scan')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: TicketScanResponseDto })
  async scan(
    @Param('id') id: string,
    @Body() body: ScanTicketDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<TicketScanResponseDto> {
    const scannedByUserId = req.user?.sub ?? req.user?.userId ?? req.user?.id;
    return this.ticketsService.scanTicket(id, {
      token: body.token,
      scannedByUserId,
    });
  }
}
