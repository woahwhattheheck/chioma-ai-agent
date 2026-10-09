import { randomUUID } from 'crypto';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize } from 'rxjs';

/**
 * Server-generated request identity is available to downstream HTTP handlers
 * as request.correlationId, returned to the caller, and logged at start/end.
 * We log only the controller action, not a path, query, token or request body.
 */
@Injectable()
export class RequestCorrelationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestCorrelationInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{ method?: string; correlationId?: string }>();
    const response = http.getResponse<{ setHeader(name: string, value: string): void }>();
    const id = randomUUID();
    const action = `${context.getClass().name}.${context.getHandler().name}`;
    const method = request.method || 'UNKNOWN';
    const startedAt = Date.now();

    // Always generate a new ID. Never treat a caller-controlled header as a
    // trusted log correlation identifier.
    request.correlationId = id;
    response.setHeader('X-Request-Id', id);
    this.logger.log(`request_started id=${id} method=${method} handler=${action}`);

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(
          `request_finished id=${id} method=${method} handler=${action} duration_ms=${Date.now() - startedAt}`,
        );
      }),
    );
  }
}
