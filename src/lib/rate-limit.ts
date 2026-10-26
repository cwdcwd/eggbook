import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

/**
 * Rate limiting using Upstash Redis.
 *
 * Failure policy (fail-closed in production):
 * - Redis configured → Upstash limiter; if a Redis call errors, fall back to a
 *   per-instance in-memory limiter for that request instead of allowing.
 * - Redis NOT configured → local dev allows everything (no-op); production
 *   must never run without a real limiter, so a best-effort in-memory fixed
 *   window limiter is used. It is per-instance and lost on deploy/restart —
 *   deploy UPSTASH_REDIS_REST_URL/TOKEN for distributed enforcement.
 */

const isRedisConfigured = () =>
  !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const isProduction = () => process.env.NODE_ENV === "production";

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!isRedisConfigured()) return null;
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

export type RateLimitCategory = "mutation" | "message" | "upload" | "search" | "webhook" | "read";

const RATE_LIMIT_CONFIGS: Record<RateLimitCategory, { requests: number; window: string }> = {
  mutation: { requests: 30, window: "1 m" },
  message: { requests: 20, window: "1 m" },
  upload: { requests: 10, window: "1 m" },
  search: { requests: 60, window: "1 m" },
  webhook: { requests: 200, window: "1 m" },
  read: { requests: 120, window: "1 m" },
};

// ---------------------------------------------------------------------------
// In-memory fixed-window limiter (per instance). Used as fallback only.
// ---------------------------------------------------------------------------
type WindowState = { count: number; windowStart: number };
const memoryWindows = new Map<RateLimitCategory, Map<string, WindowState>>();
const MAX_IDENTIFIER_TRACKED = 50_000; // bound memory; prune oldest beyond this

function memoryLimit(category: RateLimitCategory, identifier: string, requests: number, windowMs: number): boolean {
  let windows = memoryWindows.get(category);
  if (!windows) {
    windows = new Map();
    memoryWindows.set(category, windows);
  }

  const now = Date.now();
  const state = windows.get(identifier);
  if (!state || now - state.windowStart >= windowMs) {
    windows.set(identifier, { count: 1, windowStart: now });
    // Prune stale entries occasionally to bound memory
    if (windows.size > MAX_IDENTIFIER_TRACKED) {
      for (const [id, s] of windows) {
        if (now - s.windowStart >= windowMs) windows.delete(id);
        if (windows.size <= MAX_IDENTIFIER_TRACKED) break;
      }
    }
    return true;
  }

  state.count += 1;
  return state.count <= requests;
}

/**
 * Check rate limit for a given identifier.
 * Returns { success: true } if allowed, or { success: false, response } with a 429 response.
 */
export async function rateLimit(
  identifier: string,
  category: RateLimitCategory
): Promise<RateLimitResult> {
  const config = RATE_LIMIT_CONFIGS[category];

  if (isRedisConfigured()) {
    let redisUnavailable = false;
    try {
      const limiter = getLimiter(category, config.requests, config.window);
      if (!limiter) {
        redisUnavailable = true;
      } else {
        const result = await limiter.limit(identifier);
        if (result.reason === "timeout") {
          // Upstash's timeout escape hatch resolves { success: true } when the
          // Redis call is still in flight or the backend is unreachable — i.e.
          // it FAILS OPEN. A broken Redis must not disable enforcement; treat
          // it like an outage and fall through to the deterministic limiter.
          redisUnavailable = true;
        } else if (!result.success) {
          return {
            success: false,
            response: NextResponse.json(
              { error: "Too many requests" },
              {
                status: 429,
                headers: {
                  "Retry-After": Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)).toString(),
                  "X-RateLimit-Limit": result.limit.toString(),
                  "X-RateLimit-Remaining": result.remaining.toString(),
                },
              }
            ),
          };
        } else {
          return { success: true };
        }
      }
    } catch {
      // Redis error: do NOT open the floodgates. Continue into the in-memory
      // fallback below (best-effort distributed outage behavior).
      redisUnavailable = true;
    }

    if (!redisUnavailable) {
      return { success: true };
    }
  }

  // No Redis (or Redis outage): dev allows; production uses in-memory limiter.
  if (!isProduction()) {
    return { success: true };
  }

  const windowMs = parseWindowMs(config.window);
  const allowed = memoryLimit(category, identifier, config.requests, windowMs);
  if (!allowed) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
          },
        }
      ),
    };
  }
  return { success: true };
}

function parseWindowMs(window: string): number {
  const match = /^(\d+)\s+([smhd])$/.exec(window);
  if (!match) return 60_000;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const unitMs = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * unitMs;
}