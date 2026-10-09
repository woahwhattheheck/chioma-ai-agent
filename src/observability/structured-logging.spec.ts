import { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { RequestLogInterceptor } from './request-log.interceptor';
import { StructuredLogger } from './structured-logger';

describe('structured JSON logging (#17)', () => {
  it('emits parseable, credential-free event metadata', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('development', (line) => lines.push(line));
    logger.record('info', 'tool.execution', {
      tool: 'get_match_score', outcome: 'ok', duration_ms: 12,
    });
    expect(JSON.parse(lines[0])).toEqual(expect.objectContaining({
      level: 'info', event: 'tool.execution',
      tool: 'get_match_score', outcome: 'ok', duration_ms: 12,
    }));
    expect(lines[0]).not.toMatch(/authorization|Bearer|secret|accessToken/);
  });

  it('uses NODE_ENV to suppress low-severity test noise', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('test', (line) => lines.push(line));
    logger.record('info', 'http.request', { status: 200 });
    logger.record('error', 'http.request', { status: 500 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).status).toBe(500);
  });

  it('logs request outcome without logging chat body', async () => {
    const interceptor = new RequestLogInterceptor();
    const record = jest.spyOn(interceptor.logger, 'record').mockImplementation();
    const context = {
      getType: () => 'http',
      getClass: () => ({ name: 'ChatController' }),
      getHandler: () => ({ name: 'sendMessage' }),
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', body: { message: 'sensitive payload' } }),
        getResponse: () => ({ statusCode: 201 }),
      }),
    } as unknown as ExecutionContext;
    await lastValueFrom(interceptor.intercept(context, { handle: () => of('ok') }));
    expect(record).toHaveBeenCalledWith('info', 'http.request', expect.objectContaining({
      method: 'POST', route: 'ChatController.sendMessage',
      status: 201, outcome: 'ok',
    }));
    expect(JSON.stringify(record.mock.calls)).not.toContain('sensitive payload');
  });
});
