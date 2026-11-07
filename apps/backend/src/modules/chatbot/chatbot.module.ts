import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Match, Ticket } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { SeatsModule } from '../seats/seats.module';
import { ChatbotContextService } from './chatbot-context.service';
import { ChatbotController } from './chatbot.controller';
import { ChatbotHistoryService } from './chatbot-history.service';
import { ChatbotRateLimitGuard } from './chatbot-rate-limit.guard';
import { ChatbotService } from './chatbot.service';

@Module({
  imports: [TypeOrmModule.forFeature([Match, Ticket]), AuthModule, SeatsModule],
  controllers: [ChatbotController],
  providers: [ChatbotService, ChatbotContextService, ChatbotHistoryService, ChatbotRateLimitGuard],
  exports: [ChatbotService],
})
export class ChatbotModule {}
