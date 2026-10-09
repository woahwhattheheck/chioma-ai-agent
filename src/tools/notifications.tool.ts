import { Injectable } from '@nestjs/common';
import { NotificationPreferencesStore } from '../agent/memory/notification-preferences.store';
import { AgentTool, ToolContext } from './tool.interface';
import { ChiomaApiClient } from '../integrations/chioma-api/chioma-api.client';

/**
 * Get pending notifications and reminders for the user.
 * Includes rent due dates, draft expirations, dispute deadlines, payment reminders, etc.
 */
@Injectable()
export class GetNotificationsTool implements AgentTool {
  definition = {
    name: 'get_notifications',
    description:
      'Get all pending notifications and reminders: upcoming rent due dates, expiring lease drafts, dispute deadlines, payment reminders, maintenance requests, and alerts.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['rent', 'disputes', 'maintenance', 'lease', 'fraud_alert', 'all'],
          description: 'Filter by notification category (default: all).',
          default: 'all',
        },
        urgencyLevel: {
          type: 'string',
          enum: ['critical', 'urgent', 'normal', 'all'],
          description: 'Filter by urgency (default: all).',
          default: 'all',
        },
      },
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const notifications = await this.chiomaApi.getNotifications(
      context.accessToken,
      (args.category as string) ?? 'all',
      (args.urgencyLevel as string) ?? 'all',
    );
    return JSON.stringify(notifications);
  }
}

/**
 * Mark a notification as read or dismiss it.
 */
@Injectable()
export class DismissNotificationTool implements AgentTool {
  definition = {
    name: 'dismiss_notification',
    description: 'Mark a notification as read or dismiss it. This stops reminders for that event.',
    parameters: {
      type: 'object',
      properties: {
        notificationId: {
          type: 'string',
          description: 'The notification ID.',
        },
        action: {
          type: 'string',
          enum: ['read', 'dismiss', 'snooze_24h'],
          description: 'Action to take: read, dismiss, or snooze for 24 hours.',
        },
      },
      required: ['notificationId', 'action'],
    },
  };

  constructor(private readonly chiomaApi: ChiomaApiClient) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const result = await this.chiomaApi.dismissNotification(
      context.accessToken,
      args.notificationId as string,
      args.action as string,
    );
    return JSON.stringify(result);
  }
}

/**
 * Subscribe or update notification preferences (email, SMS, push, in-app).
 */
@Injectable()
export class SetNotificationPreferencesTool implements AgentTool {
  definition = {
    name: 'set_notification_preferences',
    description:
      'Configure notification delivery methods and frequency. Choose channels (email, SMS, push, in-app) and which events to notify about.',
    parameters: {
      type: 'object',
      properties: {
        channels: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['email', 'sms', 'push', 'in_app'],
          },
          description: 'Notification channels to enable.',
        },
        categories: {
          type: 'object',
          description: 'Per-category notification settings',
          properties: {
            rent_reminders: { type: 'boolean', description: 'Enable rent due reminders' },
            disputes: { type: 'boolean', description: 'Enable dispute alerts' },
            maintenance: { type: 'boolean', description: 'Enable maintenance alerts' },
            lease_drafts: { type: 'boolean', description: 'Enable lease expiration reminders' },
            fraud_alerts: { type: 'boolean', description: 'Enable fraud warnings' },
            payments: { type: 'boolean', description: 'Enable payment confirmations' },
          },
        },
        quietHours: {
          type: 'object',
          description: 'Optional quiet hours to avoid notifications',
          properties: {
            startTime: { type: 'string', description: 'Start time (HH:MM, 24-hour format)' },
            endTime: { type: 'string', description: 'End time (HH:MM, 24-hour format)' },
            timezone: { type: 'string', description: 'Timezone for quiet hours (e.g., UTC, EST)' },
          },
        },
      },
    },
  };

  constructor(
    private readonly chiomaApi: ChiomaApiClient,
    private readonly preferences: NotificationPreferencesStore = new NotificationPreferencesStore(),
  ) {}

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const requested = {
      channels: (args.channels as string[]) ?? [],
      categories: (args.categories as Record<string, boolean>) ?? {},
      quietHours: (args.quietHours as Record<string, string>) ?? {},
    };
    const result = await this.chiomaApi.setNotificationPreferences(context.accessToken, requested);
    if (result.saved) {
      this.preferences.record(context.accessToken, {
        channels: result.channels ?? requested.channels,
        categories: result.categories ?? requested.categories,
        quietHours: result.quietHours ?? requested.quietHours,
      });
    }
    return JSON.stringify(result);
  }
}
