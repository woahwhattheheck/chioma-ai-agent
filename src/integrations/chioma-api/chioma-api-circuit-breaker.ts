/**
 * A single circuit shared across all authenticated Chioma backend requests.
 *
 * Repeated *backend* failures open the circuit; caller/auth validation errors
 * must not trip it. After cooldown only one request probes recovery.
 */
export class BackendCircuitOpenError extends Error {
  constructor() {
    super('Chioma backend service is temporarily unavailable. Please try again shortly.');
    this.name = 'BackendCircuitOpenError';
  }
}

export class ChiomaApiCircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probeInFlight = false;

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 30_000,
    private readonly clock: () => number = Date.now,
  ) {}

  async execute<T>(request: () => Promise<T>): Promise<T> {
    const observedOpen = this.openedAt;
    const isRecoveryProbe = observedOpen !== null;

    if (observedOpen !== null) {
      if (this.clock() - observedOpen < this.cooldownMs || this.probeInFlight) {
        throw new BackendCircuitOpenError();
      }
      // Synchronous admission: concurrent requests cannot all probe at once.
      this.probeInFlight = true;
    }

    try {
      const result = await request();
      if (isRecoveryProbe && this.openedAt === observedOpen) {
        this.reset();
      } else if (!isRecoveryProbe && this.openedAt === null) {
        this.failures = 0;
      }
      return result;
    } catch (error) {
      if (this.isBackendFailure(error)) {
        if (isRecoveryProbe) {
          this.openedAt = this.clock();
        } else if (this.openedAt === null && ++this.failures >= this.failureThreshold) {
          this.openedAt = this.clock();
        }
      } else if (isRecoveryProbe && this.openedAt === observedOpen) {
        // A response such as 401/404 proves the backend is reachable.
        this.reset();
      }
      throw error;
    } finally {
      if (isRecoveryProbe) this.probeInFlight = false;
    }
  }

  private isBackendFailure(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const axiosError = error as { response?: { status?: number }; code?: string };
    const status = axiosError.response?.status;
    if (typeof status === 'number') {
      return status === 408 || status === 429 || status >= 500;
    }
    return [
      'ECONNABORTED',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(axiosError.code ?? '');
  }

  private reset(): void {
    this.failures = 0;
    this.openedAt = null;
  }
}
