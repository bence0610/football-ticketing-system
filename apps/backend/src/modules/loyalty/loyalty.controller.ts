import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { LoyaltyTransaction, UserRole } from '../../database/entities';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { LoyaltyService } from './loyalty.service';
import {
  LoyaltySnapshotResponseDto,
  LoyaltyTierResponseDto,
  LoyaltyTransactionResponseDto,
} from './dto/loyalty-snapshot.dto';

interface AuthenticatedRequest extends Request {
  user?: { sub: string; userId?: string; id?: string };
}

const MAX_PAGE = 100;

@ApiTags('Loyalty')
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('transactions/count')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiBearerAuth()
  @ApiOkResponse({ description: 'Total loyalty transactions count (admin only)' })
  async count(): Promise<{ total: number }> {
    const total = await this.loyaltyService.count();
    return { total };
  }

  @Get('tiers')
  @ApiOkResponse({ type: [LoyaltyTierResponseDto] })
  getTiers(): LoyaltyTierResponseDto[] {
    return this.loyaltyService.getTierDefinitions().map((t) => ({
      tier: t.tier,
      label: t.label,
      minPoints: t.minPoints,
      discountPercent: t.discountPercent,
      color: t.color,
    }));
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: LoyaltySnapshotResponseDto })
  async getMine(@Req() req: AuthenticatedRequest): Promise<LoyaltySnapshotResponseDto> {
    const userId = req.user?.sub ?? req.user?.userId ?? req.user?.id;
    if (!userId) {
      throw new Error('Authenticated user id missing from request');
    }
    const snapshot = await this.loyaltyService.getSnapshot(userId);
    return {
      points: snapshot.points,
      tier: { ...snapshot.tier },
      nextTier: snapshot.nextTier ? { ...snapshot.nextTier } : undefined,
      pointsToNextTier: snapshot.pointsToNextTier,
      ticketPointsPerTicket: snapshot.ticketPointsPerTicket,
      earning: { ...snapshot.earning },
      matchesAttended: snapshot.matchesAttended,
      totalTransactions: snapshot.totalTransactions,
      recentTransactions: snapshot.recentTransactions.map(toTransactionDto),
    };
  }

  @Get('me/transactions')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOkResponse({ type: [LoyaltyTransactionResponseDto] })
  async getMyTransactions(
    @Req() req: AuthenticatedRequest,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('limit', new DefaultValuePipe(MAX_PAGE), ParseIntPipe) limit: number,
  ): Promise<LoyaltyTransactionResponseDto[]> {
    const userId = req.user?.sub ?? req.user?.userId ?? req.user?.id;
    if (!userId) {
      throw new Error('Authenticated user id missing from request');
    }
    const rows = await this.loyaltyService.getTransactions(
      userId,
      Math.max(offset, 0),
      Math.min(Math.max(limit, 1), MAX_PAGE),
    );
    return rows.map(toTransactionDto);
  }
}

function toTransactionDto(tx: LoyaltyTransaction): LoyaltyTransactionResponseDto {
  return {
    id: tx.id,
    type: tx.type,
    source: tx.source,
    points: tx.points,
    balanceAfter: tx.balanceAfter,
    description: tx.description,
    referenceId: tx.referenceId,
    createdAt: tx.createdAt.toISOString(),
  };
}
