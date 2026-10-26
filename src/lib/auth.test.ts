import { describe, it, expect } from "vitest";
import {
  validateEmail,
  validatePassword,
  validateDisplayName,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

describe("邮箱校验", () => {
  it("接受常见合法邮箱", () => {
    for (const e of ["a@b.co", "user.name+tag@example.com", "x@sub.domain.org"]) {
      expect(validateEmail(e)).toBeNull();
    }
  });

  it("拒绝空、无 @、无域名、含空格的输入", () => {
    for (const e of ["", "abc", "a@", "@b.com", "a b@c.com", "a@b"]) {
      expect(validateEmail(e)).not.toBeNull();
    }
  });

  it("拒绝超长邮箱", () => {
    expect(validateEmail(`${"a".repeat(250)}@b.com`)).not.toBeNull();
  });
});

describe("密码校验", () => {
  it("接受 8 位以上且含字母与数字的密码", () => {
    expect(validatePassword("abcd1234")).toBeNull();
    expect(validatePassword("A1b2c3d4e5")).toBeNull();
  });

  it("拒绝过短", () => {
    expect(validatePassword("a1b2c3")).not.toBeNull();
  });

  it("拒绝纯字母或纯数字", () => {
    expect(validatePassword("abcdefgh")).not.toBeNull();
    expect(validatePassword("12345678")).not.toBeNull();
  });

  it("拒绝超长（防 DoS：PBKDF2 对超长输入耗时线性增长）", () => {
    expect(validatePassword("a1".repeat(200))).not.toBeNull();
  });
});

describe("昵称校验", () => {
  it("接受 1–30 字符", () => {
    expect(validateDisplayName("小李")).toBeNull();
    expect(validateDisplayName("a".repeat(30))).toBeNull();
  });

  it("拒绝空与超长", () => {
    expect(validateDisplayName("")).not.toBeNull();
    expect(validateDisplayName("   ")).not.toBeNull();
    expect(validateDisplayName("a".repeat(31))).not.toBeNull();
  });
});

describe("密码哈希", () => {
  it("同一密码两次哈希结果不同（每次新盐）", async () => {
    const a = await hashPassword("abcd1234");
    const b = await hashPassword("abcd1234");
    expect(a).not.toBe(b);
    // 但两者都能校验通过
    expect(await verifyPassword("abcd1234", a)).toBe(true);
    expect(await verifyPassword("abcd1234", b)).toBe(true);
  });

  it("哈希串包含算法、迭代次数、盐与摘要四段", async () => {
    const h = await hashPassword("abcd1234");
    const parts = h.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    expect(Number(parts[1])).toBeGreaterThan(100_000);
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/); // 16 字节盐
    expect(parts[3]).toMatch(/^[0-9a-f]{64}$/); // 32 字节摘要
  });

  it("错误密码校验失败", async () => {
    const h = await hashPassword("abcd1234");
    expect(await verifyPassword("abcd12345", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });

  it("篡改的哈希串不会通过", async () => {
    const h = await hashPassword("abcd1234");
    const parts = h.split("$");
    parts[3] = "0".repeat(64);
    expect(await verifyPassword("abcd1234", parts.join("$"))).toBe(false);
  });

  it("格式不对的哈希串返回 false 而不是抛错", async () => {
    for (const bad of ["", "notahash", "pbkdf2$abc$x$y", "md5$1$a$b"]) {
      expect(await verifyPassword("abcd1234", bad)).toBe(false);
    }
  });
});
