import { describe, it, expect } from "vitest";
import {
  MAX_URL_LENGTH,
  checkUrlShape,
  classifyAddress,
  isBlockedAddress,
  type AddressScope,
  type UrlShapeOptions,
  type UrlShapeRejection,
} from "@/lib/ssrf";

/** 调研清单里需要封禁的地址段，每段取一个代表。 */
const BLOCKED_SAMPLES: ReadonlyArray<readonly [string, AddressScope]> = [
  ["0.0.0.0", "reserved"], // 0.0.0.0/8
  ["10.0.0.1", "private"], // 10.0.0.0/8
  ["100.64.0.1", "shared"], // 100.64.0.0/10
  ["127.0.0.1", "loopback"], // 127.0.0.0/8
  ["169.254.169.254", "link-local"], // 169.254.0.0/16 云元数据
  ["172.16.0.1", "private"], // 172.16.0.0/12
  ["192.0.0.1", "reserved"], // 192.0.0.0/24
  ["192.0.2.1", "documentation"], // 192.0.2.0/24 TEST-NET-1
  ["192.168.1.1", "private"], // 192.168.0.0/16
  ["198.18.0.1", "benchmark"], // 198.18.0.0/15
  ["198.51.100.1", "documentation"], // 198.51.100.0/24 TEST-NET-2
  ["203.0.113.1", "documentation"], // 203.0.113.0/24 TEST-NET-3
  ["224.0.0.1", "multicast"], // 224.0.0.0/4
  ["240.0.0.1", "reserved"], // 240.0.0.0/4
  ["::", "unspecified"], // ::/128
  ["::1", "loopback"], // ::1/128
  ["fc00::1", "unique-local"], // fc00::/7
  ["fe80::1", "link-local"], // fe80::/10
  ["ff02::1", "multicast"], // ff00::/8
];

describe("isBlockedAddress：调研清单的保留地址段", () => {
  for (const [address, scope] of BLOCKED_SAMPLES) {
    it(`${address} 封禁（${scope}）`, () => {
      const result = classifyAddress(address);
      expect(result).not.toBeNull();
      expect(result?.scope).toBe(scope);
      expect(result?.blocked).toBe(true);
      expect(isBlockedAddress(address)).toBe(true);
    });
  }

  it("IPv4/IPv6 家族标记正确", () => {
    expect(classifyAddress("10.0.0.1")?.family).toBe("ipv4");
    expect(classifyAddress("fe80::1")?.family).toBe("ipv6");
  });
});

describe("isBlockedAddress：公网地址放行", () => {
  const PUBLIC = [
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1",
    "100.128.0.1",
    "198.20.0.1",
    "192.0.1.1",
    "223.255.255.254",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ];

  for (const address of PUBLIC) {
    it(`${address} 放行`, () => {
      expect(classifyAddress(address)?.blocked).toBe(false);
      expect(isBlockedAddress(address)).toBe(false);
    });
  }
});

describe("isBlockedAddress：区间边界", () => {
  const CASES: ReadonlyArray<readonly [string, boolean]> = [
    ["9.255.255.255", false],
    ["10.0.0.0", true],
    ["10.255.255.255", true],
    ["11.0.0.0", false],
    ["100.63.255.255", false],
    ["100.64.0.0", true],
    ["100.127.255.255", true],
    ["100.128.0.0", false],
    ["126.255.255.255", false],
    ["127.0.0.0", true],
    ["127.255.255.255", true],
    ["128.0.0.0", false],
    ["169.253.255.255", false],
    ["169.254.0.0", true],
    ["169.254.255.255", true],
    ["169.255.0.0", false],
    ["172.15.255.255", false],
    ["172.16.0.0", true],
    ["172.31.255.255", true],
    ["172.32.0.0", false],
    ["192.0.0.255", true],
    ["192.0.1.0", false],
    ["192.0.2.255", true],
    ["192.0.3.0", false],
    ["192.167.255.255", false],
    ["192.168.0.0", true],
    ["192.168.255.255", true],
    ["192.169.0.0", false],
    ["198.17.255.255", false],
    ["198.18.0.0", true],
    ["198.19.255.255", true],
    ["198.20.0.0", false],
    ["198.51.99.255", false],
    ["198.51.100.0", true],
    ["198.51.101.0", false],
    ["203.0.113.0", true],
    ["203.0.114.0", false],
    ["223.255.255.255", false],
    ["224.0.0.0", true],
    ["239.255.255.255", true],
    ["240.0.0.0", true],
    ["255.255.255.255", true],
    ["0.255.255.255", true],
    ["1.0.0.0", false],
    ["fb00::1", false],
    ["fc00::1", true],
    ["fdff::1", true],
    ["fe00::1", false],
    ["fe80::1", true],
    ["febf::1", true],
    ["ff00::1", true],
    ["feff::1", false],
    ["2001:db8::1", false],
  ];

  for (const [address, blocked] of CASES) {
    it(`${address} → ${blocked ? "封禁" : "放行"}`, () => {
      expect(isBlockedAddress(address)).toBe(blocked);
    });
  }
});

describe("isBlockedAddress：非规范 IPv4 写法不能绕过", () => {
  const CASES = [
    "127.1", // 两段简写
    "2130706433", // 单段十进制
    "0x7f000001", // 单段十六进制
    "0177.0.0.1", // 八进制
    "0x7f.1",
    "10.1",
    "127.0.0.1.", // 末尾点
  ];

  for (const address of CASES) {
    it(`${address} 仍判为内网`, () => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  }
});

describe("IPv4 内嵌形式先拆内层", () => {
  it("::ffff:127.0.0.1 拆出 127.0.0.1", () => {
    const result = classifyAddress("::ffff:127.0.0.1");
    expect(result?.family).toBe("ipv6");
    expect(result?.embedded).toBe("127.0.0.1");
    expect(result?.blocked).toBe(true);
  });

  it("::ffff:7f00:1 十六进制写法同样拆出 127.0.0.1", () => {
    expect(classifyAddress("::ffff:7f00:1")?.embedded).toBe("127.0.0.1");
    expect(isBlockedAddress("::ffff:7f00:1")).toBe(true);
  });

  it("方括号形式也能判定", () => {
    expect(isBlockedAddress("[::ffff:127.0.0.1]")).toBe(true);
    expect(isBlockedAddress("[::1]")).toBe(true);
  });

  it("64:ff9b::7f00:1 是 NAT64 里包着的 127.0.0.1", () => {
    const result = classifyAddress("64:ff9b::7f00:1");
    expect(result?.embedded).toBe("127.0.0.1");
    expect(result?.blocked).toBe(true);
  });

  it("::ffff:0:0 内层是 0.0.0.0", () => {
    expect(classifyAddress("::ffff:0:0")?.embedded).toBe("0.0.0.0");
    expect(isBlockedAddress("::ffff:0:0")).toBe(true);
  });

  it("::2 属于已废弃的 IPv4-compatible 段，按保留处理", () => {
    expect(isBlockedAddress("::2")).toBe(true);
  });
});

describe("classifyAddress：非法字面量返回 null", () => {
  const INVALID = [
    "",
    "example.com",
    "256.1.1.1",
    "1.2.3.4.5",
    "1.1.1.256",
    "fe80::gg",
    "12345::1",
    "1:2:3:4:5:6:7:8:9",
    "1::2::3",
  ];

  for (const address of INVALID) {
    it(JSON.stringify(address), () => {
      expect(classifyAddress(address)).toBeNull();
      expect(isBlockedAddress(address)).toBe(false);
    });
  }
});

function expectReject(
  raw: string,
  reason: UrlShapeRejection,
  options?: UrlShapeOptions,
): void {
  const result = checkUrlShape(raw, options);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.reason).toBe(reason);
}

describe("checkUrlShape", () => {
  it("https 普通 URL 通过并返回解析结果", () => {
    const result = checkUrlShape("https://example.com/path?q=1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.url.hostname).toBe("example.com");
  });

  it("http 默认拒绝", () => {
    expectReject("http://example.com/", "scheme");
  });

  it("http 白名单按 host:port 精确放行", () => {
    expect(checkUrlShape("http://localhost:3000/api", {
      allowHttpHosts: ["localhost:3000"],
    }).ok).toBe(true);
    expect(checkUrlShape("http://example.com/", {
      allowHttpHosts: ["example.com:80"],
    }).ok).toBe(true);
  });

  it("白名单大小写不敏感，且不带端口按 80 补齐", () => {
    expect(checkUrlShape("http://LOCALHOST:3000/api", {
      allowHttpHosts: ["LocalHost:3000"],
    }).ok).toBe(true);
    expect(checkUrlShape("http://example.com/", {
      allowHttpHosts: ["EXAMPLE.com"],
    }).ok).toBe(true);
  });

  it("白名单端口不匹配仍拒绝", () => {
    expectReject("http://localhost:3001/", "scheme", {
      allowHttpHosts: ["localhost:3000"],
    });
    expectReject("http://evil.com/", "scheme", {
      allowHttpHosts: ["localhost:3000"],
    });
  });

  it("拒绝 userinfo", () => {
    expectReject("https://user:pass@example.com/", "userinfo");
    expectReject("https://user@example.com/", "userinfo");
  });

  it("https 非 443 端口拒绝，443 放行", () => {
    expectReject("https://example.com:8443/", "port");
    expect(checkUrlShape("https://example.com:443/").ok).toBe(true);
  });

  it("超长 URL 拒绝", () => {
    expectReject(`https://example.com/${"a".repeat(MAX_URL_LENGTH)}`, "too-long");
  });

  it("恰好等于上限的 URL 仍放行", () => {
    const prefix = "https://example.com/";
    const raw = prefix + "a".repeat(MAX_URL_LENGTH - prefix.length);
    expect(raw).toHaveLength(MAX_URL_LENGTH);
    expect(checkUrlShape(raw).ok).toBe(true);
  });

  it("拒绝云元数据主机名（含末尾点写法）", () => {
    expectReject("https://metadata.google.internal/computeMetadata/v1/", "metadata-host");
    expectReject("https://metadata.google.internal./computeMetadata/v1/", "metadata-host");
    expectReject("https://metadata.amazonaws.com/latest/meta-data/", "metadata-host");
  });

  it("拒绝字面量内网地址与各种简写", () => {
    expectReject("https://169.254.169.254/latest/meta-data/", "blocked-address");
    expectReject("https://127.0.0.1/", "blocked-address");
    expectReject("https://127.1/", "blocked-address");
    expectReject("https://2130706433/", "blocked-address");
    expectReject("https://[::1]/", "blocked-address");
    expectReject("https://[::ffff:7f00:1]/", "blocked-address");
    expectReject("https://[64:ff9b::7f00:1]/", "blocked-address");
  });

  it("非 http(s) 协议与无法解析的字符串拒绝", () => {
    expectReject("ftp://example.com/x", "scheme");
    expectReject("javascript:alert(1)", "scheme");
    expectReject("not a url", "invalid-url");
  });
});
