import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Seat, Ticket } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { MatchesModule } from '../matches/matches.module';
import { AdminController } from './admin.controller';
import { AdminOccupancyService } from './admin-occupancy.service';
import { AdminRevenueService } from './admin-revenue.service';
import { AdminService } from './admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([Match, Seat, Ticket]), AuthModule, MatchesModule],
  controllers: [AdminController],
  providers: [AdminService, AdminRevenueService, AdminOccupancyService],
  exports: [AdminService, AdminRevenueService, AdminOccupancyService],
})
export class AdminModule {}
