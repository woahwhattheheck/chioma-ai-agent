import {
  CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { StructuredLogger } from './structured-logger';

@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  readonly logger = new StructuredLogger();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<{ method?: string }>();
    const res = http.getResponse<{ statusCode?: number }>();
    const started = Date.now();
    const route = context.getClass().name + '.' + context.getHandler().name;
    const method = req.method ?? 'UNKNOWN';

    return next.handle().pipe(
      tap(() => this.logger.record('info', 'http.request', {
        method, route, status: res.statusCode ?? 200,
        duration_ms: Date.now() - started, outcome: 'ok',
      })),
      catchError((error: unknown) => {
        this.logger.record('error', 'http.request', {
          method, route,
          status: error instanceof HttpException ? error.getStatus() : 500,
          duration_ms: Date.now() - started,
          outcome: 'error',
          error_type: error instanceof Error ? error.name : 'UnknownError',
        });
        return throwError(() => error);
      }),
    );
  }
}
