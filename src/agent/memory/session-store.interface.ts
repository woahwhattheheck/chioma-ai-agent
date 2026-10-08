import { LlmMessage } from '../llm/llm.types';

export const SESSION_STORE = Symbol('SESSION_STORE');

export interface SessionStore {
  getHistory(sessionId: string): Promise<LlmMessage[]>;
  appendMessages(sessionId: string, messages: LlmMessage[]): Promise<void>;
  clear(sessionId: string): Promise<void>;
  checkReady(): Promise<void>;
}
