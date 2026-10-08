import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class RequestCorrelationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestCorrelationMiddleware.name);

  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = randomUUID();
    res.setHeader('X-Correlation-ID', correlationId);
    this.logger.log(JSON.stringify({ event: 'request.start', correlationId, method: req.method, path: req.path }));
    res.on('finish', () => {
      this.logger.log(JSON.stringify({ event: 'request.finish', correlationId, statusCode: res.statusCode }));
    });
    next();
  }
}
