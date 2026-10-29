import { describe, it, expect } from "vitest";
import { isSameOriginRequest, sameOriginFromRequest } from "@/lib/origin";

describe("isSameOriginRequest：安全方法放行", () => {
  it("GET/HEAD 不看 Origin", () => {
    expect(
      isSameOriginRequest({ method: "GET", origin: "https://evil.com", host: "api.example.com" }),
    ).toBe(true);
    expect(isSameOriginRequest({ method: "HEAD" })).toBe(true);
    expect(isSameOriginRequest({ method: "get" })).toBe(true);
  });
});

describe("isSameOriginRequest：有副作用方法必须同源", () => {
  it("Origin 缺失拒绝", () => {
    expect(isSameOriginRequest({ method: "POST", host: "api.example.com" })).toBe(false);
    expect(
      isSameOriginRequest({ method: "DELETE", host: "api.example.com", origin: null }),
    ).toBe(false);
    expect(isSameOriginRequest({ method: "PUT", host: "api.example.com", origin: "  " })).toBe(
      false,
    );
  });

  it("Origin 为字面量 null 拒绝", () => {
    expect(
      isSameOriginRequest({ method: "POST", origin: "null", host: "api.example.com" }),
    ).toBe(false);
    expect(
      isSameOriginRequest({ method: "POST", origin: "NULL", host: "api.example.com" }),
    ).toBe(false);
  });

  it("Sec-Fetch-Site: cross-site 拒绝，即使 Origin 与 Host 一致", () => {
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        host: "example.com",
        secFetchSite: "cross-site",
      }),
    ).toBe(false);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        host: "example.com",
        secFetchSite: "Cross-Site",
      }),
    ).toBe(false);
  });

  it("same-origin / same-site 不因该头被拒", () => {
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        host: "example.com",
        secFetchSite: "same-origin",
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        host: "example.com",
        secFetchSite: "same-site",
      }),
    ).toBe(true);
  });

  it("Origin 与 Host 一致放行", () => {
    expect(
      isSameOriginRequest({ method: "POST", origin: "https://example.com", host: "example.com" }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com:8443",
        host: "example.com:8443",
      }),
    ).toBe(true);
  });

  it("Origin 与 Host 不等拒绝", () => {
    expect(
      isSameOriginRequest({ method: "POST", origin: "https://evil.com", host: "example.com" }),
    ).toBe(false);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com:8443",
        host: "example.com",
      }),
    ).toBe(false);
    expect(
      isSameOriginRequest({ method: "POST", origin: "https://example.com", host: "evil.com" }),
    ).toBe(false);
  });

  it("默认端口归一后再比较", () => {
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com:443",
        host: "example.com",
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        host: "example.com:443",
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({ method: "POST", origin: "https://example.com", host: "example.com:80" }),
    ).toBe(false);
  });

  it("host 大小写与末尾点不影响判定", () => {
    expect(
      isSameOriginRequest({ method: "POST", origin: "https://example.com", host: "EXAMPLE.com." }),
    ).toBe(true);
  });

  it("X-Forwarded-Host 优先于 Host（反代场景）", () => {
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        forwardedHost: "example.com",
        host: "internal-abc.local",
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        forwardedHost: "example.com, proxy.internal",
        host: "internal-abc.local",
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        forwardedHost: "evil.com",
        host: "example.com",
      }),
    ).toBe(false);
  });

  it("头都缺失时退回 URL 的 host", () => {
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com",
        url: "https://example.com/api/kb",
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://evil.com",
        url: "https://example.com/api/kb",
      }),
    ).toBe(false);
  });

  it("IPv6 host 带方括号也能比较", () => {
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://[::1]:3000",
        host: "[::1]:3000",
      }),
    ).toBe(true);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://[::1]:3000",
        host: "[::1]:4000",
      }),
    ).toBe(false);
  });

  it("非法 Origin 与非 http(s) Origin 拒绝", () => {
    expect(
      isSameOriginRequest({ method: "POST", origin: "not a url", host: "example.com" }),
    ).toBe(false);
    expect(
      isSameOriginRequest({ method: "POST", origin: "ftp://example.com", host: "example.com" }),
    ).toBe(false);
    expect(
      isSameOriginRequest({
        method: "POST",
        origin: "https://example.com:abc",
        host: "example.com",
      }),
    ).toBe(false);
  });
});

describe("sameOriginFromRequest", () => {
  function build(method: string, headers: Record<string, string>): Request {
    return new Request("https://api.example.com/api/kb", { method, headers });
  }

  it("同源 POST 放行", () => {
    const req = build("POST", { origin: "https://api.example.com", host: "api.example.com" });
    expect(sameOriginFromRequest(req)).toBe(true);
  });

  it("跨站 POST 拒绝", () => {
    const req = build("POST", {
      origin: "https://evil.com",
      host: "api.example.com",
      "sec-fetch-site": "cross-site",
    });
    expect(sameOriginFromRequest(req)).toBe(false);
  });

  it("没带 Origin 的 POST 拒绝", () => {
    const req = build("POST", { host: "api.example.com" });
    expect(sameOriginFromRequest(req)).toBe(false);
  });

  it("GET 无头放行", () => {
    expect(sameOriginFromRequest(build("GET", {}))).toBe(true);
  });

  it("反代场景：X-Forwarded-Host 与 Origin 一致即放行", () => {
    const req = build("POST", {
      origin: "https://learn.example.com",
      host: "internal-abc.local",
      "x-forwarded-host": "learn.example.com",
    });
    expect(sameOriginFromRequest(req)).toBe(true);
  });
});
