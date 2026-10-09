import { Module } from '@nestjs/common';
import { NotificationPreferencesStore } from './notification-preferences.store';
import { ConfigService } from '@nestjs/config';
import { SESSION_STORE } from './session-store.interface';
import { InMemorySessionStore } from './in-memory-session-store';
import { RedisSessionStore } from './redis-session-store';
import { RootConfig } from '../../config/env.validation';

@Module({
  providers: [
    NotificationPreferencesStore,
    {
      provide: SESSION_STORE,
      useFactory: (configService: ConfigService<RootConfig, true>) => {
        const config = configService.get('app', { infer: true });
        return config.sessionStore === 'redis'
          ? new RedisSessionStore(config)
          : new InMemorySessionStore();
      },
      inject: [ConfigService],
    },
  ],
  exports: [SESSION_STORE, NotificationPreferencesStore],
})
export class MemoryModule {}
