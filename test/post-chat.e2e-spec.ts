import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ChatController } from '../src/modules/chat/chat.controller';
import { ConversationService } from '../src/agent/conversation/conversation.service';

/**
 * Bounty #13: actual Nest HTTP routing, a mocked ConversationService and
 * no provider/network secrets. Run only this file with:
 * pnpm exec jest --config ./test/jest-e2e.json --runInBand test/post-chat.e2e-spec.ts
 */
describe('POST /chat (e2e)', () => {
  let app: INestApplication;
  const handleTurn = jest.fn<Promise<string>, [string, string, object]>();

  beforeAll(async () => {
    handleTurn.mockResolvedValue('Mock provider response');
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{
        provide: ConversationService,
        useValue: { handleTurn, resetSession: jest.fn() },
      }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    handleTurn.mockClear();
  });

  it('accepts Bearer auth and preserves client session ID across the real HTTP boundary', async () => {
    const token = 'test-user-token';
    const sessionId = 'client-session-42';
    const res = await request(app.getHttpServer())
      .post('/chat')
      .set('Authorization', 'Bearer ' + token)
      .send({ message: 'Find my listing', sessionId })
      .expect(201);

    expect(res.body).toEqual({ sessionId, reply: 'Mock provider response' });
    const ownerKey = createHash('sha256').update(token).digest('hex').slice(0, 16);
    expect(handleTurn).toHaveBeenCalledTimes(1);
    expect(handleTurn).toHaveBeenCalledWith(
      ownerKey + ':' + sessionId,
      'Find my listing',
      expect.objectContaining({ accessToken: token }),
    );
  });

  it('returns 401 when Authorization is absent without invoking the conversation service', async () => {
    await request(app.getHttpServer())
      .post('/chat')
      .send({ message: 'Should be denied' })
      .expect(401);
    expect(handleTurn).not.toHaveBeenCalled();
  });

  it.each([
    ['Basic credentials', 'Basic wrong-credentials'],
    ['unprefixed token', 'test-user-token'],
    ['incorrect bearer casing', 'bearer test-user-token'],
  ])('returns 401 for %s', async (_description, authorization) => {
    await request(app.getHttpServer())
      .post('/chat')
      .set('Authorization', authorization)
      .send({ message: 'Should be denied' })
      .expect(401);
    expect(handleTurn).not.toHaveBeenCalled();
  });
});
