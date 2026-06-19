// Lightweight, dependency-free fixed-window rate limiter.
//
// Best-effort by design: counters live in this process's memory, so on a
// serverless host (Vercel) each instance keeps its own buckets and they reset
// on cold start. That's enough to blunt accidental client loops and casual
// abuse of an expensive endpoint. For a hard, global limit, back this with a
// shared store (e.g. Upstash Redis) behind the same interface.

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map doesn't grow without bound under many
// distinct keys. Runs at most once per sweep window.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms when the current window resets
  retryAfter: number; // seconds until reset (0 when allowed)
};

// Count one hit against `key`. Allowed while count <= limit within windowMs.
export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;

  const ok = bucket.count <= limit;
  return {
    ok,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfter: ok ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

// Derive a stable client identity for limiting. Prefer the authenticated user
// id; fall back to the forwarded client IP, then a shared bucket so an
// unidentifiable caller still can't escape the limit entirely.
export function clientKey(
  req: { headers: { get(name: string): string | null } },
  userId: string | null
): string {
  if (userId) return `user:${userId}`;
  const forwarded = req.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "";
  return ip ? `ip:${ip}` : "anon";
}

// Exposed for tests so a fresh process isn't required between cases.
export function __resetRateLimit() {
  buckets.clear();
  lastSweep = 0;
}
