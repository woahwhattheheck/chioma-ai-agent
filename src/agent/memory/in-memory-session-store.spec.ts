import { InMemorySessionStore } from './in-memory-session-store';

describe('InMemorySessionStore', () => {
  it('returns an empty history for an unknown session', async () => {
    const store = new InMemorySessionStore();

    expect(await store.getHistory('unknown')).toEqual([]);
  });

  it('appends and accumulates messages per session', async () => {
    const store = new InMemorySessionStore();

    await store.appendMessages('s1', [{ role: 'user', content: 'hi' }]);
    await store.appendMessages('s1', [{ role: 'assistant', content: 'hello' }]);

    expect(await store.getHistory('s1')).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('keeps sessions isolated from each other', async () => {
    const store = new InMemorySessionStore();

    await store.appendMessages('s1', [{ role: 'user', content: 'a' }]);
    await store.appendMessages('s2', [{ role: 'user', content: 'b' }]);

    expect(await store.getHistory('s1')).toEqual([{ role: 'user', content: 'a' }]);
    expect(await store.getHistory('s2')).toEqual([{ role: 'user', content: 'b' }]);
  });

  it('clears a session history', async () => {
    const store = new InMemorySessionStore();
    await store.appendMessages('s1', [{ role: 'user', content: 'a' }]);

    await store.clear('s1');

    expect(await store.getHistory('s1')).toEqual([]);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('expires an idle session at the configured deadline and starts fresh', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    const store = new InMemorySessionStore(2);
    await store.appendMessages('idle', [{ role: 'user', content: 'old' }]);

    jest.advanceTimersByTime(2_000);
    expect(await store.getHistory('idle')).toEqual([]);
    await store.appendMessages('idle', [{ role: 'user', content: 'new' }]);
    expect(await store.getHistory('idle')).toEqual([
      { role: 'user', content: 'new' },
    ]);
    store.onModuleDestroy();
  });

  it('renews idle time on history reads and appends', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-08T00:00:00Z'));
    const store = new InMemorySessionStore(2);
    await store.appendMessages('active', [{ role: 'user', content: 'hi' }]);

    jest.advanceTimersByTime(1_500);
    expect(await store.getHistory('active')).toHaveLength(1);
    jest.advanceTimersByTime(1_500);
    await store.appendMessages('active', [{ role: 'assistant', content: 'hello' }]);
    expect(await store.getHistory('active')).toHaveLength(2);
    jest.advanceTimersByTime(2_000);
    expect(await store.getHistory('active')).toEqual([]);
    store.onModuleDestroy();
  });

  it('sweeps idle entries with no reads or writes', async () => {
    jest.useFakeTimers();
    const store = new InMemorySessionStore(1);
    await store.appendMessages('dormant', [{ role: 'user', content: 'old' }]);
    const entries = (store as unknown as { sessions: Map<string, unknown> }).sessions;
    expect(entries.size).toBe(1);

    jest.advanceTimersByTime(1_000);
    expect(entries.size).toBe(0);
    store.onModuleDestroy();
  });

  it('rejects invalid session TTLs', () => {
    expect(() => new InMemorySessionStore(0)).toThrow('SESSION_TTL_SECONDS');
    expect(() => new InMemorySessionStore(Number.NaN)).toThrow('SESSION_TTL_SECONDS');
  });

});
