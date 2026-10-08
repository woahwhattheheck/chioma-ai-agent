import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { SessionStore } from './session-store.interface';
import type { LlmMessage } from '../llm/llm.types';

interface MemorySession {
  history: LlmMessage[];
  expiresAt: number;
}

@Injectable()
export class InMemorySessionStore implements SessionStore, OnModuleDestroy {
  private readonly sessions = new Map<string, MemorySession>();
  private readonly ttlMs: number;
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(ttlSeconds = 3600) {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 31_536_000) {
      throw new Error('SESSION_TTL_SECONDS must be between 1 and 31536000');
    }
    this.ttlMs = ttlSeconds * 1000;
    // Sweep even when no requests arrive: access-only pruning would leak idle sessions.
    this.sweepTimer = setInterval(() => this.evictExpired(Date.now()), Math.min(this.ttlMs, 60_000));
    this.sweepTimer.unref();
  }

  getHistory(sessionId: string): Promise<LlmMessage[]> {
    return Promise.resolve(this.touchActive(sessionId, Date.now())?.history ?? []);
  }

  appendMessages(sessionId: string, messages: LlmMessage[]): Promise<void> {
    const now = Date.now();
    const session = this.touchActive(sessionId, now) ?? {
      history: [], expiresAt: now + this.ttlMs,
    };
    session.history.push(...messages);
    this.sessions.set(sessionId, session);
    return Promise.resolve();
  }

  clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    return Promise.resolve();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
    this.sessions.clear();
  }

  private touchActive(sessionId: string, now: number): MemorySession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.expiresAt <= now) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    session.expiresAt = now + this.ttlMs;
    return session;
  }

  private evictExpired(now: number): void {
    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(sessionId);
    }
  }
}
