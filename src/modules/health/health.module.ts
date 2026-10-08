import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MemoryModule } from '../../agent/memory/memory.module';

@Module({
  imports: [MemoryModule],
  controllers: [HealthController],
})
export class HealthModule {}
