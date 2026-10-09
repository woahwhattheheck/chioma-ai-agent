import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * Limit billable chat turns by network peer, rather than a caller-controlled
 * session ID or bearer token. This protects the LLM budget even when clients
 * rotate sessions. One instance is shared by ChatModule in each app process.
 */
@Injectable()
export class ChatRateLimitGuard implements CanActivate {
  private static readonly WINDOW_MS = 60_000;
  private static readonly REQUESTS_PER_WINDOW = 30;
  private static readonly MAX_TRACKED_PEERS = 10_000;

  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      ip?: string;
      socket?: { remoteAddress?: string };
    }>();
    // Do not trust unverified Forwarded/X-Forwarded-For headers.
    const peer = request.ip || request.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const window = this.windows.get(peer);

    if (!window || now >= window.resetAt) {
      if (!window && this.windows.size >= ChatRateLimitGuard.MAX_TRACKED_PEERS) {
        // Expired peers are removed lazily, avoiding a timer and unbounded
        // state growth under a stream of unique client IPs.
        for (const [address, entry] of this.windows) {
          if (now >= entry.resetAt) this.windows.delete(address);
        }
        if (this.windows.size >= ChatRateLimitGuard.MAX_TRACKED_PEERS) {
          this.reject(context, ChatRateLimitGuard.WINDOW_MS);
        }
      }
      this.windows.set(peer, {
        count: 1,
        resetAt: now + ChatRateLimitGuard.WINDOW_MS,
      });
      return true;
    }

    if (window.count >= ChatRateLimitGuard.REQUESTS_PER_WINDOW) {
      this.reject(context, window.resetAt - now);
    }

    window.count += 1;
    return true;
  }

  private reject(context: ExecutionContext, waitMs: number): never {
    context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Retry-After', String(Math.max(1, Math.ceil(waitMs / 1000))));
    throw new HttpException('Chat rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
  }
}
