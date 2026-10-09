import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import {
  CHAT_RATE_LIMIT,
  CHAT_RATE_WINDOW_MS,
  ChatRateLimitGuard,
} from './chat-rate-limit.guard';

function httpContext(ip?: string, authorization = 'Bearer testing'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe('ChatRateLimitGuard (POST /chat)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts requests up to the per-IP ceiling, then returns HTTP 429', () => {
    const guard = new ChatRateLimitGuard();
    const caller = httpContext('192.0.2.10');

    for (let i = 0; i < CHAT_RATE_LIMIT; i += 1) {
      expect(guard.canActivate(caller)).toBe(true);
    }

    try {
      guard.canActivate(caller);
      throw new Error('Expected an HTTP 429 for the excess chat request');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const failure = error as HttpException;
      expect(failure.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(failure.getResponse()).toEqual(
        expect.objectContaining({ retryAfterSeconds: 60 }),
      );
    }
  });

  it('separates callers by IP and resets the window without process restart', () => {
    const guard = new ChatRateLimitGuard();
    const caller = httpContext('192.0.2.11');
    for (let i = 0; i < CHAT_RATE_LIMIT; i += 1) {
      guard.canActivate(caller);
    }

    // Rotating an untrusted bearer token does not reset the IP budget.
    expect(() =>
      guard.canActivate(httpContext('192.0.2.11', 'Bearer rotated')),
    ).toThrow(HttpException);
    expect(guard.canActivate(httpContext('192.0.2.12'))).toBe(true);

    jest.advanceTimersByTime(CHAT_RATE_WINDOW_MS);
    expect(guard.canActivate(caller)).toBe(true);
  });

  it('uses a bounded opaque bearer-key fallback when the HTTP IP is absent', () => {
    const guard = new ChatRateLimitGuard();
    const anonymousAdapter = httpContext(undefined, 'Bearer local-adapter');
    for (let i = 0; i < CHAT_RATE_LIMIT; i += 1) {
      guard.canActivate(anonymousAdapter);
    }
    expect(() => guard.canActivate(anonymousAdapter)).toThrow(HttpException);
  });
});
