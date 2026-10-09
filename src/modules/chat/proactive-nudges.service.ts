import { BadRequestException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ChiomaApiClient, NotificationInfo } from '../../integrations/chioma-api/chioma-api.client';
import { SESSION_STORE, SessionStore } from '../../agent/memory/session-store.interface';

interface ActiveSubscription {
  accessToken: string;
  expiresAt: number;
  delivered: Set<string>;
}

const MAX_ACTIVE_SESSIONS = 256;
const ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DELIVERED_PER_SESSION = 128;

/**
 * Proactive in-session nudges only. Users opt in explicitly through the
 * authenticated chat endpoint. Tokens are held in process memory with a
 * 24-hour expiry; no credentials, contact addresses, or recipient IDs enter
 * the durable session history. Restarts fail closed to opted out.
 *
 * This consumes only the authenticated user's existing notification feed.
 * It never contacts users through email/SMS/push or initiates transactions.
 */
@Injectable()
export class ProactiveNudgesService implements OnModuleInit, OnModuleDestroy {
  private readonly subscribers = new Map<string, ActiveSubscription>();
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly chiomaApi: ChiomaApiClient,
    @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.subscribers.clear();
  }

  /** Opt-in is explicit, session-scoped, and reversible. No implicit enable. */
  setEnabled(sessionId: string, accessToken: string, enabled: boolean): void {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }
    if (!enabled) {
      this.subscribers.delete(sessionId);
      return;
    }
    const current = this.subscribers.get(sessionId);
    if (!current && this.subscribers.size >= MAX_ACTIVE_SESSIONS) {
      throw new BadRequestException('active_nudge_session_capacity_reached');
    }
    this.subscribers.set(sessionId, {
      accessToken,
      expiresAt: Date.now() + ACTIVE_TTL_MS,
      delivered: current?.delivered ?? new Set<string>(),
    });
  }

  /** Refresh only sessions that are already opted in. */
  refresh(sessionId: string, accessToken: string): void {
    const current = this.subscribers.get(sessionId);
    if (!current) return;
    if (current.expiresAt <= Date.now()) {
      this.subscribers.delete(sessionId);
      return;
    }
    current.accessToken = accessToken;
    current.expiresAt = Date.now() + ACTIVE_TTL_MS;
  }

  forget(sessionId: string): void {
    this.subscribers.delete(sessionId);
  }

  /** Public so an operator can run a one-off bounded poll without waiting for the timer. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = Date.now();
      for (const [sessionId, subscription] of this.subscribers) {
        if (subscription.expiresAt <= now) {
          this.subscribers.delete(sessionId);
          continue;
        }
        let notifications: NotificationInfo[];
        try {
          notifications = await this.chiomaApi.getNotifications(
            subscription.accessToken, 'all', 'all',
          );
        } catch {
          // A token may have expired or the backend may be unavailable.
          // Never retry an authenticated request blindly or log credentials.
          continue;
        }
        if (!Array.isArray(notifications)) continue;
        for (const notification of notifications.slice(0, MAX_DELIVERED_PER_SESSION)) {
          if (!notification || typeof notification.notificationId !== 'string' ||
              !notification.notificationId || subscription.delivered.has(notification.notificationId)) {
            continue;
          }
          const message = this.reminder(notification, now);
          if (!message) continue;
          if (this.subscribers.get(sessionId) !== subscription ||
              subscription.expiresAt <= Date.now()) break;
          try {
            await this.sessionStore.appendMessages(sessionId, [
              { role: 'assistant', content: message },
            ]);
          } catch {
            // Keep this notification eligible for a future poll if the append failed.
            continue;
          }
          subscription.delivered.add(notification.notificationId);
          if (subscription.delivered.size > MAX_DELIVERED_PER_SESSION) {
            const oldest = subscription.delivered.values().next().value;
            if (oldest !== undefined) subscription.delivered.delete(oldest);
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private reminder(notification: NotificationInfo, now: number): string | null {
    if (typeof notification.type !== 'string' ||
        typeof notification.dueDate !== 'string') return null;
    const deadline = Date.parse(notification.dueDate);
    if (!Number.isFinite(deadline)) return null;
    const untilDue = deadline - now;
    if (untilDue < -DAY_MS || untilDue > 30 * DAY_MS) return null;
    const type = notification.type.toLowerCase().replace(/[-\s]/g, '_');
    let label: string;
    let advanceDays: number;
    if (/^(rent_due|rent_reminder|payment_due|rent_payment_due)$/.test(type)) {
      label = 'A rent payment';
      advanceDays = 7;
    } else if (/^(draft_expiring|draft_expiry|lease_draft_expiring|lease_draft_expiry)$/.test(type)) {
      label = 'A lease draft';
      advanceDays = 30;
    } else if (/^(dispute_deadline|dispute_due|arbitration_deadline)$/.test(type)) {
      label = 'A dispute response';
      advanceDays = 7;
    } else {
      return null;
    }
    if (untilDue > advanceDays * DAY_MS) return null;
    return 'Chioma reminder: ' + label + ' is due on ' +
      new Date(deadline).toISOString().slice(0, 10) +
      '. Review the details in your Chioma account.';
  }
}
