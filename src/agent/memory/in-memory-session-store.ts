import { Injectable } from '@nestjs/common';
import { SessionStore } from './session-store.interface';
import { LlmMessage } from '../llm/llm.types';

@Injectable()
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, LlmMessage[]>();

  checkReady(): Promise<void> {
    return Promise.resolve();
  }

  getHistory(sessionId: string): Promise<LlmMessage[]> {
    return Promise.resolve(this.sessions.get(sessionId) ?? []);
  }

  appendMessages(sessionId: string, messages: LlmMessage[]): Promise<void> {
    const history = this.sessions.get(sessionId) ?? [];
    history.push(...messages);
    this.sessions.set(sessionId, history);
    return Promise.resolve();
  }

  clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    return Promise.resolve();
  }
}
