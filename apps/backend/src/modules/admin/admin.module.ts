import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Seat, SeasonPass, SeasonPassPrice, Sector, Ticket } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { MatchesModule } from '../matches/matches.module';
import { AdminController } from './admin.controller';
import { AdminOccupancyService } from './admin-occupancy.service';
import { AdminOverviewService } from './admin-overview.service';
import { AdminRevenueService } from './admin-revenue.service';
import { AdminService } from './admin.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Match, Seat, SeasonPass, SeasonPassPrice, Sector, Ticket]),
    AuthModule,
    MatchesModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminRevenueService, AdminOccupancyService, AdminOverviewService],
  exports: [AdminService, AdminRevenueService, AdminOccupancyService, AdminOverviewService],
})
export class AdminModule {}
