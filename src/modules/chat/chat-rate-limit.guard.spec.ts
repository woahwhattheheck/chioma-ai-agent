import { ExecutionContext, HttpException } from '@nestjs/common';
import { ChatRateLimitGuard } from './chat-rate-limit.guard';

function httpContext(ip: string) {
  const response = { setHeader: jest.fn<void, [string, string]>() };
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: { remoteAddress: ip } }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, response };
}

describe('ChatRateLimitGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows 30 requests per minute and rejects the 31st with 429 and Retry-After', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const guard = new ChatRateLimitGuard();
    const { context, response } = httpContext('192.0.2.10');

    for (let n = 0; n < 30; n++) {
      expect(guard.canActivate(context)).toBe(true);
    }
    try {
      guard.canActivate(context);
      throw new Error('expected rate-limit rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(429);
    }
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('isolates independent IPs, even when the same session ID is supplied', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const guard = new ChatRateLimitGuard();
    const first = httpContext('192.0.2.10').context;
    const second = httpContext('192.0.2.11').context;
    for (let n = 0; n < 30; n++) guard.canActivate(first);
    expect(guard.canActivate(second)).toBe(true);
    expect(() => guard.canActivate(first)).toThrow(HttpException);
  });

  it('resets the fixed window after 60 seconds', () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1000);
    const guard = new ChatRateLimitGuard();
    const { context } = httpContext('192.0.2.12');
    for (let n = 0; n < 30; n++) guard.canActivate(context);
    clock.mockReturnValue(61_000);
    expect(guard.canActivate(context)).toBe(true);
  });
});
