import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { RootConfig } from '../../config/env.validation';
import { ChiomaApiClient } from './chioma-api.client';

describe('ChiomaApiClient request timeout and idempotent retry', () => {
  function makeClient() {
    const get = jest.fn();
    const post = jest.fn();
    const service = { get, post } as unknown as HttpService;
    const config = {
      get: jest.fn().mockReturnValue({ chiomaApiUrl: 'https://backend.example' }),
    } as unknown as ConfigService<RootConfig, true>;
    return { client: new ChiomaApiClient(service, config), get, post };
  }

  it('recovers a transient GET failure after bounded backoff and applies a timeout', async () => {
    const { client, get } = makeClient();
    get.mockReturnValueOnce(throwError(() => ({ response: { status: 503 } })))
      .mockReturnValueOnce(of({ data: { currentBalance: 40, history: [] } }));

    await expect(client.getPaymentStatus('jwt')).resolves.toEqual({
      currentBalance: 40, history: [],
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1]).toMatchObject({
      baseURL: 'https://backend.example', timeout: 8000,
      headers: { Authorization: 'Bearer jwt' },
    });
  });

  it('does not retry a permanent GET authorization error', async () => {
    const { client, get } = makeClient();
    const denial = { response: { status: 403 } };
    get.mockReturnValue(throwError(() => denial));

    await expect(client.getPaymentStatus('jwt')).rejects.toBe(denial);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('never retries a failed money-moving POST and still sets a timeout', async () => {
    const { client, post } = makeClient();
    const unavailable = { response: { status: 503 } };
    post.mockReturnValue(throwError(() => unavailable));

    await expect(client.makePayment('jwt', {
      propertyId: 'p1', amount: 50, paymentMethod: 'bank',
    })).rejects.toBe(unavailable);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][2]).toMatchObject({
      timeout: 8000,
      headers: { Authorization: 'Bearer jwt' },
    });
  });
});
