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
import { PurchaseSeasonPassResponseDto } from './dto/purchase-season-pass-response.dto';
import { SeasonPassPriceDto } from './dto/season-pass-price.dto';
import {
  PassLoanResponseDto,
  SeasonPassResponseDto,
} from './dto/season-pass-response.dto';
import { PassLoan } from '../../database/entities';

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
    return items.map(({ pass, loans, seat }) => ({
      id: pass.id,
      status: pass.status,
      seasonLabel: pass.seasonLabel,
      validFrom: pass.validFrom.toISOString(),
      validUntil: pass.validUntil.toISOString(),
      seatLabel: seat,
      section: pass.seat?.section,
      purchasedAt: pass.createdAt.toISOString(),
      pricePaid: pass.pricePaid,
      currency: pass.currency,
      loans: loans.map(loanToDto),
    }));
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
  @ApiOkResponse({ type: PassLoanResponseDto })
  async acceptLoan(
    @Param('token') token: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<PassLoanResponseDto> {
    const userId = extractUserId(req);
    const loan = await this.seasonPassesService.acceptLoan(token, userId);
    return loanToDto(loan);
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
