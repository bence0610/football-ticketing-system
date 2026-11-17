import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Ticket } from '../../database/entities';
import { MatchFinishJob } from './jobs/match-finish.job';
import { MatchesController } from './matches.controller';
import { MatchesService } from './matches.service';

@Module({
  imports: [TypeOrmModule.forFeature([Match, Ticket])],
  controllers: [MatchesController],
  providers: [MatchesService, MatchFinishJob],
  exports: [MatchesService],
})
export class MatchesModule {}
