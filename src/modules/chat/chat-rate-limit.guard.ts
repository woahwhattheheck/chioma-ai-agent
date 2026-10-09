import { createHash } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

/**
 * Bounds LLM-costly chat requests per observed client IP for each process.
 * Do not use client-supplied session IDs or X-Forwarded-For to choose a bucket:
 * either can be changed by an unauthenticated caller to evade a limit.
 */
export const CHAT_RATE_WINDOW_MS = 60_000;
export const CHAT_RATE_LIMIT = 30;
const MAX_CLIENT_BUCKETS = 8_192;

interface ChatHttpRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: { authorization?: string | string[] };
}

interface Bucket {
  firstRequestAt: number;
  requests: number;
}

@Injectable()
export class ChatRateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ChatHttpRequest>();
    // Express req.ip uses the actual socket address unless trust proxy is
    // deliberately configured. Never trust a raw X-Forwarded-For header here.
    const address = request.ip || request.socket?.remoteAddress;
    const authorization = request.headers.authorization;
    // No IP exists only in non-HTTP adapters; use a hashed bearer as fallback.
    const fallbackToken = typeof authorization === 'string' ? authorization : '';
    const principal = address ? `ip:${address}` : `auth:${fallbackToken}`;
    const key = createHash('sha256').update(principal).digest('hex');
    const now = Date.now();
    const previous = this.buckets.get(key);

    if (previous && now >= previous.firstRequestAt &&
        now - previous.firstRequestAt < CHAT_RATE_WINDOW_MS) {
      if (previous.requests >= CHAT_RATE_LIMIT) {
        this.reject(now, previous.firstRequestAt);
      }
      previous.requests += 1;
      return true;
    }

    // An expired bucket is removed before admission, not left to grow forever.
    this.buckets.delete(key);
    if (this.buckets.size >= MAX_CLIENT_BUCKETS) {
      for (const [id, bucket] of this.buckets) {
        if (now < bucket.firstRequestAt ||
            now - bucket.firstRequestAt >= CHAT_RATE_WINDOW_MS) {
          this.buckets.delete(id);
        }
      }
    }
    if (this.buckets.size >= MAX_CLIENT_BUCKETS) {
      // Fail closed instead of growing memory without bound under an IP spray.
      this.reject(now, now);
    }
    this.buckets.set(key, { firstRequestAt: now, requests: 1 });
    return true;
  }

  private reject(now: number, firstRequestAt: number): never {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Too many chat requests. Please retry shortly.',
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((CHAT_RATE_WINDOW_MS - (now - firstRequestAt)) / 1_000),
        ),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
