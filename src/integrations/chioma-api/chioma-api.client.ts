import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosRequestConfig } from 'axios';
import { RootConfig } from '../../config/env.validation';
import { ChiomaApiCircuitBreaker } from './chioma-api-circuit-breaker';

export interface PropertyRecommendation {
  propertyId: string;
  score: number;
  reasons: string[];
}

export interface MatchScore {
  propertyId: string;
  score: number;
  reasons: string[];
}

export interface PricingSuggestion {
  available: boolean;
  suggestedRent?: { min: number; max: number };
  suggestedDeposit?: { min: number; max: number };
  reasoning?: string;
}

export interface DescriptionSuggestion {
  available: boolean;
  propertyDescription?: string;
  neighborhoodDescription?: string;
}

export interface CompletenessScore {
  available: boolean;
  score?: number;
  improvements?: string[];
}

// Payments
export interface PaymentStatus {
  currentBalance: number;
  nextDueDate?: string;
  lastPaymentDate?: string;
  history: Array<{ date: string; amount: number; status: string }>;
}

export interface PaymentConfirmation {
  transactionId: string;
  status: string;
  amount: number;
  timestamp: string;
}

export interface ChargeBreakdown {
  baseRent: number;
  utilities?: number;
  fees?: number;
  securityDeposit?: number;
  total: number;
}

// Escrow
export interface EscrowStatus {
  propertyId: string;
  heldAmount: number;
  status: string;
  releaseCondition?: string;
  disputes: Array<{ id: string; status: string }>;
}

export interface EscrowReleaseResult {
  requestId: string;
  status: string;
  expectedReleaseDate?: string;
}

export interface EscrowClaimResult {
  claimId: string;
  status: string;
  arbitrationStartDate?: string;
}

// Disputes
export interface DisputeInfo {
  disputeId: string;
  propertyId: string;
  status: string;
  type: string;
  createdAt?: string;
  evidence?: string[];
}

export interface DisputeResult {
  disputeId: string;
  status: string;
  arbitrationStartDate?: string;
}

export interface EvidenceSubmissionResult {
  disputeId: string;
  evidenceCount: number;
  status: string;
}

export interface SettlementResult {
  disputeId: string;
  status: string;
  settlementAmount?: number;
  resolvedDate?: string;
}

// Fraud
export interface FraudSignals {
  riskScore: number;
  signals: string[];
  flaggedAt?: string;
}

export interface FraudAlert {
  alertId: string;
  severity: string;
  type: string;
  description: string;
}

export interface FraudReportResult {
  reportId: string;
  status: string;
  investigationId?: string;
}

// Notifications
export interface NotificationInfo {
  notificationId: string;
  type: string;
  message: string;
  urgency: string;
  dueDate?: string;
}

export interface DismissResult {
  notificationId: string;
  status: string;
  snoozeUntil?: string;
}

export interface PreferencesResult {
  saved: boolean;
  channels?: string[];
  categories?: Record<string, boolean>;
  quietHours?: Record<string, string>;
}

/**
 * Typed client for the chioma backend REST API. All calls require the
 * caller's own JWT bearer token — this service has no user identity of its own.
 */
@Injectable()
export class ChiomaApiClient {
  private readonly baseUrl: string;
  private readonly circuitBreaker = new ChiomaApiCircuitBreaker();

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService<RootConfig, true>,
  ) {
    this.baseUrl = configService.get('app', { infer: true }).chiomaApiUrl;
  }

  getRecommendations(
    accessToken: string,
    limit = 10,
  ): Promise<PropertyRecommendation[]> {
    return this.get('/api/ai/matching/recommendations', accessToken, { limit });
  }

  getMatchScore(accessToken: string, propertyId: string): Promise<MatchScore> {
    return this.get(`/api/ai/matching/match-score/${propertyId}`, accessToken);
  }

  getSimilarProperties(
    accessToken: string,
    propertyId: string,
    limit = 5,
  ): Promise<PropertyRecommendation[]> {
    return this.get(`/api/ai/matching/similar/${propertyId}`, accessToken, { limit });
  }

  getPricingSuggestion(
    accessToken: string,
    draftId: string,
  ): Promise<PricingSuggestion> {
    return this.get(
      `/property-listings/wizard/${draftId}/ai/pricing-suggestion`,
      accessToken,
    );
  }

  getDescriptionSuggestion(
    accessToken: string,
    draftId: string,
  ): Promise<DescriptionSuggestion> {
    return this.get(
      `/property-listings/wizard/${draftId}/ai/description-suggestion`,
      accessToken,
    );
  }

  getCompletenessScore(
    accessToken: string,
    draftId: string,
  ): Promise<CompletenessScore> {
    return this.get(
      `/property-listings/wizard/${draftId}/ai/completeness-score`,
      accessToken,
    );
  }

  // ============ Payments ============
  getPaymentStatus(
    accessToken: string,
    propertyId?: string,
    limit?: number,
  ): Promise<PaymentStatus> {
    return this.get('/api/payments/status', accessToken, { propertyId, limit });
  }

  makePayment(
    accessToken: string,
    payment: {
      propertyId: string;
      amount: number;
      paymentMethod: string;
      notes?: string;
    },
  ): Promise<PaymentConfirmation> {
    return this.post('/api/payments/make', accessToken, payment);
  }

  getChargeBreakdown(accessToken: string, propertyId: string): Promise<ChargeBreakdown> {
    return this.get(`/api/payments/charges/${propertyId}`, accessToken);
  }

  // ============ Escrow ============
  getEscrowStatus(accessToken: string, propertyId: string): Promise<EscrowStatus> {
    return this.get(`/api/escrow/status/${propertyId}`, accessToken);
  }

  requestEscrowRelease(
    accessToken: string,
    request: {
      propertyId: string;
      reason: string;
      amount?: number;
      notes?: string;
    },
  ): Promise<EscrowReleaseResult> {
    return this.post('/api/escrow/release-request', accessToken, request);
  }

  fileEscrowClaim(
    accessToken: string,
    claim: {
      propertyId: string;
      claimAmount: number;
      claimType: string;
      description: string;
      evidenceUrls: string[];
    },
  ): Promise<EscrowClaimResult> {
    return this.post('/api/escrow/claim', accessToken, claim);
  }

  // ============ Disputes ============
  getDisputeStatus(
    accessToken: string,
    propertyId?: string,
    status?: string,
  ): Promise<DisputeInfo[]> {
    return this.get('/api/disputes/status', accessToken, { propertyId, status });
  }

  fileDispute(
    accessToken: string,
    dispute: {
      propertyId: string;
      disputeType: string;
      claimDescription: string;
      damagesRequested?: number;
      evidenceUrls: string[];
    },
  ): Promise<DisputeResult> {
    return this.post('/api/disputes/file', accessToken, dispute);
  }

  submitDisputeEvidence(
    accessToken: string,
    evidence: {
      disputeId: string;
      evidenceUrls: string[];
      statement?: string;
      counterClaim?: Record<string, unknown>;
    },
  ): Promise<EvidenceSubmissionResult> {
    return this.post('/api/disputes/evidence', accessToken, evidence);
  }

  acceptDisputeSettlement(
    accessToken: string,
    settlement: {
      disputeId: string;
      settlementId: string;
      notes?: string;
    },
  ): Promise<SettlementResult> {
    return this.post('/api/disputes/settle', accessToken, settlement);
  }

  // ============ Fraud ============
  getFraudSignals(
    accessToken: string,
    entityType: string,
    entityId: string,
  ): Promise<FraudSignals> {
    return this.get(`/api/fraud/signals/${entityType}/${entityId}`, accessToken);
  }

  getFraudAlerts(
    accessToken: string,
    severity?: string,
    includeResolved?: boolean,
  ): Promise<FraudAlert[]> {
    return this.get('/api/fraud/alerts', accessToken, { severity, includeResolved });
  }

  reportFraudSuspicion(
    accessToken: string,
    report: {
      fraudType: string;
      description: string;
      relatedEntityIds: string[];
      evidenceUrls: string[];
    },
  ): Promise<FraudReportResult> {
    return this.post('/api/fraud/report', accessToken, report);
  }

  // ============ Notifications ============
  getNotifications(
    accessToken: string,
    category?: string,
    urgencyLevel?: string,
  ): Promise<NotificationInfo[]> {
    return this.get('/api/notifications', accessToken, { category, urgencyLevel });
  }

  dismissNotification(
    accessToken: string,
    notificationId: string,
    action: string,
  ): Promise<DismissResult> {
    return this.post(`/api/notifications/${notificationId}/dismiss`, accessToken, { action });
  }

  setNotificationPreferences(
    accessToken: string,
    preferences: {
      channels: string[];
      categories: Record<string, boolean>;
      quietHours: Record<string, string>;
    },
  ): Promise<PreferencesResult> {
    return this.post('/api/notifications/preferences', accessToken, preferences);
  }

  private async post<T>(
    path: string,
    accessToken: string,
    data?: Record<string, unknown>,
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      baseURL: this.baseUrl,
      headers: { Authorization: `Bearer ${accessToken}` },
    };
    return this.circuitBreaker.execute(async () => {
      const response = await firstValueFrom(
        this.httpService.post<T>(path, data ?? {}, config),
      );
      return response.data;
    });
  }
  private async get<T>(
    path: string,
    accessToken: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const config: AxiosRequestConfig = {
      baseURL: this.baseUrl,
      headers: { Authorization: `Bearer ${accessToken}` },
      params,
    };
    return this.circuitBreaker.execute(async () => {
      const response = await firstValueFrom(this.httpService.get<T>(path, config));
      return response.data;
    });
  }
}
