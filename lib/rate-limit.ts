/**
 * Best-effort in-memory rate limiter for API routes.
 *
 * The limit is enforced per Worker isolate: each Cloudflare colo keeps its own
 * counters, and counters reset on deploy. This is deliberately simple — it
 * stops abusive bursts and accidental loops, while Cloudflare's edge WAF
 * remains the place for global quotas. Limits are keyed by client IP when a
 * real client IP header is available (Cloudflare sets `CF-Connecting-IP`),
 * falling back to the socket-less loopback bucket.
 */

export interface RateLimitRule {
  /** Maximum requests allowed per window. */
  limit: number;
  /** Sliding-window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest in-flight request leaves the window. */
  retryAfterSeconds: number;
  remaining: number;
}

interface RateLimitBucket {
  timestamps: number[];
}

const buckets = new Map<string, RateLimitBucket>();

/** Upper bound on tracked keys so attacker IP spoofing cannot grow memory. */
const MAX_BUCKETS = 10_000;

function pruneBuckets(now: number) {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.timestamps.length === 0 || now - bucket.timestamps[0] > 3_600_000) {
      buckets.delete(key);
      if (buckets.size <= MAX_BUCKETS) break;
    }
  }
}

export function clientIpFromRequest(request: Request): string {
  const forwarded =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip");
  if (forwarded && /^[\w.:-]{1,64}$/.test(forwarded.trim())) {
    return forwarded.trim();
  }
  return "local";
}

export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(key, bucket);
    pruneBuckets(now);
  }

  const windowStart = now - rule.windowMs;
  while (bucket.timestamps.length > 0 && bucket.timestamps[0] <= windowStart) {
    bucket.timestamps.shift();
  }

  if (bucket.timestamps.length >= rule.limit) {
    const oldest = bucket.timestamps[0];
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1_000)),
      remaining: 0,
    };
  }

  bucket.timestamps.push(now);
  return {
    allowed: true,
    retryAfterSeconds: 0,
    remaining: rule.limit - bucket.timestamps.length,
  };
}
