import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESSION_STORE } from './session-store.interface';
import { InMemorySessionStore } from './in-memory-session-store';
import { RedisSessionStore } from './redis-session-store';
import { RootConfig } from '../../config/env.validation';

@Module({
  providers: [
    {
      provide: SESSION_STORE,
      useFactory: (configService: ConfigService<RootConfig, true>) => {
        const config = configService.get('app', { infer: true });
        return config.sessionStore === 'redis'
          ? new RedisSessionStore(config)
          : new InMemorySessionStore(config.sessionTtlSeconds);
      },
      inject: [ConfigService],
    },
  ],
  exports: [SESSION_STORE],
})
export class MemoryModule {}
