import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Seat, SeasonPass, Sector, Ticket } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { MatchSeatsController } from './match-seats.controller';
import { SeatsController } from './seats.controller';
import { SeatsService } from './seats.service';
import { SectorCatalogueService } from './sector-catalogue.service';

@Module({
  imports: [TypeOrmModule.forFeature([Seat, Ticket, Match, SeasonPass, Sector]), AuthModule],
  controllers: [SeatsController, MatchSeatsController],
  providers: [SeatsService, SectorCatalogueService],
  exports: [SeatsService, SectorCatalogueService],
})
export class SeatsModule {}
