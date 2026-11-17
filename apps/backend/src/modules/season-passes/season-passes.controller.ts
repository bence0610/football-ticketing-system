import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { TicketQrResponseDto } from '../tickets/dto/ticket-response.dto';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  SeasonPassHoldResponseDto,
  SeasonPassSeatMapDto,
  SeasonPassTierSectorsDto,
} from './dto/season-pass-seats.dto';
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
    summary:
      'Aktív szezon (2026/2027) bérletárainak listája árkategóriánként (felső ív, alsó ív, VIP)',
  })
  @ApiOkResponse({ type: [SeasonPassPriceDto] })
  async listPrices(): Promise<SeasonPassPriceDto[]> {
    return this.seasonPassesService.listPrices();
  }

  @Get('tiers/:tier/sectors')
  @ApiOperation({
    summary: 'Egy árkategória szektorai a bérletre még kiadható helyek számával',
    description:
      'Ugyanaz a szektorlista, mint a `GET /season-passes/prices` elemeinek `sectors` mezője. Vendégszektor nélkül, stadionsorrendben.',
  })
  @ApiOkResponse({ type: SeasonPassTierSectorsDto })
  @ApiNotFoundResponse({ description: '`tier_not_found`' })
  listTierSectors(@Param('tier') tier: string): Promise<SeasonPassTierSectorsDto> {
    return this.seasonPassesService.listTierSectors(tier);
  }

  @Get('seats')
  @ApiOperation({
    summary: 'Egy szektor bérlet-helytérképe az aktív szezonra',
    description:
      'A szektor kódja query paraméterben jön, mert perjelet tartalmazhat (`?section=D/1`). Státusz: `available`, `season_pass` (erre a szezonra már bérlet szól rá, bármilyen állapotban), `locked` (más vásárló épp fizet érte), `disabled`. Az egyes meccsekre eladott jegyek nem számítanak. Vendégszektor: 403, ismeretlen szektor: 404.',
  })
  @ApiQuery({ name: 'section', example: 'D/1' })
  @ApiOkResponse({ type: SeasonPassSeatMapDto })
  @ApiForbiddenResponse({ description: '`away_section`' })
  @ApiNotFoundResponse({ description: '`sector_not_found` / `tier_not_found`' })
  getSeasonSeatMap(@Query('section') section?: string): Promise<SeasonPassSeatMapDto> {
    const code = section?.trim();
    if (!code) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'A section query paraméter kötelező.',
        code: 'section_required',
      });
    }
    return this.seasonPassesService.getSeasonSeatMap(code);
  }

  @Post('seats/:seatId/hold')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'A választott bérlethely lefoglalása a fizetés idejére',
    description:
      'Atomi Redis foglalás (alapból 15 perc). Felhasználónként és szezononként egy hely: új hely választása feloldja az előzőt. A saját hely újrafoglalása ugyanazt a tokent adja vissza és újraindítja az időt. 409 `seat_taken` (bérlet szól rá) vagy `seat_held` (más foglalja), 403 vendégszektor, 404 ismeretlen hely.',
  })
  @ApiCreatedResponse({ type: SeasonPassHoldResponseDto })
  @ApiConflictResponse({ description: '`seat_taken`, `seat_held` vagy `seat_disabled`' })
  holdSeat(
    @Param('seatId', new ParseUUIDPipe()) seatId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<SeasonPassHoldResponseDto> {
    return this.seasonPassesService.holdSeat(extractUserId(req), seatId);
  }

  @Delete('seats/:seatId/hold')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'A bérlethely-foglalás feloldása',
    description: 'Csak egyező holdToken esetén töröl (Lua). Idempotens: mindig 204.',
  })
  @ApiQuery({ name: 'holdToken' })
  @ApiNoContentResponse()
  async releaseSeatHold(
    @Param('seatId', new ParseUUIDPipe()) seatId: string,
    @Query('holdToken') holdToken: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    if (!holdToken) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'A holdToken query paraméter kötelező.',
        code: 'hold_token_required',
      });
    }
    await this.seasonPassesService.releaseSeatHold(extractUserId(req), seatId, holdToken);
  }

  @Get('season')
  @ApiOperation({
    summary: 'Az aktív szezon hazai mérkőzései és a bérletvásárlás hűségpontja (a birtokosé)',
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
      'A választott helyre (`seatId` + a foglalás `holdToken`-je) szól. Fizetés előtt ellenőrzi, hogy a hely még szabad és a vevőé a foglalás (409 `seat_taken` / `hold_lost`). Stripe PaymentIntent létrehozása + szerveroldali megerősítés a megadott PaymentMethod-dal. Sikeres fizetés esetén SeasonPass jön létre pontosan erre a helyre (ha közben elkelt, teljes visszatérítés) és hűségpont kerül jóváírásra.',
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
    return items.map(({ pass, loans, seat, sectorName, gate }) => {
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
        sectorName,
        gate,
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
