import { LoggerService } from '@nestjs/common';

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | undefined>;
const priority: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Log structured event metadata, never credentials, request payloads or tool arguments. */
export class StructuredLogger implements LoggerService {
  constructor(
    private readonly environment: string = process.env.NODE_ENV ?? 'development',
    private readonly sink: (line: string) => void = (line) => process.stdout.write(line + '\n'),
  ) {}

  record(level: Level, event: string, fields: Fields = {}): void {
    const min: Level =
      this.environment === 'test' ? 'warn' :
      this.environment === 'production' ? 'info' : 'debug';
    if (priority[level] < priority[min]) return;
    this.sink(JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      environment: this.environment,
      ...fields,
    }));
  }

  log(message: unknown, context?: string): void {
    this.record('info', 'nest.log', { context: context ?? 'nest', message: this.summary(message) });
  }
  error(message: unknown, _trace?: string, context?: string): void {
    this.record('error', 'nest.error', { context: context ?? 'nest', message: this.summary(message) });
  }
  warn(message: unknown, context?: string): void {
    this.record('warn', 'nest.warn', { context: context ?? 'nest', message: this.summary(message) });
  }
  debug(message: unknown, context?: string): void {
    this.record('debug', 'nest.debug', { context: context ?? 'nest', message: this.summary(message) });
  }
  verbose(message: unknown, context?: string): void {
    this.debug(message, context);
  }

  private summary(message: unknown): string {
    if (message instanceof Error) return message.name;
    if (typeof message !== 'string') return typeof message;
    return message
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/((?:access[_-]?token|api[_-]?key|password|secret|authorization)\s*[:=]\s*)\S+/gi, '$1[redacted]')
      .slice(0, 240);
  }
}
