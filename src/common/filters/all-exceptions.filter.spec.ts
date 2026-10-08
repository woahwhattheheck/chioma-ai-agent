import { ArgumentsHost, BadRequestException, HttpException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter (issue #6)', () => {
  afterEach(() => jest.restoreAllMocks());

  function harness() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  }

  it('logs the original stack but sanitizes unexpected error details', () => {
    const { host, status, json } = harness();
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const error = new Error('internal access token: do-not-expose');
    new AllExceptionsFilter().catch(error, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500, message: 'Internal server error',
    });
    expect(JSON.stringify(json.mock.calls)).not.toContain('do-not-expose');
    expect(logger).toHaveBeenCalledWith('Unhandled HTTP exception', expect.stringContaining('do-not-expose'));
  });

  it('sanitizes HTTP 500 exceptions but preserves the full server log', () => {
    const { host, status, json } = harness();
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    new AllExceptionsFilter().catch(
      new HttpException('private database detail', 500), host,
    );
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
    expect(logger).toHaveBeenCalledWith(
      'Unhandled HTTP exception', expect.stringContaining('private database detail'),
    );
  });

  it('preserves deliberate 4xx validation responses and does not log them as server failures', () => {
    const { host, status, json } = harness();
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    new AllExceptionsFilter().catch(new BadRequestException('bad input'), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400, message: 'bad input',
    }));
    expect(logger).not.toHaveBeenCalled();
  });
});
