import {
  GetDisputeStatusTool,
  FileDisputeTool,
  SubmitDisputeEvidenceTool,
  AcceptDisputeSettlementTool,
  DraftDisputeFilingTool,
} from './disputes.tool';
import { ChiomaApiClient } from '../integrations/chioma-api/chioma-api.client';

describe('disputes tools', () => {
  const context = { accessToken: 'tok' };

  function makeClient() {
    const getDisputeStatus = jest.fn<
      ReturnType<ChiomaApiClient['getDisputeStatus']>,
      Parameters<ChiomaApiClient['getDisputeStatus']>
    >();
    const fileDispute = jest.fn<
      ReturnType<ChiomaApiClient['fileDispute']>,
      Parameters<ChiomaApiClient['fileDispute']>
    >();
    const submitDisputeEvidence = jest.fn<
      ReturnType<ChiomaApiClient['submitDisputeEvidence']>,
      Parameters<ChiomaApiClient['submitDisputeEvidence']>
    >();
    const acceptDisputeSettlement = jest.fn<
      ReturnType<ChiomaApiClient['acceptDisputeSettlement']>,
      Parameters<ChiomaApiClient['acceptDisputeSettlement']>
    >();
    const client = {
      getDisputeStatus,
      fileDispute,
      submitDisputeEvidence,
      acceptDisputeSettlement,
    } as unknown as ChiomaApiClient;
    return {
      client,
      getDisputeStatus,
      fileDispute,
      submitDisputeEvidence,
      acceptDisputeSettlement,
    };
  }

  describe('GetDisputeStatusTool', () => {
    it('returns all disputes with default status filter', async () => {
      const { client, getDisputeStatus } = makeClient();
      getDisputeStatus.mockResolvedValue([
        {
          disputeId: 'disp_123',
          propertyId: 'prop123',
          status: 'open',
          type: 'maintenance_not_provided',
        },
      ]);
      const tool = new GetDisputeStatusTool(client);

      const result = await tool.execute({}, context);

      expect(getDisputeStatus).toHaveBeenCalledWith('tok', undefined, 'all');
      expect(JSON.parse(result)).toEqual([
        {
          disputeId: 'disp_123',
          propertyId: 'prop123',
          status: 'open',
          type: 'maintenance_not_provided',
        },
      ]);
    });

    it('filters disputes by propertyId and status', async () => {
      const { client, getDisputeStatus } = makeClient();
      getDisputeStatus.mockResolvedValue([]);
      const tool = new GetDisputeStatusTool(client);

      await tool.execute({ propertyId: 'prop123', status: 'open' }, context);

      expect(getDisputeStatus).toHaveBeenCalledWith('tok', 'prop123', 'open');
    });
  });

  describe('FileDisputeTool', () => {
    it('files a dispute with required fields', async () => {
      const { client, fileDispute } = makeClient();
      fileDispute.mockResolvedValue({
        disputeId: 'disp_456',
        status: 'filed',
        arbitrationStartDate: '2026-07-26',
      });
      const tool = new FileDisputeTool(client);

      const result = await tool.execute(
        {
          propertyId: 'prop123',
          disputeType: 'maintenance_not_provided',
          claimDescription: 'Broken kitchen sink not repaired for 2 months',
          evidenceUrls: ['https://example.com/photo1.jpg'],
        },
        context,
      );

      expect(fileDispute).toHaveBeenCalledWith('tok', {
        propertyId: 'prop123',
        disputeType: 'maintenance_not_provided',
        claimDescription: 'Broken kitchen sink not repaired for 2 months',
        damagesRequested: undefined,
        evidenceUrls: ['https://example.com/photo1.jpg'],
      });
      expect(JSON.parse(result)).toEqual({
        disputeId: 'disp_456',
        status: 'filed',
        arbitrationStartDate: '2026-07-26',
      });
    });

    it('includes damages request when provided', async () => {
      const { client, fileDispute } = makeClient();
      fileDispute.mockResolvedValue({ disputeId: 'disp_789', status: 'filed' });
      const tool = new FileDisputeTool(client);

      await tool.execute(
        {
          propertyId: 'prop123',
          disputeType: 'rent_overcharge',
          claimDescription: 'Charged $100 extra per month',
          damagesRequested: 120000,
        },
        context,
      );

      expect(fileDispute).toHaveBeenCalledWith('tok', {
        propertyId: 'prop123',
        disputeType: 'rent_overcharge',
        claimDescription: 'Charged $100 extra per month',
        damagesRequested: 120000,
        evidenceUrls: [],
      });
    });
  });

  describe('SubmitDisputeEvidenceTool', () => {
    it('submits evidence to an active dispute', async () => {
      const { client, submitDisputeEvidence } = makeClient();
      submitDisputeEvidence.mockResolvedValue({
        disputeId: 'disp_123',
        evidenceCount: 2,
        status: 'in_arbitration',
      });
      const tool = new SubmitDisputeEvidenceTool(client);

      const result = await tool.execute(
        {
          disputeId: 'disp_123',
          evidenceUrls: ['https://example.com/receipt1.pdf'],
          statement: 'Attached repair receipt from licensed contractor',
        },
        context,
      );

      expect(submitDisputeEvidence).toHaveBeenCalledWith('tok', {
        disputeId: 'disp_123',
        evidenceUrls: ['https://example.com/receipt1.pdf'],
        statement: 'Attached repair receipt from licensed contractor',
        counterClaim: undefined,
      });
      expect(JSON.parse(result)).toEqual({
        disputeId: 'disp_123',
        evidenceCount: 2,
        status: 'in_arbitration',
      });
    });

    it('submits evidence with a counter-claim', async () => {
      const { client, submitDisputeEvidence } = makeClient();
      submitDisputeEvidence.mockResolvedValue({
        disputeId: 'disp_123',
        evidenceCount: 0,
        status: 'in_arbitration',
      });
      const tool = new SubmitDisputeEvidenceTool(client);

      await tool.execute(
        {
          disputeId: 'disp_123',
          statement: 'Repairing now, but landlord owes water bill credit',
          counterClaim: {
            type: 'expense_recovery',
            amount: 50000,
            description: 'Water bill paid while landlord delayed repair',
          },
        },
        context,
      );

      expect(submitDisputeEvidence).toHaveBeenCalledWith('tok', {
        disputeId: 'disp_123',
        evidenceUrls: [],
        statement: 'Repairing now, but landlord owes water bill credit',
        counterClaim: {
          type: 'expense_recovery',
          amount: 50000,
          description: 'Water bill paid while landlord delayed repair',
        },
      });
    });
  });

  describe('AcceptDisputeSettlementTool', () => {
    it('accepts a dispute settlement', async () => {
      const { client, acceptDisputeSettlement } = makeClient();
      acceptDisputeSettlement.mockResolvedValue({
        disputeId: 'disp_123',
        status: 'settled',
        settlementAmount: 50000,
        resolvedDate: '2026-07-20',
      });
      const tool = new AcceptDisputeSettlementTool(client);

      const result = await tool.execute(
        {
          disputeId: 'disp_123',
          settlementId: 'settle_456',
          notes: 'Agreed to $500 credit on next months rent',
        },
        context,
      );

      expect(acceptDisputeSettlement).toHaveBeenCalledWith('tok', {
        disputeId: 'disp_123',
        settlementId: 'settle_456',
        notes: 'Agreed to $500 credit on next months rent',
      });
      expect(JSON.parse(result)).toEqual({
        disputeId: 'disp_123',
        status: 'settled',
        settlementAmount: 50000,
        resolvedDate: '2026-07-20',
      });
    });
  });
});

describe('DraftDisputeFilingTool (#37)', () => {
  const context = { accessToken: 'user-token' };

  it('returns an editable human-review draft without submitting a dispute', async () => {
    const submission = jest.spyOn(ChiomaApiClient.prototype, 'fileDispute');
    try {
      const tool = new DraftDisputeFilingTool();
      const result = JSON.parse(await tool.execute({
        propertyId: 'prop_1',
        disputeType: 'rent_overcharge',
        claimDescription: 'Rent was charged twice on the same date.',
        damagesRequested: 15000,
        evidenceUrls: ['https://example.com/receipt.pdf'],
      }, context));
      expect(result).toEqual(expect.objectContaining({
        draftStatus: 'requires_human_review',
        submissionStatus: 'not_submitted',
        filingDraft: expect.objectContaining({
          propertyId: 'prop_1',
          disputeType: 'rent_overcharge',
          damagesRequested: 15000,
        }),
      }));
      expect(result.reviewChecklist).toHaveLength(3);
      expect(submission).not.toHaveBeenCalled();
    } finally {
      submission.mockRestore();
    }
  });

  it('rejects invalid filing data without submitting anything', async () => {
    const tool = new DraftDisputeFilingTool();
    await expect(tool.execute({
      propertyId: 'prop_1',
      disputeType: 'unknown',
      claimDescription: 'An issue',
    }, context)).rejects.toThrow('supported disputeType');
  });
});
