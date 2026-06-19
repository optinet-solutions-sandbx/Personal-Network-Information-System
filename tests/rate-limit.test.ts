import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { rateLimit, clientKey, __resetRateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimit();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const opts = { limit: 3, windowMs: 1000 };

  it("allows requests up to the limit, then blocks", () => {
    expect(rateLimit("k", opts).ok).toBe(true); // 1
    expect(rateLimit("k", opts).ok).toBe(true); // 2
    const third = rateLimit("k", opts); // 3
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);

    const fourth = rateLimit("k", opts); // 4 -> blocked
    expect(fourth.ok).toBe(false);
    expect(fourth.remaining).toBe(0);
    expect(fourth.retryAfter).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    rateLimit("a", opts);
    rateLimit("a", opts);
    rateLimit("a", opts);
    expect(rateLimit("a", opts).ok).toBe(false);
    expect(rateLimit("b", opts).ok).toBe(true);
  });

  it("resets after the window elapses", () => {
    rateLimit("k", opts);
    rateLimit("k", opts);
    rateLimit("k", opts);
    expect(rateLimit("k", opts).ok).toBe(false);

    vi.advanceTimersByTime(1001);
    expect(rateLimit("k", opts).ok).toBe(true);
  });
});

describe("clientKey", () => {
  const reqWith = (headers: Record<string, string>) => ({
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  });

  it("prefers the authenticated user id", () => {
    expect(clientKey(reqWith({}), "user-123")).toBe("user:user-123");
  });

  it("falls back to the first x-forwarded-for IP", () => {
    const req = reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientKey(req, null)).toBe("ip:1.2.3.4");
  });

  it("falls back to x-real-ip, then a shared anon bucket", () => {
    expect(clientKey(reqWith({ "x-real-ip": "9.9.9.9" }), null)).toBe(
      "ip:9.9.9.9"
    );
    expect(clientKey(reqWith({}), null)).toBe("anon");
  });
});
