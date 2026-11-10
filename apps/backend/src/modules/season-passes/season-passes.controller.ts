import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TicketQrResponseDto } from '../tickets/dto/ticket-response.dto';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SeasonPassesService } from './season-passes.service';
import { CancelLoanDto, CreateLoanDto } from './dto/create-loan.dto';
import { PurchaseSeasonPassDto } from './dto/purchase-season-pass.dto';
import { formatFullName } from '../../common/format-name';
import { PurchaseSeasonPassResponseDto } from './dto/purchase-season-pass-response.dto';
import { SeasonOverviewDto } from './dto/season-overview.dto';
import { SeasonPassPriceDto } from './dto/season-pass-price.dto';
import {
  IncomingLoanDto,
  PassLoanResponseDto,
  SeasonPassResponseDto,
  LoanPreviewDto,
} from './dto/season-pass-response.dto';
import { PassLoan } from '../../database/entities';
import { validityWindow } from './season-pass-validity';

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

function loanToDto(loan: PassLoan): PassLoanResponseDto {
  return {
    id: loan.id,
    status: loan.status,
    borrowerEmail: loan.borrowerEmail,
    borrowerUserId: loan.borrowerUserId,
    borrowerName: loan.borrower ? formatFullName(loan.borrower) || undefined : undefined,
    matchId: loan.matchId,
    matchTitle: loan.match ? `${loan.match.homeTeam} - ${loan.match.awayTeam}` : undefined,
    kickoffAt: loan.match ? loan.match.kickoffAt.toISOString() : undefined,
    expiresAt: loan.expiresAt.toISOString(),
    createdAt: loan.createdAt.toISOString(),
    acceptedAt: loan.acceptedAt?.toISOString(),
    cancelledAt: loan.cancelledAt?.toISOString(),
    completedAt: loan.completedAt?.toISOString(),
  };
}

@ApiTags('SeasonPasses')
@Controller('season-passes')
export class SeasonPassesController {
  constructor(private readonly seasonPassesService: SeasonPassesService) {}

  @Get('prices')
  @ApiOperation({
    summary: 'Aktív szezon (2026/2027) bérletárainak listája szektoronként',
  })
  @ApiOkResponse({ type: [SeasonPassPriceDto] })
  async listPrices(): Promise<SeasonPassPriceDto[]> {
    return this.seasonPassesService.listPrices();
  }

  @Get('season')
  @ApiOperation({
    summary: 'Az aktív szezon hazai mérkőzései és a bérletvásárlás hűségpontja',
  })
  @ApiOkResponse({ type: SeasonOverviewDto })
  async getSeasonOverview(): Promise<SeasonOverviewDto> {
    return this.seasonPassesService.getSeasonOverview();
  }

  @Post('purchase')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Bérlet vásárlása az aktuális szezonra',
    description:
      'Stripe PaymentIntent létrehozása + szerveroldali megerősítés a megadott PaymentMethod-dal. Sikeres fizetés esetén SeasonPass jön létre és +500 hűségpont kerül jóváírásra.',
  })
  @ApiCreatedResponse({ type: PurchaseSeasonPassResponseDto })
  async purchase(
    @Body() body: PurchaseSeasonPassDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PurchaseSeasonPassResponseDto> {
    const userId = extractUserId(req);
    return this.seasonPassesService.purchase(userId, body);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: [SeasonPassResponseDto] })
  async listMine(@Req() req: AuthenticatedRequest): Promise<SeasonPassResponseDto[]> {
    const userId = extractUserId(req);
    const items = await this.seasonPassesService.listForUser(userId);
    return items.map(({ pass, loans, seat }) => {
      const window = validityWindow(pass.validFrom, pass.validUntil);
      return {
        id: pass.id,
        holderName: pass.holderName,
        isBuyer: pass.userId === userId,
        isHolder: pass.holderUserId === userId,
        buyerName: pass.userId !== userId && pass.user ? formatFullName(pass.user) : undefined,
        status: pass.status,
        seasonLabel: pass.seasonLabel,
        validFrom: pass.validFrom.toISOString(),
        validUntil: pass.validUntil.toISOString(),
        coversFrom: window.startsAt.toISOString(),
        coversBefore: window.endsBefore.toISOString(),
        seatLabel: seat,
        section: pass.seat?.section,
        purchasedAt: pass.createdAt.toISOString(),
        pricePaid: pass.pricePaid,
        currency: pass.currency,
        loans: loans.map(loanToDto),
      };
    });
  }

  @Get('my')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'A bejelentkezett felhasználó bérletei (alias a /me végpontra).' })
  @ApiOkResponse({ type: [SeasonPassResponseDto] })
  async listMineAlias(@Req() req: AuthenticatedRequest): Promise<SeasonPassResponseDto[]> {
    return this.listMine(req);
  }

  @Post(':id/loans')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: PassLoanResponseDto })
  async createLoan(
    @Param('id') id: string,
    @Body() body: CreateLoanDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PassLoanResponseDto> {
    const userId = extractUserId(req);
    const loan = await this.seasonPassesService.createLoan(id, userId, body);
    return loanToDto(loan);
  }

  @Post('loans/accept/:token')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PassLoanResponseDto })
  async acceptLoan(
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PassLoanResponseDto> {
    const userId = extractUserId(req);
    const loan = await this.seasonPassesService.acceptLoan(token, userId);
    return loanToDto(loan);
  }

  @Get('loans/incoming')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'A bejelentkezett felhasználónak szóló, még elfogadható kölcsönmeghívók',
    description:
      'Azok a függő, le nem járt meghívók, amelyeket a felhasználó e-mail-címére (vagy fiókjára) küldtek. Az e-mail nélkül is megtalálhatók.',
  })
  @ApiOkResponse({ type: [IncomingLoanDto] })
  async listIncomingLoans(@Req() req: AuthenticatedRequest): Promise<IncomingLoanDto[]> {
    return this.seasonPassesService.listIncomingLoans(extractUserId(req));
  }

  @Get('loans/preview/:token')
  @ApiOperation({ summary: 'Meghívó előnézete — autentikáció nélkül elérhető' })
  @ApiOkResponse({ type: LoanPreviewDto })
  async previewLoan(@Param('token') token: string): Promise<LoanPreviewDto> {
    return this.seasonPassesService.previewLoan(token);
  }

  /**
   * Lazily materialises the pass holder's SEASON_PASS Ticket for the given
   * match (if it does not yet exist) and returns a gate-ready QR token.
   *
   * Blocked if an active loan exists for this (pass, match) — in that
   * case the right of entry belongs to the borrower, not the holder.
   */
  @Get(':passId/qr/:matchId')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'QR kód lekérése bérletesnek egy adott meccsre' })
  @ApiOkResponse({ type: TicketQrResponseDto })
  async getMatchQr(
    @Param('passId') passId: string,
    @Param('matchId') matchId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<TicketQrResponseDto> {
    const userId = extractUserId(req);
    const { ticketId, dataUrl, token, holderName } = await this.seasonPassesService.getMatchQr(
      passId,
      matchId,
      userId,
    );
    return { ticketId, dataUrl, token, holderName };
  }

  @Delete(':id/loans/:loanId')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: PassLoanResponseDto })
  async cancelLoan(
    @Param('id') passId: string,
    @Param('loanId') loanId: string,
    @Body() body: CancelLoanDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<PassLoanResponseDto> {
    const userId = extractUserId(req);
    const loan = await this.seasonPassesService.cancelLoan(passId, loanId, userId, body);
    return loanToDto(loan);
  }
}
