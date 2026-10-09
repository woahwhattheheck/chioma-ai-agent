import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConversationService } from './agent/conversation/conversation.service';
import { ChatController } from './modules/chat/chat.controller';
import { configureOpenApi } from './openapi';

describe('OpenAPI chat contract', () => {
  let app: INestApplication;
  const mockConversation = {
    handleTurn: jest.fn().mockResolvedValue('Hello from Chioma'),
    resetSession: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ConversationService, useValue: mockConversation }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors();
    configureOpenApi(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Swagger UI and accurate authenticated chat schemas without changing POST or CORS', async () => {
    const server = app.getHttpServer();
    const ui = await request(server).get('/api').redirects(1).expect(200);
    expect(ui.text).toContain('Swagger UI');

    const { body: doc } = await request(server).get('/api-json').expect(200);
    expect(doc.paths['/chat'].post.requestBody.content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/ChatMessageDto' });
    expect(doc.paths['/chat'].post.responses['201'].content['application/json'].schema)
      .toEqual({ $ref: '#/components/schemas/ChatReplyDto' });
    expect(doc.paths['/chat'].post.security)
      .toEqual([{ 'chioma-access-token': [] }]);
    expect(doc.paths['/chat/{sessionId}'].delete.responses['204']).toBeDefined();
    expect(doc.components.schemas.ChatMessageDto.properties).toHaveProperty('message');
    expect(doc.components.schemas.ChatMessageDto.properties).toHaveProperty('sessionId');

    const post = await request(server)
      .post('/chat')
      .set('Authorization', 'Bearer demo-token')
      .send({ message: 'Hello' })
      .expect(201);
    expect(post.body).toEqual({
      sessionId: expect.any(String),
      reply: 'Hello from Chioma',
    });

    const preflight = await request(server)
      .options('/chat')
      .set('Origin', 'https://example.test')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
  });
});
