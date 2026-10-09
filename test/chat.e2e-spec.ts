// Dummy config so ConfigModule's validateEnvironment() passes at boot without
// requiring real secrets. Set before AppModule (and its ConfigModule) loads.
process.env.CHIOMA_API_URL ??= 'http://localhost:3000';
process.env.LLM_PROVIDER ??= 'anthropic';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.SESSION_STORE ??= 'memory';

import { createHash } from 'crypto';
import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { WsAdapter } from '@nestjs/platform-ws';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  LLM_PROVIDER,
  LlmProvider,
} from '../src/agent/llm/llm-provider.interface';
import {
  SESSION_STORE,
  SessionStore,
} from '../src/agent/memory/session-store.interface';

interface ChatResponse {
  sessionId: string;
  reply: string;
}

// Canned, non-tool-call response so ConversationService finishes a turn without
// any real OpenAI/Anthropic network call.
const fakeLlmProvider: LlmProvider = {
  complete: () =>
    Promise.resolve({
      stopReason: 'stop',
      message: { role: 'assistant', content: 'Stubbed assistant reply.' },
    }),
};

describe('DELETE /chat/:sessionId (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let sessionStore: SessionStore;

  const ownerBearer = 'Bearer test-token';
  const otherBearer = 'Bearer another-user-token';

  // The controller deliberately keeps raw client session IDs opaque to the
  // store, namespacing them under a fingerprint of the authenticated bearer.
  function scopedId(authorization: string, sessionId: string): string {
    const accessToken = authorization.slice('Bearer '.length);
    const prefix = createHash('sha256').update(accessToken).digest('hex').slice(0, 16);
    return `${prefix}:${sessionId}`;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlmProvider)
      .compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new WsAdapter(app));
    await app.init();

    httpServer = app.getHttpServer() as Server;
    sessionStore = app.get<SessionStore>(SESSION_STORE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('clears only the authenticated owner-scoped session', async () => {
    const created = await request(httpServer)
      .post('/chat')
      .set('Authorization', ownerBearer)
      .send({ message: 'Hello there' })
      .expect(201);
    const { sessionId } = created.body as ChatResponse;

    await request(httpServer)
      .post('/chat')
      .set('Authorization', ownerBearer)
      .send({ message: 'A follow-up question', sessionId })
      .expect(201);

    const key = scopedId(ownerBearer, sessionId);
    expect((await sessionStore.getHistory(key)).length).toBeGreaterThan(0);

    await request(httpServer)
      .delete(`/chat/${sessionId}`)
      .set('Authorization', ownerBearer)
      .expect(204);

    expect(await sessionStore.getHistory(key)).toEqual([]);
  });

  it('returns 401 for missing, empty, malformed or non-Bearer authorization', async () => {
    const created = await request(httpServer)
      .post('/chat')
      .set('Authorization', ownerBearer)
      .send({ message: 'Retain this history' })
      .expect(201);
    const { sessionId } = created.body as ChatResponse;
    const key = scopedId(ownerBearer, sessionId);
    const path = `/chat/${sessionId}`;

    await request(httpServer).delete(path).expect(401);
    for (const badHeader of [
      'Basic test-token',
      'Bearer',
      'Bearer ',
      'Bearer two words',
    ]) {
      await request(httpServer)
        .delete(path)
        .set('Authorization', badHeader)
        .expect(401);
    }

    expect((await sessionStore.getHistory(key)).length).toBeGreaterThan(0);
  });

  it('cannot delete a different token owner’s history even with the same sessionId', async () => {
    const created = await request(httpServer)
      .post('/chat')
      .set('Authorization', ownerBearer)
      .send({ message: 'Owner-only conversation' })
      .expect(201);
    const { sessionId } = created.body as ChatResponse;
    const ownerKey = scopedId(ownerBearer, sessionId);
    const otherKey = scopedId(otherBearer, sessionId);

    expect(ownerKey).not.toBe(otherKey);
    expect((await sessionStore.getHistory(ownerKey)).length).toBeGreaterThan(0);

    // A different valid bearer has a different storage namespace. A 204 does
    // not imply the caller was authorized to clear the owner's conversation.
    await request(httpServer)
      .delete(`/chat/${sessionId}`)
      .set('Authorization', otherBearer)
      .expect(204);

    expect((await sessionStore.getHistory(ownerKey)).length).toBeGreaterThan(0);
    expect(await sessionStore.getHistory(otherKey)).toEqual([]);

    await request(httpServer)
      .delete(`/chat/${sessionId}`)
      .set('Authorization', ownerBearer)
      .expect(204);
    expect(await sessionStore.getHistory(ownerKey)).toEqual([]);
  });
});
