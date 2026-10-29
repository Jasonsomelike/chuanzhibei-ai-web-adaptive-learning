/**
 * 服务端密钥加密（AES-256-GCM）。
 *
 * 边界：
 * - 只做「字符串进、字符串出」，不碰数据库、不碰 HTTP；密文由 userSecrets.ts 写库。
 * - 主密钥只从环境变量读：32 字节随机数的**标准 base64**。没有可用密钥时抛错，
 *   调用方必须把它当成「拒绝保存」，绝不能退化为明文落库。
 * - AAD 绑定 `${userId}:${kind}`：把一行的密文贴到另一行或另一个用户上，
 *   解密会失败（SECRET_UNREADABLE），而不是悄悄读出别人的密钥。
 *
 * 密钥生成（不要用口令当密钥）：
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** 加密算法。GCM 自带完整性校验，不需要额外 HMAC。 */
const ALGORITHM = "aes-256-gcm";
/** GCM 推荐的 IV 长度；96 bit 是唯一不需要再派生的一次性随机数长度。 */
const IV_BYTES = 12;
/** GCM 认证标签固定 16 字节。 */
const TAG_BYTES = 16;
/** 密钥长度：AES-256。 */
const KEY_BYTES = 32;
/** 明文下限：更短的字符串通常是占位符或误粘，不是真密钥。 */
export const SECRET_MIN_CHARS = 8;
/** 默认密钥版本号。 */
export const DEFAULT_KEY_ID = "v1";
/** 掩码固定用四个圆点，长度不随密钥变化，避免从掩码长度反推原文长度。 */
const BULLETS = "••••";

const envError =
  "未配置 ALP_SECRET_KEY。生成 32 字节随机密钥：node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"";

export type SecretCryptoErrorCode =
  | "KEY_ENC_UNAVAILABLE"
  | "KEY_KID_UNKNOWN"
  | "SECRET_UNREADABLE"
  | "SECRET_TOO_SHORT"
  | "INVALID_ARGUMENT";

export class SecretCryptoError extends Error {
  readonly code: SecretCryptoErrorCode;

  constructor(code: SecretCryptoErrorCode, message: string) {
    super(message);
    this.name = "SecretCryptoError";
    this.code = code;
  }
}

/** 密钥作用域：同一份明文在不同用户 / 不同类型下密文不可互换。 */
export interface SecretScope {
  readonly userId: string;
  readonly kind: string;
}

export interface SealedSecret {
  /** 密文（base64，不含 tag）。 */
  readonly ct: string;
  /** 12 字节随机 IV（base64）。 */
  readonly iv: string;
  /** 16 字节 GCM tag（base64）。 */
  readonly tag: string;
  /** 加密时的密钥版本。 */
  readonly kid: string;
}

/** 依赖注入点：测试传对象，生产默认 process.env。 */
export type SecretEnv = Record<string, string | undefined>;

export interface ResolvedSecretKey {
  readonly key: Buffer;
  readonly kid: string;
}

/**
 * 读取并校验主密钥。
 *
 * 「严格 base64」必须同时满足：解码后正好 32 字节，且重新编码与输入逐字符相同。
 * 第二条挡住 base64url、去掉填充、夹杂空白等「Node 能解但含义已变」的写法——
 * 这类密钥一旦被接受，部署时换个工具生成就会解不开旧密文。
 */
export function resolveSecretKey(env: SecretEnv = process.env): ResolvedSecretKey {
  const value = (env.ALP_SECRET_KEY ?? "").trim();
  if (value === "") {
    throw new SecretCryptoError("KEY_ENC_UNAVAILABLE", envError);
  }

  const key = Buffer.from(value, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== value) {
    throw new SecretCryptoError(
      "KEY_ENC_UNAVAILABLE",
      `ALP_SECRET_KEY 必须是 32 字节随机数的标准 base64（44 字符，含 = 填充）；当前值长度或编码不合法。${envError}`,
    );
  }

  const kid = (env.ALP_SECRET_KEY_ID ?? "").trim();
  return { key, kid: kid === "" ? DEFAULT_KEY_ID : kid };
}

/** 当前密钥版本号；没有密钥也能读（用于「空负载」行记录 kid）。 */
export function currentSecretKeyId(env: SecretEnv = process.env): string {
  const kid = (env.ALP_SECRET_KEY_ID ?? "").trim();
  return kid === "" ? DEFAULT_KEY_ID : kid;
}

function aadOf(scope: SecretScope): Buffer {
  if (scope.userId.trim() === "" || scope.kind.trim() === "") {
    throw new SecretCryptoError(
      "INVALID_ARGUMENT",
      "加密作用域需要非空的 userId 与 kind，否则 AAD 无法区分不同用户。",
    );
  }
  return Buffer.from(`user_secrets:${scope.userId}:${scope.kind}`, "utf8");
}

/**
 * 加密一段明文。
 *
 * 明文短于 8 个字符直接拒绝：这里挡住的是「把占位符 or 半截 key 存成正式配置」，
 * 不是长度洁癖——短密钥只可能来自误操作。
 */
export function sealSecret(
  plaintext: string,
  scope: SecretScope,
  env: SecretEnv = process.env,
): SealedSecret {
  if (typeof plaintext !== "string" || Array.from(plaintext).length < SECRET_MIN_CHARS) {
    throw new SecretCryptoError(
      "SECRET_TOO_SHORT",
      `密钥至少 ${SECRET_MIN_CHARS} 个字符；当前值过短，未保存任何内容。`,
    );
  }

  const { key, kid } = resolveSecretKey(env);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aadOf(scope));

  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ct: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    kid,
  };
}

/**
 * 解密。任何「解不开」的原因都折成 SECRET_UNREADABLE（不区分 tag 错、AAD 错、
 * 密文被改），因为把区别告诉调用方只会泄露「猜对了哪个字段」。
 * 版本号对不上单独用 KEY_KID_UNKNOWN：那是运维问题，需要换回旧密钥，不是数据坏了。
 */
export function openSecret(
  sealed: SealedSecret,
  scope: SecretScope,
  env: SecretEnv = process.env,
): string {
  const { key, kid } = resolveSecretKey(env);
  if (sealed.kid !== kid) {
    throw new SecretCryptoError(
      "KEY_KID_UNKNOWN",
      `密文的密钥版本是 ${sealed.kid}，当前 ALP_SECRET_KEY_ID 是 ${kid}。请换回旧密钥，或让用户重新保存该配置。`,
    );
  }

  const iv = decodeBase64(sealed.iv, "iv", IV_BYTES);
  const tag = decodeBase64(sealed.tag, "tag", TAG_BYTES);
  const ct = decodeBase64(sealed.ct, "ct");

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(aadOf(scope));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof SecretCryptoError) throw err;
    throw new SecretCryptoError(
      "SECRET_UNREADABLE",
      "密文无法解密：密钥不匹配、密文被改动，或不属于该用户 / 该类型。请在设置页重新保存。",
    );
  }
}

function decodeBase64(value: string, label: string, expectedLength?: number): Buffer {
  const text = (value ?? "").trim();
  const bytes = Buffer.from(text, "base64");
  if (text === "" || bytes.length === 0 || bytes.toString("base64") !== text) {
    throw new SecretCryptoError("SECRET_UNREADABLE", `密文的 ${label} 不是合法的标准 base64，疑似损坏。`);
  }
  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new SecretCryptoError(
      "SECRET_UNREADABLE",
      `密文的 ${label} 长度应为 ${expectedLength} 字节，实际 ${bytes.length} 字节，疑似损坏。`,
    );
  }
  return bytes;
}

/**
 * 给界面看的掩码。
 *
 * 长度 ≤ 8 的密钥只回四个圆点：短 key 露头露尾就等于整把公开。
 */
export function maskSecret(secret: string): string {
  const chars = Array.from(secret ?? "");
  if (chars.length <= SECRET_MIN_CHARS) return BULLETS;
  return `${chars.slice(0, 4).join("")}${BULLETS}${chars.slice(-4).join("")}`;
}

/**
 * 落库的 hint：只露末 4 位，连前缀都不给。
 * 与 maskSecret 分开是因为 hint 会长期留在数据库与公开响应里。
 */
export function secretHint(secret: string): string {
  const chars = Array.from(secret ?? "");
  if (chars.length <= SECRET_MIN_CHARS) return BULLETS;
  return `${BULLETS}${chars.slice(-4).join("")}`;
}
