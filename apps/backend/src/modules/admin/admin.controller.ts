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
import { AdminRevenueService } from './admin-revenue.service';
import { AdminService } from './admin.service';
import { MatchOccupancyDto, RevenueStatsDto } from './dto';

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

  @Get('matches/:matchId/occupancy')
  @ApiOperation({ summary: 'Heatmap-hez szektoronkénti foglaltság egy meccsre' })
  @ApiOkResponse({ type: MatchOccupancyDto })
  async occupancy(
    @Param('matchId', new ParseUUIDPipe()) matchId: string,
  ): Promise<MatchOccupancyDto> {
    return this.occupancyService.getOccupancyForMatch(matchId);
  }
}
