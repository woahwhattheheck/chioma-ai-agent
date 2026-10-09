import Redis from 'ioredis';
import { RedisSessionStore } from './redis-session-store';
import { AppConfig } from '../../config/env.validation';
import { LlmMessage } from '../llm/llm.types';

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

describe('RedisSessionStore atomic append', () => {
  it('does not lose either concurrent append and preserves existing JSON history with TTL', async () => {
    const key = 'chioma-agent:session:same-session';
    const old: LlmMessage = { role: 'user', content: 'before' };
    const left: LlmMessage = { role: 'user', content: 'first concurrent turn' };
    const right: LlmMessage = { role: 'user', content: 'second concurrent turn' };
    const data = new Map<string, string>([[key, JSON.stringify([old])]]);

    // Redis executes the body of an EVAL without interleaving another command.
    // This fake implements that single-command boundary; an old GET/SET
    // implementation would instead race because both GET promises see "before".
    const redis = {
      get: jest.fn(async (k: string) => data.get(k) ?? null),
      set: jest.fn(async (k: string, value: string) => { data.set(k, value); }),
      eval: jest.fn(async (
        script: string,
        keys: number,
        k: string,
        payload: string,
        ttl: string,
      ) => {
        expect(keys).toBe(1);
        expect(k).toBe(key);
        expect(ttl).toBe('60');
        expect(script).toContain("redis.call('GET', KEYS[1])");
        expect(script).toContain("redis.call('SET', KEYS[1], encoded, 'EX'");
        const history = JSON.parse(data.get(k) ?? '[]') as LlmMessage[];
        history.push(...(JSON.parse(payload) as LlmMessage[]));
        data.set(k, JSON.stringify(history));
        return history.length;
      }),
      del: jest.fn(),
      disconnect: jest.fn(),
    };
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    const store = new RedisSessionStore({
      redisUrl: 'redis://not-connected',
      sessionTtlSeconds: 60,
    } as AppConfig);

    await Promise.all([
      store.appendMessages('same-session', [left]),
      store.appendMessages('same-session', [right]),
    ]);

    expect(await store.getHistory('same-session')).toEqual([old, left, right]);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(redis.set).not.toHaveBeenCalled();
    store.onModuleDestroy();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps empty histories as JSON arrays', async () => {
    const data = new Map<string, string>();
    const redis = {
      get: jest.fn(async (k: string) => data.get(k) ?? null),
      eval: jest.fn(async (_script: string, _keys: number, k: string) => {
        data.set(k, '[]');
        return 0;
      }),
      disconnect: jest.fn(),
    };
    (Redis as unknown as jest.Mock).mockImplementation(() => redis);
    const store = new RedisSessionStore({
      redisUrl: 'redis://not-connected',
      sessionTtlSeconds: 60,
    } as AppConfig);
    await store.appendMessages('empty', []);
    expect(await store.getHistory('empty')).toEqual([]);
    store.onModuleDestroy();
  });
});
