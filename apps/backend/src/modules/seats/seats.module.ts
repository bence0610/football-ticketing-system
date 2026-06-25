import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Seat, SeasonPass, Ticket } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { MatchSeatsController } from './match-seats.controller';
import { SeatsController } from './seats.controller';
import { SeatsService } from './seats.service';

@Module({
  imports: [TypeOrmModule.forFeature([Seat, Ticket, Match, SeasonPass]), AuthModule],
  controllers: [SeatsController, MatchSeatsController],
  providers: [SeatsService],
  exports: [SeatsService],
})
export class SeatsModule {}
