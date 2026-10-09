import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';

interface RequestTrace {
  requestId: string;
}

const requestTrace = new AsyncLocalStorage<RequestTrace>();
const logger = new Logger('RequestCorrelation');

/** The request's opaque ID, shared across asynchronous continuations. */
export function getRequestCorrelationId(): string | undefined {
  return requestTrace.getStore()?.requestId;
}

/**
 * Correlate the response and lifecycle logs without storing authorization
 * headers, tokens, request bodies or URL query parameters.
 */
export function requestCorrelationMiddleware(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  const requestId = randomUUID();
  response.setHeader('X-Request-ID', requestId);

  requestTrace.run({ requestId }, () => {
    const startedAt = Date.now();
    const path = (request.url ?? '/').split(/[?#]/, 1)[0] || '/';
    logger.log(JSON.stringify({
      event: 'request_started',
      requestId,
      method: request.method ?? 'UNKNOWN',
      path,
    }));

    let settled = false;
    const complete = (outcome: 'finished' | 'aborted'): void => {
      if (settled) return;
      settled = true;
      logger.log(JSON.stringify({
        event: 'request_finished',
        requestId,
        outcome,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
      }));
    };

    response.once('finish', () => complete('finished'));
    response.once('close', () => complete('aborted'));
    next();
  });
}
