import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status(code: number): { json(payload: unknown): void };
    }>();
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Keep internal details on the server, never in HTTP 5xx responses.
      const fullError = exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception);
      this.logger.error('Unhandled HTTP exception', fullError);
      response.status(status).json({
        statusCode: status,
        message: 'Internal server error',
      });
      return;
    }

    // Preserve intentional 4xx validation/auth response contracts.
    const body = exception instanceof HttpException ? exception.getResponse() : '';
    response.status(status).json(
      typeof body === 'string' ? { statusCode: status, message: body } : body,
    );
  }
}
