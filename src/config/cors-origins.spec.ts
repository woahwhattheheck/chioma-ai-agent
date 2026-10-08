import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { parseAllowedOrigins, validateEnvironment } from './env.validation';

describe('CORS origin allow-list (issue #3)', () => {
  it('parses unique canonical http(s) origins', () => {
    expect(parseAllowedOrigins('https://app.example.test, http://localhost:3000,https://app.example.test'))
      .toEqual(['https://app.example.test', 'http://localhost:3000']);
  });

  it.each(['*', '', 'https://example.test/path', 'javascript://host', 'http://user:pass@example.test'])(
    'rejects an unsafe origin configuration: %s',
    (value) => {
      expect(() => parseAllowedOrigins(value)).toThrow('ALLOWED_ORIGINS');
    },
  );

  it('fails startup validation without explicit production origins', () => {
    const base = {
      NODE_ENV: 'production',
      ANTHROPIC_API_KEY: 'placeholder',
      CHIOMA_API_URL: 'http://localhost:3000',
    };
    expect(() => validateEnvironment(base)).toThrow('ALLOWED_ORIGINS');
    expect(() => validateEnvironment({ ...base, ALLOWED_ORIGINS: 'https://app.example.test' }))
      .not.toThrow();
  });

  describe('browser-facing preflight policy', () => {
    let app: INestApplication;

    beforeAll(async () => {
      const mod = await Test.createTestingModule({}).compile();
      app = mod.createNestApplication();
      app.enableCors({
        origin: parseAllowedOrigins('https://app.example.test,http://localhost:3000'),
      });
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('retains Access-Control-Allow-Origin for an allowed origin', async () => {
      const response = await request(app.getHttpServer())
        .options('/cors-probe')
        .set('Origin', 'https://app.example.test')
        .set('Access-Control-Request-Method', 'GET');
      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin'])
        .toBe('https://app.example.test');
    });

    it('withholds CORS authorization from an unlisted origin', async () => {
      const response = await request(app.getHttpServer())
        .options('/cors-probe')
        .set('Origin', 'https://evil.example.test')
        .set('Access-Control-Request-Method', 'GET');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
