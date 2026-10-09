import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { throwError } from 'rxjs';
import { RootConfig } from '../../config/env.validation';
import { BackendCircuitOpenError } from './chioma-api-circuit-breaker';
import { ChiomaApiClient } from './chioma-api.client';

describe('ChiomaApiClient circuit-breaker integration (#26)', () => {
  const backendFailure = () =>
    Object.assign(new Error('unavailable 503'), { response: { status: 503 } });

  const config = {
    get: jest.fn().mockReturnValue({ chiomaApiUrl: 'https://backend.example' }),
  } as unknown as ConfigService<RootConfig, true>;

  it('short-circuits further GET calls and preserves caller-scoped bearer authentication', async () => {
    const error = backendFailure();
    const get = jest.fn().mockImplementation(() => throwError(() => error));
    const client = new ChiomaApiClient({ get } as unknown as HttpService, config);

    for (let i = 0; i < 3; i++) {
      await expect(client.getRecommendations('tenant-one')).rejects.toBe(error);
    }
    await expect(client.getRecommendations('tenant-two')).rejects.toThrow(
      BackendCircuitOpenError,
    );
    expect(get).toHaveBeenCalledTimes(3);
    expect(get.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tenant-one' }),
      }),
    );
  });

  it('also short-circuits POST calls without retrying a request that may mutate state', async () => {
    const error = backendFailure();
    const post = jest.fn().mockImplementation(() => throwError(() => error));
    const client = new ChiomaApiClient({ post } as unknown as HttpService, config);

    for (let i = 0; i < 3; i++) {
      await expect(
        client.makePayment('tenant-one', {
          propertyId: 'property-1',
          amount: 100,
          paymentMethod: 'bank_transfer',
        }),
      ).rejects.toBe(error);
    }
    await expect(
      client.makePayment('tenant-one', {
        propertyId: 'property-1',
        amount: 100,
        paymentMethod: 'bank_transfer',
      }),
    ).rejects.toThrow(BackendCircuitOpenError);
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tenant-one' }),
      }),
    );
  });
});
