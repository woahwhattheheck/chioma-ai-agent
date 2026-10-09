import { Module } from '@nestjs/common';
import { AgentModule } from '../../agent/agent.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatRateLimitGuard } from './chat-rate-limit.guard';

@Module({
  imports: [AgentModule],
  controllers: [ChatController],
  providers: [ChatGateway, ChatRateLimitGuard],
})
export class ChatModule {}
