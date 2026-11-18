import { describe, expect, it, beforeEach } from "vitest";

import {
  clientIpOf,
  enforceRateLimit,
  rateLimit,
  resetRateLimits,
} from "@/lib/rateLimit";

beforeEach(() => {
  resetRateLimits();
});

describe("rateLimit 固定窗口计数", () => {
  it("窗口内放行 limit 次，其后拒绝并给出重试秒数", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit("k1", 3, 60_000, 1_000).ok).toBe(true);
    }
    const blocked = rateLimit("k1", 3, 60_000, 1_500);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60); // resetAt 61_000ms，now 1_500ms
  });

  it("窗口过期后重新计数", () => {
    for (let i = 0; i < 3; i += 1) rateLimit("k2", 3, 60_000, 0);
    expect(rateLimit("k2", 3, 60_000, 59_999).ok).toBe(false);
    expect(rateLimit("k2", 3, 60_000, 60_000).ok).toBe(true);
  });

  it("不同桶互不影响", () => {
    rateLimit("a:1.1.1.1", 1, 60_000, 0);
    expect(rateLimit("a:1.1.1.1", 1, 60_000, 0).ok).toBe(false);
    expect(rateLimit("b:1.1.1.1", 1, 60_000, 0).ok).toBe(true);
    expect(rateLimit("a:2.2.2.2", 1, 60_000, 0).ok).toBe(true);
  });
});

describe("enforceRateLimit 路由守卫", () => {
  function requestWithIp(ip: string): Request {
    return new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
    });
  }

  it("未超限返回 null（放行），超限返回 429 + Retry-After", async () => {
    const ip = "203.0.113.7";
    expect(enforceRateLimit(requestWithIp(ip), "t", 2)).toBeNull();
    expect(enforceRateLimit(requestWithIp(ip), "t", 2)).toBeNull();
    const limited = enforceRateLimit(requestWithIp(ip), "t", 2);
    expect(limited).not.toBeNull();
    expect(limited?.status).toBe(429);
    const retryAfter = limited?.headers.get("Retry-After");
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await limited?.json()) as { error: string; code: string };
    expect(body.code).toBe("rate_limited");
  });

  it("clientIpOf 取 X-Forwarded-For 首跳，缺省为 unknown", () => {
    expect(clientIpOf(requestWithIp("198.51.100.9"), true)).toBe("198.51.100.9");
    expect(clientIpOf(requestWithIp("198.51.100.9"), false)).toBe("unknown");
    expect(clientIpOf(new Request("http://localhost/x"))).toBe("unknown");
    expect(
      clientIpOf(new Request("http://localhost/x", { headers: { "x-real-ip": "192.0.2.5" } }), true),
    ).toBe("192.0.2.5");
  });
});
