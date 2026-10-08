import Redis from 'ioredis';
import { AppConfig } from '../../config/env.validation';
import { RedisSessionStore } from './redis-session-store';

jest.mock('ioredis');

const MockRedis = Redis as jest.MockedClass<typeof Redis>;
const config = {
  redisUrl: 'redis://localhost:6379',
  sessionTtlSeconds: 3600,
} as AppConfig;

describe('RedisSessionStore graceful shutdown', () => {
  beforeEach(() => {
    MockRedis.mockReset();
  });

  function makeStore(
    status: string,
    quit: jest.Mock = jest.fn().mockResolvedValue('OK'),
  ) {
    const client = { status, quit, disconnect: jest.fn() };
    MockRedis.mockImplementation(() => client as unknown as Redis);
    return { store: new RedisSessionStore(config), client };
  }

  it('sends QUIT and waits for acknowledgement during shutdown', async () => {
    const { store, client } = makeStore('ready');
    await expect(store.onModuleDestroy()).resolves.toBeUndefined();
    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects if graceful QUIT fails', async () => {
    const { store, client } = makeStore(
      'ready',
      jest.fn().mockRejectedValue(new Error('socket lost')),
    );
    await expect(store.onModuleDestroy()).resolves.toBeUndefined();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
  });

  it('bounds shutdown when the QUIT reply never arrives', async () => {
    jest.useFakeTimers();
    try {
      const { store, client } = makeStore(
        'ready',
        jest.fn(() => new Promise<string>(() => {})),
      );
      const pending = store.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toBeUndefined();
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not reopen or close an already-ended connection', async () => {
    const { store, client } = makeStore('end');
    await store.onModuleDestroy();
    expect(client.quit).not.toHaveBeenCalled();
    expect(client.disconnect).not.toHaveBeenCalled();
  });
});
