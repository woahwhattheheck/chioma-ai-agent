import Redis from 'ioredis';
import { AppConfig } from '../../config/env.validation';
import { RedisSessionStore } from './redis-session-store';

jest.mock('ioredis');

describe('RedisSessionStore (offline Redis client)', () => {
  const redis = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    disconnect: jest.fn(),
  };
  let store: RedisSessionStore;

  beforeEach(() => {
    jest.clearAllMocks();
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    store = new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      sessionTtlSeconds: 45,
    } as AppConfig);
  });

  afterEach(() => {
    store.onModuleDestroy();
  });

  it('returns [] for an unknown session without connecting to Redis', async () => {
    redis.get.mockResolvedValue(null);
    await expect(store.getHistory('missing')).resolves.toEqual([]);
    expect(redis.get).toHaveBeenCalledWith('chioma-agent:session:missing');
  });

  it('deserializes the stored conversation history', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    redis.get.mockResolvedValue(JSON.stringify(messages));
    await expect(store.getHistory('one')).resolves.toEqual(messages);
  });

  it('appends to existing history and refreshes the configured expiration', async () => {
    redis.get.mockResolvedValue(JSON.stringify([{ role: 'user', content: 'hi' }]));
    redis.set.mockResolvedValue('OK');

    await store.appendMessages('one', [{ role: 'assistant', content: 'hello' }]);

    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'chioma-agent:session:one',
      JSON.stringify([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ]),
      'EX',
      45,
    );
  });

  it('creates a new history with a TTL when no prior messages exist', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');

    await store.appendMessages('fresh', [{ role: 'user', content: 'start' }]);

    expect(redis.set).toHaveBeenCalledWith(
      'chioma-agent:session:fresh',
      JSON.stringify([{ role: 'user', content: 'start' }]),
      'EX',
      45,
    );
  });

  it('clears only the namespaced requested session key', async () => {
    redis.del.mockResolvedValue(1);
    await store.clear('one');
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith('chioma-agent:session:one');
  });
});
