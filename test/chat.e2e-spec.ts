// Boot the module with inert credentials and a memory store. No real LLM
// or external Chioma calls are made in these HTTP route tests.
process.env.CHIOMA_API_URL ??= 'http://localhost:3000';
process.env.LLM_PROVIDER ??= 'anthropic';
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.SESSION_STORE ??= 'memory';

import { createHash } from 'crypto';
import { Server } from 'http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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

const fakeLlmProvider: LlmProvider = {
  complete: () =>
    Promise.resolve({
      stopReason: 'stop',
      message: { role: 'assistant', content: 'Stubbed assistant reply.' },
    }),
};

describe('POST and DELETE /chat (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let sessionStore: SessionStore;
  const authHeader = 'Bearer test-token';

  function storedSessionId(header: string, publicSessionId: string): string {
    const token = header.slice('Bearer '.length);
    const namespace = createHash('sha256').update(token).digest('hex').slice(0, 16);
    return `${namespace}:${publicSessionId}`;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(LLM_PROVIDER)
      .useValue(fakeLlmProvider)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
    sessionStore = app.get<SessionStore>(SESSION_STORE);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /chat returns a real session ID and the mocked assistant reply', async () => {
    const response = await request(httpServer)
      .post('/chat')
      .set('Authorization', authHeader)
      .send({ message: 'Hello there' })
      .expect(201);

    const { sessionId, reply } = response.body as ChatResponse;
    expect(sessionId).toEqual(expect.any(String));
    expect(reply).toBe('Stubbed assistant reply.');
    const history = await sessionStore.getHistory(storedSessionId(authHeader, sessionId));
    expect(history.some((message) => message.content === 'Hello there')).toBe(true);
    expect(history.some((message) => message.content === reply)).toBe(true);
  });

  it('POST /chat returns 401 for missing and malformed credentials', async () => {
    await request(httpServer).post('/chat').send({ message: 'Hello' }).expect(401);
    await request(httpServer)
      .post('/chat')
      .set('Authorization', 'Token malformed')
      .send({ message: 'Hello' })
      .expect(401);
  });

  it('DELETE /chat/:sessionId clears only the authenticated caller session', async () => {
    const created = await request(httpServer)
      .post('/chat')
      .set('Authorization', authHeader)
      .send({ message: 'Start conversation' })
      .expect(201);
    const { sessionId } = created.body as ChatResponse;

    await request(httpServer)
      .post('/chat')
      .set('Authorization', authHeader)
      .send({ message: 'Follow up', sessionId })
      .expect(201);

    const ownKey = storedSessionId(authHeader, sessionId);
    expect((await sessionStore.getHistory(ownKey)).length).toBeGreaterThan(0);

    const otherHeader = 'Bearer another-caller';
    await request(httpServer)
      .post('/chat')
      .set('Authorization', otherHeader)
      .send({ message: 'Another caller history', sessionId })
      .expect(201);
    const otherKey = storedSessionId(otherHeader, sessionId);
    expect((await sessionStore.getHistory(otherKey)).length).toBeGreaterThan(0);

    await request(httpServer)
      .delete(`/chat/${sessionId}`)
      .set('Authorization', authHeader)
      .expect(204);

    expect(await sessionStore.getHistory(ownKey)).toEqual([]);
    expect((await sessionStore.getHistory(otherKey)).length).toBeGreaterThan(0);
  });

  it('DELETE /chat/:sessionId returns 401 without a valid Bearer header', async () => {
    await request(httpServer).delete('/chat/some-session-id').expect(401);
    await request(httpServer)
      .delete('/chat/some-session-id')
      .set('Authorization', 'Token invalid')
      .expect(401);
  });
});
