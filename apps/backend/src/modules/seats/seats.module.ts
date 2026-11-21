import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Seat, SeasonPass, Sector, Ticket } from '../../database/entities';
import { SlidingWindowLimiter } from '../../common/rate-limit/sliding-window.limiter';
import { AuthModule } from '../auth/auth.module';
import { BestSeatsService } from './best-seats.service';
import { MatchSeatsController } from './match-seats.controller';
import { SeatsController } from './seats.controller';
import { SeatsService } from './seats.service';
import { SectorCatalogueService } from './sector-catalogue.service';

@Module({
  imports: [TypeOrmModule.forFeature([Seat, Ticket, Match, SeasonPass, Sector]), AuthModule],
  controllers: [SeatsController, MatchSeatsController],
  providers: [SeatsService, BestSeatsService, SectorCatalogueService, SlidingWindowLimiter],
  exports: [SeatsService, SectorCatalogueService],
})
export class SeatsModule {}
