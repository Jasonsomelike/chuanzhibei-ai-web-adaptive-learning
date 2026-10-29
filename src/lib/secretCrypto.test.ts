import { createDecipheriv } from "node:crypto";
import { describe, it, expect } from "vitest";

import {
  DEFAULT_KEY_ID,
  maskSecret,
  openSecret,
  resolveSecretKey,
  sealSecret,
  secretHint,
  type SecretEnv,
} from "@/lib/secretCrypto";

/**
 * 加密层的行为测试。
 *
 * 重点不是「能加能解」，而是「换一把钥匙、换一个用户、改一个字节都解不开」，
 * 以及主密钥的格式校验——验收用的密钥生成方式只要换一种写法（base64url、
 * 去掉填充），Node 都能解出同样的 32 字节，但 AAD 与重编码校验必须拒绝它。
 */

const KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64");
const ENV: SecretEnv = { ALP_SECRET_KEY: KEY, ALP_SECRET_KEY_ID: "v1" };
const SCOPE = { userId: "u1", kind: "llm" };
const PLAINTEXT = "sk-1234567890abcdef";

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (err) {
    return (err as { code?: string }).code ?? "NO_CODE";
  }
}

describe("sealSecret / openSecret", () => {
  it("往返一致，iv 12 字节、tag 16 字节、kid 默认 v1", () => {
    const sealed = sealSecret(PLAINTEXT, SCOPE, ENV);

    expect(sealed.kid).toBe("v1");
    expect(Buffer.from(sealed.iv, "base64")).toHaveLength(12);
    expect(Buffer.from(sealed.tag, "base64")).toHaveLength(16);
    expect(openSecret(sealed, SCOPE, ENV)).toBe(PLAINTEXT);
  });

  it("每次加密的 IV 都不同（同一明文两次密文不同）", () => {
    const a = sealSecret(PLAINTEXT, SCOPE, ENV);
    const b = sealSecret(PLAINTEXT, SCOPE, ENV);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("AAD 精确为 user_secrets:<userId>:<kind>", () => {
    const sealed = sealSecret(PLAINTEXT, { userId: "u1", kind: "tts" }, ENV);

    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(KEY, "base64"),
      Buffer.from(sealed.iv, "base64"),
    );
    decipher.setAAD(Buffer.from("user_secrets:u1:tts", "utf8"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const text = Buffer.concat([
      decipher.update(Buffer.from(sealed.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");

    expect(text).toBe(PLAINTEXT);
  });

  it("换用户或换类型都解不开（AAD 绑定）", () => {
    const sealed = sealSecret(PLAINTEXT, SCOPE, ENV);

    expect(codeOf(() => openSecret(sealed, { userId: "u2", kind: "llm" }, ENV))).toBe(
      "SECRET_UNREADABLE",
    );
    expect(codeOf(() => openSecret(sealed, { userId: "u1", kind: "tts" }, ENV))).toBe(
      "SECRET_UNREADABLE",
    );
  });

  it("换一把同版本密钥解不开", () => {
    const sealed = sealSecret(PLAINTEXT, SCOPE, ENV);
    const otherEnv: SecretEnv = { ALP_SECRET_KEY: OTHER_KEY, ALP_SECRET_KEY_ID: "v1" };
    expect(codeOf(() => openSecret(sealed, SCOPE, otherEnv))).toBe("SECRET_UNREADABLE");
  });

  it("密文或 tag 被改动一个字节即失败", () => {
    const sealed = sealSecret(PLAINTEXT, SCOPE, ENV);

    const flip = (value: string) => `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
    expect(codeOf(() => openSecret({ ...sealed, ct: flip(sealed.ct) }, SCOPE, ENV))).toBe(
      "SECRET_UNREADABLE",
    );
    expect(codeOf(() => openSecret({ ...sealed, tag: flip(sealed.tag) }, SCOPE, ENV))).toBe(
      "SECRET_UNREADABLE",
    );
  });

  it("iv 长度不对或不是标准 base64 时报损坏", () => {
    const sealed = sealSecret(PLAINTEXT, SCOPE, ENV);
    expect(codeOf(() => openSecret({ ...sealed, iv: Buffer.alloc(11, 1).toString("base64") }, SCOPE, ENV))).toBe(
      "SECRET_UNREADABLE",
    );
    expect(codeOf(() => openSecret({ ...sealed, ct: "not base64!!" }, SCOPE, ENV))).toBe(
      "SECRET_UNREADABLE",
    );
  });

  it("kid 不一致时报 KEY_KID_UNKNOWN（这是运维问题，不是数据损坏）", () => {
    const sealed = sealSecret(PLAINTEXT, SCOPE, { ...ENV, ALP_SECRET_KEY_ID: "v2" });
    expect(sealed.kid).toBe("v2");
    expect(codeOf(() => openSecret(sealed, SCOPE, ENV))).toBe("KEY_KID_UNKNOWN");
  });

  it("明文短于 8 个字符拒绝加密，正好 8 个字符可以", () => {
    expect(codeOf(() => sealSecret("1234567", SCOPE, ENV))).toBe("SECRET_TOO_SHORT");
    expect(openSecret(sealSecret("12345678", SCOPE, ENV), SCOPE, ENV)).toBe("12345678");
  });

  it("作用域为空时报 INVALID_ARGUMENT", () => {
    expect(codeOf(() => sealSecret(PLAINTEXT, { userId: "", kind: "llm" }, ENV))).toBe(
      "INVALID_ARGUMENT",
    );
    expect(codeOf(() => sealSecret(PLAINTEXT, { userId: "u1", kind: " " }, ENV))).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("主密钥校验", () => {
  it("缺失时 KEY_ENC_UNAVAILABLE", () => {
    expect(codeOf(() => sealSecret(PLAINTEXT, SCOPE, {}))).toBe("KEY_ENC_UNAVAILABLE");
    expect(codeOf(() => openSecret(sealSecret(PLAINTEXT, SCOPE, ENV), SCOPE, {}))).toBe(
      "KEY_ENC_UNAVAILABLE",
    );
  });

  it("长度不是 32 字节时拒绝", () => {
    const short = Buffer.alloc(31, 1).toString("base64");
    expect(codeOf(() => resolveSecretKey({ ALP_SECRET_KEY: short }))).toBe("KEY_ENC_UNAVAILABLE");
  });

  it("去掉填充（Node 仍能解出 32 字节）也拒绝", () => {
    const unpadded = KEY.replace(/=+$/, "");
    expect(Buffer.from(unpadded, "base64")).toHaveLength(32);
    expect(codeOf(() => resolveSecretKey({ ALP_SECRET_KEY: unpadded }))).toBe(
      "KEY_ENC_UNAVAILABLE",
    );
  });

  it("base64url 写法拒绝", () => {
    // 0xFF 填充的 base64 含 `/`，换成 `_` 后 Node 仍解出同样的 32 字节
    const dotted = Buffer.alloc(32, 0xff).toString("base64");
    const urlSafe = dotted.replace(/\+/g, "-").replace(/\//g, "_");
    expect(urlSafe).not.toBe(dotted);
    expect(Buffer.from(urlSafe, "base64")).toHaveLength(32);
    expect(codeOf(() => resolveSecretKey({ ALP_SECRET_KEY: urlSafe }))).toBe("KEY_ENC_UNAVAILABLE");
  });

  it("默认 kid 是 v1，可被 ALP_SECRET_KEY_ID 覆盖", () => {
    expect(resolveSecretKey({ ALP_SECRET_KEY: KEY }).kid).toBe(DEFAULT_KEY_ID);
    expect(resolveSecretKey({ ALP_SECRET_KEY: KEY, ALP_SECRET_KEY_ID: "v9" }).kid).toBe("v9");
  });
});

describe("maskSecret / secretHint", () => {
  it("长度 ≤ 8 的密钥只回四个圆点", () => {
    expect(maskSecret("12345678")).toBe("••••");
    expect(maskSecret("short")).toBe("••••");
    expect(maskSecret("")).toBe("••••");
    expect(secretHint("12345678")).toBe("••••");
  });

  it("更长的密钥只露首尾各 4 位", () => {
    expect(maskSecret("sk-1234567890abcdef")).toBe("sk-1••••cdef");
    expect(maskSecret("sk-1234567890abcdef")).not.toContain("1234567890");
  });

  it("hint 只露末 4 位", () => {
    expect(secretHint("sk-1234567890abcdef")).toBe("••••cdef");
    expect(secretHint("sk-1234567890abcdef")).not.toContain("sk-1");
  });
});
