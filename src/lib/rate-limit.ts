import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

/**
 * Rate limiting using Upstash Redis.
 * Falls back to no-op if UPSTASH_REDIS_REST_URL is not configured,
 * allowing local development without Redis.
 */

const isConfigured = !!(
  process.env.UPSTASH_REDIS_REST_URL &&
  process.env.UPSTASH_REDIS_REST_TOKEN
);

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!isConfigured) return null;
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return redis;
}

// Pre-built rate limiters for different route categories
const limiters = new Map<string, Ratelimit>();

function getLimiter(name: string, requests: number, window: string): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;

  if (!limiters.has(name)) {
    limiters.set(
      name,
      new Ratelimit({
        redis: r,
        limiter: Ratelimit.slidingWindow(requests, window as `${number} ${"s" | "m" | "h" | "d"}`),
        prefix: `rl:${name}`,
      })
    );
  }
  return limiters.get(name)!;
}

export type RateLimitResult =
  | { success: true }
  | { success: false; response: NextResponse };

/**
 * Check rate limit for a given identifier.
 * Returns { success: true } if allowed, or { success: false, response } with a 429 response.
 * If Redis is not configured, always allows (for local dev).
 */
export async function rateLimit(
  identifier: string,
  category: "mutation" | "message" | "upload" | "search" | "webhook"
): Promise<RateLimitResult> {
  const configs: Record<string, { requests: number; window: string }> = {
    mutation: { requests: 30, window: "1 m" },
    message: { requests: 20, window: "1 m" },
    upload: { requests: 10, window: "1 m" },
    search: { requests: 60, window: "1 m" },
    webhook: { requests: 200, window: "1 m" },
  };

  const config = configs[category];
  const limiter = getLimiter(category, config.requests, config.window);

  // No-op in local dev without Redis
  if (!limiter) {
    return { success: true };
  }

  const result = await limiter.limit(identifier);

  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(result.reset / 1000).toString(),
            "X-RateLimit-Limit": result.limit.toString(),
            "X-RateLimit-Remaining": result.remaining.toString(),
          },
        }
      ),
    };
  }

  return { success: true };
}
