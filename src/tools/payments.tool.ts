import { Injectable } from '@nestjs/common';
import { AgentTool, ToolContext } from './tool.interface';
import { ChiomaApiClient } from '../integrations/chioma-api/chioma-api.client';

/**
 * Get the status of rent payments and payment schedules for a user's properties or rentals.
 * Returns current balance, upcoming due dates, and payment history.
 */
@Injectable()
export class GetPaymentStatusTool implements AgentTool {
  definition = {
    name: 'get_payment_status',
    description:
      'Get rent payment status, upcoming due dates, and payment history. Shows current balance, next payment date, and recent transactions.',
    parameters: {
      type: 'object',
      properties: {
        propertyId: {
          type: 'string',
          description: 'Optional property ID to filter payments. If omitted, returns all user payments.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of payment records to return (default: 20).',
          default: 20,
        },
      },
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const propertyId = args.propertyId as string | undefined;
    const limit = (args.limit as number) ?? 20;

    const status = await this.chiomaApi.getPaymentStatus(context.accessToken, propertyId, limit);
    return JSON.stringify(status);
  }
}

/**
 * Explicit rent-payment lookup used by the conversational agent.
 * This tool only reads the caller's own payment status; no payment is initiated.
 * The existing get_payment_status entry remains available for older clients.
 */
@Injectable()
export class GetRentPaymentStatusTool implements AgentTool {
  definition = {
    name: 'get_rent_payment_status',
    description:
      'Read rent payment status, current balance, next due date and recent payment history without initiating a payment.',
    parameters: {
      type: 'object',
      properties: {
        propertyId: {
          type: 'string',
          description: 'Optional rental property ID. If omitted, return the caller\'s payments.',
        },
        limit: {
          type: 'number',
          description: 'Maximum history records (default 20).',
          default: 20,
        },
      },
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const propertyId = args.propertyId as string | undefined;
    const limit = (args.limit as number) ?? 20;
    const status = await this.chiomaApi.getRentPaymentStatus(
      context.accessToken,
      propertyId,
      limit,
    );
    return JSON.stringify(status);
  }
}

/**
 * Make or record a rent payment, or update payment method on file.
 * Returns confirmation of the payment or method update.
 */
@Injectable()
export class MakePaymentTool implements AgentTool {
  definition = {
    name: 'make_payment',
    description:
      'Record or process a rent payment for a property. Requires the property ID and payment amount. Optionally specify payment method or schedule a future payment.',
    parameters: {
      type: 'object',
      properties: {
        propertyId: { type: 'string', description: 'The property ID (rental).' },
        amount: {
          type: 'number',
          description: 'Payment amount in USD cents (e.g., 150000 for $1500).',
        },
        paymentMethod: {
          type: 'string',
          enum: ['bank_transfer', 'card', 'stellar'],
          description: 'Payment method: bank_transfer, card, or stellar (crypto).',
        },
        notes: {
          type: 'string',
          description: 'Optional notes or reference for the payment.',
        },
      },
      required: ['propertyId', 'amount', 'paymentMethod'],
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const confirmation = await this.chiomaApi.makePayment(context.accessToken, {
      propertyId: args.propertyId as string,
      amount: args.amount as number,
      paymentMethod: args.paymentMethod as string,
      notes: args.notes as string | undefined,
    });
    return JSON.stringify(confirmation);
  }
}

/**
 * Get breakdown of charges for a rental: base rent, utilities, fees, deposits, etc.
 */
@Injectable()
export class GetChargeBreakdownTool implements AgentTool {
  definition = {
    name: 'get_charge_breakdown',
    description:
      'Get detailed breakdown of all charges for a rental property: base rent, utility allowances, late fees, security deposit, move-in/out fees, etc.',
    parameters: {
      type: 'object',
      properties: {
        propertyId: {
          type: 'string',
          description: 'The property ID (rental).',
        },
      },
      required: ['propertyId'],
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const breakdown = await this.chiomaApi.getChargeBreakdown(
      context.accessToken,
      args.propertyId as string,
    );
    return JSON.stringify(breakdown);
  }
}
