import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RequestCorrelationInterceptor } from './request-correlation.interceptor';

function httpRequest() {
  const request: { method: string; correlationId?: string } = { method: 'POST' };
  const response = { setHeader: jest.fn<void, [string, string]>() };
  const context = {
    getType: () => 'http',
    getClass: () => class ChatController {},
    getHandler: () => function sendMessage() {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { request, response, context };
}

describe('RequestCorrelationInterceptor', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the same unique server-generated ID in response and lifecycle logs', async () => {
    const logger = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const clock = jest.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(112);
    const interceptor = new RequestCorrelationInterceptor();
    const { request, response, context } = httpRequest();
    const next = { handle: () => of('done') } as CallHandler;

    await expect(lastValueFrom(interceptor.intercept(context, next))).resolves.toBe('done');
    expect(request.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', request.correlationId);
    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[0][0]).toContain(`request_started id=${request.correlationId}`);
    expect(logger.mock.calls[1][0]).toContain(`request_finished id=${request.correlationId}`);
    expect(logger.mock.calls[1][0]).toContain('duration_ms=12');
    clock.mockRestore();
  });

  it('generates a distinct ID for each HTTP request', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new RequestCorrelationInterceptor();
    const a = httpRequest();
    const b = httpRequest();
    const next = { handle: () => of('ok') } as CallHandler;
    await lastValueFrom(interceptor.intercept(a.context, next));
    await lastValueFrom(interceptor.intercept(b.context, next));
    expect(a.request.correlationId).not.toBe(b.request.correlationId);
  });

  it('logs an end event on failed HTTP work while preserving the error', async () => {
    const logger = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const interceptor = new RequestCorrelationInterceptor();
    const { context, request } = httpRequest();
    const next = { handle: () => throwError(() => new Error('provider unavailable')) } as CallHandler;
    await expect(lastValueFrom(interceptor.intercept(context, next))).rejects.toThrow('provider unavailable');
    expect(logger.mock.calls[1][0]).toContain(`request_finished id=${request.correlationId}`);
  });
});
