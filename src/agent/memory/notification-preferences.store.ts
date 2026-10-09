import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

export interface LocalNotificationPreferences {
  channels?: string[];
  categories?: Record<string, boolean>;
  quietHours?: Record<string, string>;
}

/** Shared mirror of preferences acknowledged by the existing backend tool.
 * Keys are token hashes, not credentials. Restart clears both this mirror and
 * the explicitly opted-in scheduler. Capacity exhaustion suppresses nudges.
 */
@Injectable()
export class NotificationPreferencesStore {
  private readonly preferences = new Map<string, LocalNotificationPreferences>();
  private capacityExceeded = false;

  record(accessToken: string, preferences: LocalNotificationPreferences): void {
    const key = this.key(accessToken);
    if (!this.preferences.has(key) && this.preferences.size >= 1024) {
      this.capacityExceeded = true;
      return;
    }
    this.preferences.set(key, {
      channels: preferences.channels ? [...preferences.channels] : undefined,
      categories: { ...preferences.categories },
      quietHours: { ...preferences.quietHours },
    });
  }

  allows(accessToken: string, type: string, now: number): boolean {
    if (this.capacityExceeded) return false;
    const preference = this.preferences.get(this.key(accessToken));
    // An unknown backend preference does not itself opt a session in.
    // The scheduler separately requires explicit, unexpired session consent.
    if (!preference) return true;
    if (preference.channels && !preference.channels.includes('in_app')) return false;
    const normalized = type.toLowerCase().replace(/[-\s]/g, '_');
    const category = /^(rent_due|rent_reminder|payment_due|rent_payment_due)$/.test(normalized)
      ? 'rent_reminders'
      : /^(draft_expiring|draft_expiry|lease_draft_expiring|lease_draft_expiry)$/.test(normalized)
        ? 'lease_drafts' : 'disputes';
    if (preference.categories?.[category] === false) return false;
    const quiet = preference.quietHours;
    if (!quiet || Object.keys(quiet).length === 0) return true;
    const minutes = (text: string): number | null => {
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text)) return null;
      return Number(text.slice(0, 2)) * 60 + Number(text.slice(3));
    };
    const start = minutes(quiet.startTime ?? '');
    const end = minutes(quiet.endTime ?? '');
    if (start === null || end === null || !quiet.timezone) return false;
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: quiet.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(now));
      const value = Number(parts.find(p => p.type === 'hour')?.value) * 60 +
        Number(parts.find(p => p.type === 'minute')?.value);
      if (!Number.isFinite(value)) return false;
      const isQuiet = start < end ? value >= start && value < end
        : start > end ? value >= start || value < end : false;
      return !isQuiet;
    } catch {
      return false; // Invalid timezone must not bypass a requested quiet window.
    }
  }

  private key(accessToken: string): string {
    return createHash('sha256').update(accessToken).digest('hex');
  }
}
