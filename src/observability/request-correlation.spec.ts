import { EventEmitter } from 'node:events';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';
import {
  getRequestCorrelationId,
  requestCorrelationMiddleware,
} from './request-correlation';

describe('requestCorrelationMiddleware', () => {
  it('gives independent requests unique, lifecycle-consistent IDs without logging query data', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const invoke = (url: string) => {
        const headers = new Map<string, string>();
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          setHeader(name: string, value: string) {
            headers.set(name, value);
          },
        }) as unknown as ServerResponse;
        const request = { method: 'POST', url } as IncomingMessage;
        let contextId: string | undefined;
        requestCorrelationMiddleware(request, response, () => {
          contextId = getRequestCorrelationId();
        });
        response.emit('finish');
        return { id: headers.get('X-Request-ID'), contextId };
      };

      const first = invoke('/chat?token=must-not-appear');
      const second = invoke('/health');
      expect(first.id).toBeTruthy();
      expect(second.id).toBeTruthy();
      expect(first.id).not.toBe(second.id);
      expect(first.contextId).toBe(first.id);
      expect(second.contextId).toBe(second.id);
      expect(getRequestCorrelationId()).toBeUndefined();

      const entries = log.mock.calls.map(([value]) => JSON.parse(String(value)) as {
        event: string; requestId: string; path?: string;
        statusCode?: number; durationMs?: number;
      });
      expect(entries.map(({ event }) => event)).toEqual([
        'request_started', 'request_finished', 'request_started', 'request_finished',
      ]);
      expect(entries[0]).toMatchObject({ requestId: first.id, path: '/chat' });
      expect(entries[1]).toMatchObject({ requestId: first.id, statusCode: 200 });
      expect(entries[2]).toMatchObject({ requestId: second.id, path: '/health' });
      expect(entries[3]).toMatchObject({ requestId: second.id, statusCode: 200 });
      expect(entries[1].durationMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(entries)).not.toContain('must-not-appear');
    } finally {
      log.mockRestore();
    }
  });

  it('logs an aborted request once on close without claiming a finished response', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const request = { method: 'GET', url: '/chat' } as IncomingMessage;
      const response = Object.assign(new EventEmitter(), {
        statusCode: 200,
        setHeader: jest.fn(),
      }) as unknown as ServerResponse;
      requestCorrelationMiddleware(request, response, () => undefined);
      response.emit('close');
      response.emit('finish');

      const last = JSON.parse(String(log.mock.calls[log.mock.calls.length - 1]?.[0])) as {
        event: string; outcome: string;
      };
      expect(last).toMatchObject({ event: 'request_finished', outcome: 'aborted' });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});
