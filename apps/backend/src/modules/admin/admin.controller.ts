import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../../database/entities';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminOccupancyService } from './admin-occupancy.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminRevenueService } from './admin-revenue.service';
import { AdminService } from './admin.service';
import {
  MatchOccupancyDto,
  OVERVIEW_PERIODS,
  OverviewDto,
  OverviewPeriod,
  RevenueStatsDto,
  SeatSalesDto,
} from './dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly revenueService: AdminRevenueService,
    private readonly occupancyService: AdminOccupancyService,
    private readonly overviewService: AdminOverviewService,
  ) {}

  @Get('health')
  @ApiOkResponse({ description: 'Admin module health check' })
  health(): { module: string; status: 'ready' } {
    return this.adminService.ping();
  }

  @Get('revenue')
  @ApiOperation({ summary: 'Bevételi statisztikák (mai / havi / idősor / meccs szerint)' })
  @ApiQuery({ name: 'days', required: false, description: 'Idősor hossza napban (default 30)' })
  @ApiOkResponse({ type: RevenueStatsDto })
  async revenue(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ): Promise<RevenueStatsDto> {
    const safeDays = Math.min(Math.max(days, 7), 365);
    return this.revenueService.getStats(safeDays);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Áttekintés: mérőszámok és meccsenkénti bontás (csak olvasható)' })
  @ApiQuery({ name: 'period', required: false, enum: OVERVIEW_PERIODS })
  @ApiOkResponse({ type: OverviewDto })
  async overview(@Query('period') period?: string): Promise<OverviewDto> {
    const safe: OverviewPeriod = (OVERVIEW_PERIODS as readonly string[]).includes(period ?? '')
      ? (period as OverviewPeriod)
      : 'season';
    return this.overviewService.getOverview(safe);
  }

  @Get('seat-sales')
  @ApiOperation({ summary: 'Ülésenkénti értékesítési gyakoriság a szezonban (csak olvasható)' })
  @ApiOkResponse({ type: SeatSalesDto })
  async seatSales(): Promise<SeatSalesDto> {
    return this.overviewService.getSeatSales();
  }

  @Get('matches/:matchId/occupancy')
  @ApiOperation({ summary: 'Heatmap-hez szektoronkénti foglaltság egy meccsre' })
  @ApiOkResponse({ type: MatchOccupancyDto })
  async occupancy(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
  ): Promise<MatchOccupancyDto> {
    return this.occupancyService.getOccupancyForMatch(matchId);
  }
}
