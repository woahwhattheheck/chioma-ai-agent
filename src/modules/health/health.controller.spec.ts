import { ServiceUnavailableException } from '@nestjs/common';
import { SessionStore } from '../../agent/memory/session-store.interface';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controllerWithProbe = (probe: () => Promise<void>) =>
    new HealthController({ checkReady: probe } as SessionStore);

  it('keeps liveness independent of session backend availability', () => {
    const controller = controllerWithProbe(async () => {
      throw new Error('backend offline');
    });
    expect(controller.check()).toEqual({ status: 'ok' });
  });

  it('reports ready only after a healthy store probe', async () => {
    const checkReady = jest.fn().mockResolvedValue(undefined);
    const controller = controllerWithProbe(checkReady);

    await expect(controller.ready()).resolves.toEqual({ status: 'ok' });
    expect(checkReady).toHaveBeenCalledTimes(1);
  });

  it('returns a sanitized 503 when the store is unavailable', async () => {
    const controller = controllerWithProbe(async () => {
      throw new Error('private connection details');
    });

    try {
      await controller.ready();
      throw new Error('Expected the readiness probe to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      if (error instanceof ServiceUnavailableException) {
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toEqual({
          status: 'unavailable',
          dependency: 'sessionStore',
        });
      }
    }
  });
});
