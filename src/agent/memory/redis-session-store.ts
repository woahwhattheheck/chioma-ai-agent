import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { SessionStore } from './session-store.interface';
import { LlmMessage } from '../llm/llm.types';
import { AppConfig } from '../../config/env.validation';

@Injectable()
export class RedisSessionStore implements SessionStore, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(config: AppConfig) {
    this.redis = new Redis(config.redisUrl);
    this.ttlSeconds = config.sessionTtlSeconds;
  }

  async getHistory(sessionId: string): Promise<LlmMessage[]> {
    const raw = await this.redis.get(this.key(sessionId));
    return raw ? (JSON.parse(raw) as LlmMessage[]) : [];
  }

  async appendMessages(sessionId: string, messages: LlmMessage[]): Promise<void> {
    const history = await this.getHistory(sessionId);
    history.push(...messages);
    await this.redis.set(this.key(sessionId), JSON.stringify(history), 'EX', this.ttlSeconds);
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'end') return;

    // Allow pending commands to drain and Redis to acknowledge QUIT.
    // On an unavailable Redis server, bound shutdown and close the socket.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.redis.quit(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Redis shutdown deadline exceeded')),
            1500,
          );
        }),
      ]);
    } catch {
      this.redis.disconnect();
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private key(sessionId: string): string {
    return 'chioma-agent:session:' + sessionId;
  }
}
