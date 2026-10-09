import { Module } from '@nestjs/common';
import { ChiomaApiModule } from '../integrations/chioma-api/chioma-api.module';
import {
  GetMatchScoreTool,
  GetRecommendationsTool,
  GetSimilarPropertiesTool,
} from './listings.tool';
import {
  GetCompletenessScoreTool,
  GetDescriptionSuggestionTool,
  GetPricingSuggestionTool,
} from './wizard.tool';
import { GetPaymentStatusTool, GetRentPaymentStatusTool, MakePaymentTool, GetChargeBreakdownTool } from './payments.tool';
import {
  GetEscrowStatusTool,
  RequestEscrowReleaseTool,
  FileEscrowClaimTool,
} from './escrow.tool';
import {
  GetDisputeStatusTool,
  FileDisputeTool,
  SubmitDisputeEvidenceTool,
  AcceptDisputeSettlementTool,
} from './disputes.tool';
import {
  GetFraudSignalsTool,
  GetFraudAlertsTool,
  ReportFraudSuspicionTool,
} from './fraud.tool';
import {
  GetNotificationsTool,
  DismissNotificationTool,
  SetNotificationPreferencesTool,
} from './notifications.tool';
import { AGENT_TOOLS, ToolRegistry } from './tools.registry';

const TOOL_PROVIDERS = [
  // Listings
  GetRecommendationsTool,
  GetMatchScoreTool,
  GetSimilarPropertiesTool,
  // Wizard
  GetPricingSuggestionTool,
  GetDescriptionSuggestionTool,
  GetCompletenessScoreTool,
  // Payments
  GetPaymentStatusTool,
  GetRentPaymentStatusTool,
  MakePaymentTool,
  GetChargeBreakdownTool,
  // Escrow
  GetEscrowStatusTool,
  RequestEscrowReleaseTool,
  FileEscrowClaimTool,
  // Disputes
  GetDisputeStatusTool,
  FileDisputeTool,
  SubmitDisputeEvidenceTool,
  AcceptDisputeSettlementTool,
  // Fraud
  GetFraudSignalsTool,
  GetFraudAlertsTool,
  ReportFraudSuspicionTool,
  // Notifications
  GetNotificationsTool,
  DismissNotificationTool,
  SetNotificationPreferencesTool,
];

@Module({
  imports: [ChiomaApiModule],
  providers: [
    ...TOOL_PROVIDERS,
    {
      provide: AGENT_TOOLS,
      useFactory: (...tools: unknown[]) => tools,
      inject: TOOL_PROVIDERS,
    },
    ToolRegistry,
  ],
  exports: [ToolRegistry],
})
export class ToolsModule {}
