import { RedisSessionStore } from './redis-session-store';
import type { AppConfig } from '../../config/env.validation';

// Isolated ioredis stub: no server, containers, network, or extra dependencies.
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockDel = jest.fn();
const mockDisconnect = jest.fn();
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
    del: (...args: unknown[]) => mockDel(...args),
    disconnect: () => mockDisconnect(),
  })),
}));

describe('RedisSessionStore', () => {
  let now: number;
  let values: Map<string, { data: string; expiresAt: number }>;
  const key = (sessionId: string) => `chioma-agent:session:${sessionId}`;

  function makeStore(ttlSeconds = 30): RedisSessionStore {
    return new RedisSessionStore({
      redisUrl: 'redis://localhost:6379',
      sessionTtlSeconds: ttlSeconds,
    } as AppConfig);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    now = 0;
    values = new Map();
    mockGet.mockImplementation(async (id: string) => {
      const item = values.get(id);
      return item && item.expiresAt > now ? item.data : null;
    });
    mockSet.mockImplementation(async (id: string, data: string, mode: string, seconds: number) => {
      if (mode !== 'EX') throw new Error('TTL is required');
      values.set(id, { data, expiresAt: now + seconds * 1_000 });
      return 'OK';
    });
    mockDel.mockImplementation(async (id: string) => (values.delete(id) ? 1 : 0));
  });

  it('gets [] for a missing session and deserializes a saved history', async () => {
    const store = makeStore();
    expect(await store.getHistory('missing')).toEqual([]);
    values.set(key('existing'), {
      data: JSON.stringify([{ role: 'user', content: 'previous' }]),
      expiresAt: 30_000,
    });
    expect(await store.getHistory('existing')).toEqual([{ role: 'user', content: 'previous' }]);
    expect(mockGet).toHaveBeenCalledWith(key('existing'));
  });

  it('appends messages in order, persists a single history and resets configured TTL', async () => {
    const store = makeStore(45);
    await store.appendMessages('s1', [{ role: 'user', content: 'first' }]);
    now = 40_000;
    await store.appendMessages('s1', [{ role: 'assistant', content: 'reply' }]);
    expect(await store.getHistory('s1')).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(mockSet).toHaveBeenLastCalledWith(
      key('s1'),
      JSON.stringify([{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply' }]),
      'EX',
      45,
    );
    now = 85_000;
    expect(await store.getHistory('s1')).toEqual([]); // expired in fake Redis
  });

  it('clears one session without deleting another', async () => {
    const store = makeStore();
    await store.appendMessages('one', [{ role: 'user', content: 'a' }]);
    await store.appendMessages('two', [{ role: 'user', content: 'b' }]);
    await store.clear('one');
    expect(mockDel).toHaveBeenCalledWith(key('one'));
    expect(await store.getHistory('one')).toEqual([]);
    expect(await store.getHistory('two')).toEqual([{ role: 'user', content: 'b' }]);
  });

  it('disconnects its Redis client during module destruction', () => {
    const store = makeStore();
    store.onModuleDestroy();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
