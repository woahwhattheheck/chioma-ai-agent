import { Module } from '@nestjs/common';
import { AgentModule } from '../../agent/agent.module';
import { ChiomaApiModule } from '../../integrations/chioma-api/chioma-api.module';
import { MemoryModule } from '../../agent/memory/memory.module';
import { ProactiveNudgesService } from './proactive-nudges.service';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [AgentModule, ChiomaApiModule, MemoryModule],
  controllers: [ChatController],
  providers: [ChatGateway, ProactiveNudgesService],
})
export class ChatModule {}
