import { EventEmitter } from 'node:events';
import { ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import { correlationIdMiddleware, CorrelatedRequest } from './correlation-id.middleware';

function driveRequest(): { logs: string[]; requestId: string; finished: string } {
  const logs: string[] = [];
  const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation((message) => {
    logs.push(String(message));
  });
  try {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 201,
      headers: {} as Record<string, string>,
      setHeader(key: string, value: string) { this.headers[key] = value; },
    });
    const request = {
      method: 'POST',
      url: '/chat?authorization=do-not-log-this',
      headers: { 'x-request-id': 'spoofed-header' },
    } as unknown as CorrelatedRequest;
    let nextCalled = false;
    correlationIdMiddleware(request, response as unknown as ServerResponse, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    const requestId = request.correlationId as string;
    expect(response.headers['X-Request-ID']).toBe(requestId);
    response.emit('finish');
    return { logs, requestId, finished: logs[1] };
  } finally {
    spy.mockRestore();
  }
}

describe('request correlation (#18)', () => {
  it('logs one server-owned request ID through completion without query leakage', () => {
    const first = driveRequest();
    const second = driveRequest();
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.requestId).not.toBe('spoofed-header');
    expect(first.logs).toHaveLength(2);
    expect(first.logs[0]).toContain(first.requestId);
    expect(first.finished).toContain(first.requestId);
    expect(JSON.parse(first.finished)).toMatchObject({
      event: 'request.finish', path: '/chat', method: 'POST', statusCode: 201,
    });
    expect(first.logs.join('\n')).not.toContain('do-not-log-this');
  });
});
