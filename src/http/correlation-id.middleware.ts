import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Logger } from '@nestjs/common';

export type CorrelatedRequest = IncomingMessage & { correlationId?: string };
const logger = new Logger('RequestCorrelation');

export function correlationIdMiddleware(
  request: CorrelatedRequest,
  response: ServerResponse,
  next: () => void,
): void {
  const correlationId = randomUUID();
  const started = process.hrtime.bigint();
  const method = request.method || 'UNKNOWN';
  const path = (request.url || '/').split('?', 1)[0];
  request.correlationId = correlationId;
  response.setHeader('X-Request-ID', correlationId);
  logger.log(JSON.stringify({ event: 'request.start', correlationId, method, path }));
  response.once('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
    logger.log(JSON.stringify({
      event: 'request.finish', correlationId, method, path,
      statusCode: response.statusCode, durationMs: Math.round(durationMs),
    }));
  });
  next();
}
