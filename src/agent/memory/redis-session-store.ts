import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { SessionStore } from './session-store.interface';
import { LlmMessage } from '../llm/llm.types';
import { AppConfig } from '../../config/env.validation';

// Redis runs each Lua script atomically. Keep the existing JSON-array storage format
// so histories written before this change remain readable without a migration.
const ATOMIC_APPEND_SCRIPT = [
  "local stored = redis.call('GET', KEYS[1])",
  "local history = stored and cjson.decode(stored) or {}",
  "local incoming = cjson.decode(ARGV[1])",
  "for i = 1, #incoming do",
  "  history[#history + 1] = incoming[i]",
  "end",
  "local encoded = #history > 0 and cjson.encode(history) or '[]'",
  "redis.call('SET', KEYS[1], encoded, 'EX', tonumber(ARGV[2]))",
  "return #history",
].join('\n');


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
    // A GET then SET would lose one turn if two callers read the same history.
    // EVAL does the read, append and TTL refresh as one Redis operation.
    await this.redis.eval(
      ATOMIC_APPEND_SCRIPT,
      1,
      this.key(sessionId),
      JSON.stringify(messages),
      String(this.ttlSeconds),
    );
  }

  async clear(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private key(sessionId: string): string {
    return `chioma-agent:session:${sessionId}`;
  }
}
