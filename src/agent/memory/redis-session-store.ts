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

  async checkReady(): Promise<void> {
    if (this.redis.status !== 'ready') {
      throw new Error('Redis session backend disconnected');
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Redis PING timed out')),
            1500,
          );
        }),
      ]);
      if (response !== 'PONG') {
        throw new Error('Redis PING not acknowledged');
      }
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
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

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private key(sessionId: string): string {
    return 'chioma-agent:session:' + sessionId;
  }
}
