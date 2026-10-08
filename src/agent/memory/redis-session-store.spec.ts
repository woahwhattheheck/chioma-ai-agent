import Redis from 'ioredis';
import { AppConfig } from '../../config/env.validation';
import { RedisSessionStore } from './redis-session-store';

jest.mock('ioredis');

const MockRedis = Redis as jest.MockedClass<typeof Redis>;
const config = {
  redisUrl: 'redis://localhost:6379',
  sessionTtlSeconds: 3600,
} as AppConfig;

describe('RedisSessionStore readiness', () => {
  beforeEach(() => {
    MockRedis.mockReset();
  });

  function withConnection(status: string, response = 'PONG') {
    const client = {
      status,
      ping: jest.fn().mockResolvedValue(response),
      disconnect: jest.fn(),
    };
    MockRedis.mockImplementation(() => client as unknown as Redis);
    return { store: new RedisSessionStore(config), client };
  }

  it('requires a successful Redis PING', async () => {
    const { store, client } = withConnection('ready');
    await expect(store.checkReady()).resolves.toBeUndefined();
    expect(client.ping).toHaveBeenCalledTimes(1);
  });

  it('fails promptly while Redis is reconnecting', async () => {
    const { store, client } = withConnection('reconnecting');
    await expect(store.checkReady()).rejects.toThrow(/disconnected/);
    expect(client.ping).not.toHaveBeenCalled();
  });

  it('rejects unexpected PING responses', async () => {
    const { store } = withConnection('ready', 'NOT-PONG');
    await expect(store.checkReady()).rejects.toThrow(/not acknowledged/);
  });
});
