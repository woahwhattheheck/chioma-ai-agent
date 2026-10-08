import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  SESSION_STORE,
  SessionStore,
} from '../../agent/memory/session-store.interface';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
  ) {}

  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.sessionStore.checkReady();
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        dependency: 'sessionStore',
      });
    }
    return { status: 'ok' };
  }
}
