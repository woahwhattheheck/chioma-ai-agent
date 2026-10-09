import {
  BackendCircuitOpenError,
  ChiomaApiCircuitBreaker,
} from './chioma-api-circuit-breaker';

describe('ChiomaApiCircuitBreaker (#26)', () => {
  const upstream503 = () =>
    Object.assign(new Error('upstream 503'), { response: { status: 503 } });

  it('opens after repeated backend failures, fails fast, and recovers after cooldown', async () => {
    let now = 1_000;
    const breaker = new ChiomaApiCircuitBreaker(2, 10_000, () => now);
    const backend = jest.fn(async () => { throw upstream503(); });

    await expect(breaker.execute(backend)).rejects.toThrow('upstream 503');
    await expect(breaker.execute(backend)).rejects.toThrow('upstream 503');
    await expect(breaker.execute(backend)).rejects.toThrow(BackendCircuitOpenError);
    expect(backend).toHaveBeenCalledTimes(2);

    now += 10_000;
    await expect(breaker.execute(async () => 'recovered')).resolves.toBe('recovered');
    await expect(breaker.execute(async () => 'healthy')).resolves.toBe('healthy');
  });

  it('does not trip on authorization and other non-backend errors', async () => {
    const breaker = new ChiomaApiCircuitBreaker(2);
    const unauthorised = Object.assign(new Error('401'), { response: { status: 401 } });
    const request = jest.fn(async () => { throw unauthorised; });

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(request)).rejects.toBe(unauthorised);
    }
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('admits exactly one recovery probe while the backend remains down', async () => {
    let now = 10;
    const breaker = new ChiomaApiCircuitBreaker(1, 100, () => now);
    await expect(breaker.execute(async () => { throw upstream503(); })).rejects.toThrow();
    now += 100;

    let finish!: (value: string) => void;
    const probe = breaker.execute(() => new Promise<string>((resolve) => {
      finish = resolve;
    }));
    const secondCall = jest.fn(async () => 'should not run');
    await expect(breaker.execute(secondCall)).rejects.toThrow(BackendCircuitOpenError);
    expect(secondCall).not.toHaveBeenCalled();

    finish('restored');
    await expect(probe).resolves.toBe('restored');
  });
});
