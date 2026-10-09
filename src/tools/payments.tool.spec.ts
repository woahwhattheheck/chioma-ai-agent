import {
  GetPaymentStatusTool,
  GetRentPaymentStatusTool,
  MakePaymentTool,
  GetChargeBreakdownTool,
} from './payments.tool';
import { ChiomaApiClient } from '../integrations/chioma-api/chioma-api.client';

describe('payments tools', () => {
  const context = { accessToken: 'tok' };

  function makeClient() {
    const getPaymentStatus = jest.fn<
      ReturnType<ChiomaApiClient['getPaymentStatus']>,
      Parameters<ChiomaApiClient['getPaymentStatus']>
    >();
    const getRentPaymentStatus = jest.fn<
      ReturnType<ChiomaApiClient['getRentPaymentStatus']>,
      Parameters<ChiomaApiClient['getRentPaymentStatus']>
    >();
    const makePayment = jest.fn<
      ReturnType<ChiomaApiClient['makePayment']>,
      Parameters<ChiomaApiClient['makePayment']>
    >();
    const getChargeBreakdown = jest.fn<
      ReturnType<ChiomaApiClient['getChargeBreakdown']>,
      Parameters<ChiomaApiClient['getChargeBreakdown']>
    >();
    const client = {
      getPaymentStatus,
      getRentPaymentStatus,
      makePayment,
      getChargeBreakdown,
    } as unknown as ChiomaApiClient;
    return { client, getPaymentStatus, getRentPaymentStatus, makePayment, getChargeBreakdown };
  }

  describe('GetPaymentStatusTool', () => {
    it('returns payment status with default limit', async () => {
      const { client, getPaymentStatus } = makeClient();
      getPaymentStatus.mockResolvedValue({
        currentBalance: 0,
        nextDueDate: '2026-08-01',
        lastPaymentDate: '2026-07-01',
        history: [],
      });
      const tool = new GetPaymentStatusTool(client);

      const result = await tool.execute({}, context);

      expect(getPaymentStatus).toHaveBeenCalledWith('tok', undefined, 20);
      expect(JSON.parse(result)).toEqual({
        currentBalance: 0,
        nextDueDate: '2026-08-01',
        lastPaymentDate: '2026-07-01',
        history: [],
      });
    });

    it('filters by propertyId and custom limit', async () => {
      const { client, getPaymentStatus } = makeClient();
      getPaymentStatus.mockResolvedValue({
        currentBalance: 1500,
        nextDueDate: '2026-08-01',
        lastPaymentDate: '2026-07-01',
        history: [],
      });
      const tool = new GetPaymentStatusTool(client);

      await tool.execute({ propertyId: 'prop123', limit: 50 }, context);

      expect(getPaymentStatus).toHaveBeenCalledWith('tok', 'prop123', 50);
    });
  });

  describe('GetRentPaymentStatusTool', () => {
    it('exposes the exact read-only rent-status name and caller bearer context', async () => {
      const { client, getRentPaymentStatus, makePayment } = makeClient();
      const status = {
        currentBalance: 150000,
        nextDueDate: '2026-11-01',
        history: [{ date: '2026-10-01', amount: 150000, status: 'paid' }],
      };
      getRentPaymentStatus.mockResolvedValue(status);
      const tool = new GetRentPaymentStatusTool(client);

      expect(tool.definition.name).toBe('get_rent_payment_status');
      const result = await tool.execute({}, context);

      expect(getRentPaymentStatus).toHaveBeenCalledWith('tok', undefined, 20);
      expect(makePayment).not.toHaveBeenCalled();
      expect(JSON.parse(result)).toEqual(status);
    });

    it('forwards the property ID and requested history limit without mutation', async () => {
      const { client, getRentPaymentStatus, makePayment } = makeClient();
      getRentPaymentStatus.mockResolvedValue({ currentBalance: 0, history: [] });
      const tool = new GetRentPaymentStatusTool(client);

      await tool.execute({ propertyId: 'rental-42', limit: 7 }, context);

      expect(getRentPaymentStatus).toHaveBeenCalledWith('tok', 'rental-42', 7);
      expect(makePayment).not.toHaveBeenCalled();
    });
  });

  describe('MakePaymentTool', () => {
    it('processes a payment with all required fields', async () => {
      const { client, makePayment } = makeClient();
      makePayment.mockResolvedValue({
        transactionId: 'txn_123',
        status: 'completed',
        amount: 150000,
        timestamp: '2026-07-19T12:00:00Z',
      });
      const tool = new MakePaymentTool(client);

      const result = await tool.execute(
        {
          propertyId: 'prop123',
          amount: 150000,
          paymentMethod: 'bank_transfer',
          notes: 'July rent',
        },
        context,
      );

      expect(makePayment).toHaveBeenCalledWith('tok', {
        propertyId: 'prop123',
        amount: 150000,
        paymentMethod: 'bank_transfer',
        notes: 'July rent',
      });
      expect(JSON.parse(result)).toEqual({
        transactionId: 'txn_123',
        status: 'completed',
        amount: 150000,
        timestamp: '2026-07-19T12:00:00Z',
      });
    });

    it('handles payments without notes', async () => {
      const { client, makePayment } = makeClient();
      makePayment.mockResolvedValue({
        transactionId: 'txn_456',
        status: 'completed',
        amount: 150000,
        timestamp: '2026-07-19T12:00:00Z',
      });
      const tool = new MakePaymentTool(client);

      await tool.execute(
        {
          propertyId: 'prop123',
          amount: 150000,
          paymentMethod: 'card',
        },
        context,
      );

      expect(makePayment).toHaveBeenCalledWith('tok', {
        propertyId: 'prop123',
        amount: 150000,
        paymentMethod: 'card',
        notes: undefined,
      });
    });
  });

  describe('GetChargeBreakdownTool', () => {
    it('returns charge breakdown for a property', async () => {
      const { client, getChargeBreakdown } = makeClient();
      getChargeBreakdown.mockResolvedValue({
        baseRent: 150000,
        utilities: 10000,
        fees: 5000,
        securityDeposit: 150000,
        total: 315000,
      });
      const tool = new GetChargeBreakdownTool(client);

      const result = await tool.execute({ propertyId: 'prop123' }, context);

      expect(getChargeBreakdown).toHaveBeenCalledWith('tok', 'prop123');
      expect(JSON.parse(result)).toEqual({
        baseRent: 150000,
        utilities: 10000,
        fees: 5000,
        securityDeposit: 150000,
        total: 315000,
      });
    });
  });
});
