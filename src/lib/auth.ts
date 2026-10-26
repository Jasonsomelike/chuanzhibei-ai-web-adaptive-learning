/**
 * 认证：邮箱 + 密码，服务端会话。
 *
 * 密码用 PBKDF2-HMAC-SHA256 加盐哈希（Web Crypto，无原生依赖）。
 * 选 PBKDF2 而不是 bcrypt/argon2 的原因：后两者需要原生模块或 wasm，
 * 在 Vercel 的 Node runtime 里增加构建与冷启动成本；
 * PBKDF2 是 NIST SP 800-132 认可的方案，迭代 60 万次足以抵抗离线爆破。
 *
 * 会话用随机 token 存数据库，HttpOnly Cookie 承载。
 * 不引第三方认证库：本项目的认证需求只有「注册/登录/登出/取当前用户」四件事。
 */

import { cookies } from "next/headers";
import { getDb } from "@/lib/db";

const SESSION_COOKIE = "alp_session";
/** 会话有效期：14 天。 */
const SESSION_DAYS = 14;
/** PBKDF2 迭代次数。OWASP 2023 建议 SHA-256 至少 60 万次。 */
const PBKDF2_ITERATIONS = 600_000;

export interface PublicUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
}

// ── 密码哈希 ───────────────────────────────────────────────────────

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** 生成 `pbkdf2$迭代次数$盐$哈希` 格式的字符串，参数内嵌便于将来升级。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt.buffer)}$${toHex(bits)}`;
}

/**
 * 校验密码。
 *
 * 用常量时间比较避免时序攻击：先算哈希再逐字节 XOR 累积差异，
 * 不在第一个不同字节处提前返回。
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;

  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const salt = fromHex(parts[2]);
  const expected = parts[3];

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  const actual = toHex(bits);

  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

// ── 输入校验 ───────────────────────────────────────────────────────

export interface ValidationError {
  readonly field: "email" | "password" | "displayName";
  readonly message: string;
}

/** 邮箱格式：不追求 RFC 5322 全覆盖，只挡住明显非法的输入。 */
export function validateEmail(email: string): ValidationError | null {
  const v = email.trim();
  if (v.length === 0) return { field: "email", message: "邮箱不能为空" };
  if (v.length > 254) return { field: "email", message: "邮箱过长" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
    return { field: "email", message: "邮箱格式不正确" };
  }
  return null;
}

export function validatePassword(password: string): ValidationError | null {
  if (password.length < 8) return { field: "password", message: "密码至少 8 位" };
  if (password.length > 200) return { field: "password", message: "密码过长" };
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { field: "password", message: "密码需同时包含字母和数字" };
  }
  return null;
}

export function validateDisplayName(name: string): ValidationError | null {
  const v = name.trim();
  if (v.length === 0) return { field: "displayName", message: "昵称不能为空" };
  if (v.length > 30) return { field: "displayName", message: "昵称最多 30 个字符" };
  return null;
}

// ── 用户与会话 ─────────────────────────────────────────────────────

function newId(): string {
  return crypto.randomUUID();
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export type AuthResult =
  | { ok: true; user: PublicUser; token: string }
  | { ok: false; error: string; field?: ValidationError["field"] };

/** 注册。邮箱唯一，重复时返回可读错误而不是抛异常。 */
export async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult> {
  for (const err of [
    validateEmail(email),
    validatePassword(password),
    validateDisplayName(displayName),
  ]) {
    if (err) return { ok: false, error: err.message, field: err.field };
  }

  const db = await getDb();
  const normalized = email.trim().toLowerCase();

  const existing = await db.one<UserRow>("SELECT * FROM users WHERE email = $1", [normalized]);
  if (existing) {
    return { ok: false, error: "该邮箱已注册，请直接登录", field: "email" };
  }

  const id = newId();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  await db.run(
    "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)",
    [id, normalized, passwordHash, displayName.trim(), now],
  );

  const token = await createSession(id);
  return {
    ok: true,
    token,
    user: { id, email: normalized, displayName: displayName.trim(), createdAt: now },
  };
}

/** 登录。邮箱不存在与密码错误返回同一句话，避免暴露账号是否注册。 */
export async function login(email: string, password: string): Promise<AuthResult> {
  const db = await getDb();
  const normalized = email.trim().toLowerCase();

  const row = await db.one<UserRow>("SELECT * FROM users WHERE email = $1", [normalized]);
  const genericError = { ok: false as const, error: "邮箱或密码不正确" };

  if (!row) {
    // 即使账号不存在也跑一次哈希，让耗时与真实校验接近，避免时序侧信道
    await verifyPassword(password, "pbkdf2$600000$00000000000000000000000000000000$" + "0".repeat(64));
    return genericError;
  }

  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return genericError;

  const token = await createSession(row.id);
  return { ok: true, token, user: toPublicUser(row) };
}

async function createSession(userId: string): Promise<string> {
  const db = await getDb();
  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db.run(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    [token, userId, expires.toISOString(), now.toISOString()],
  );

  // 顺手清理过期会话，避免表无限增长
  await db.run("DELETE FROM sessions WHERE expires_at < $1", [now.toISOString()]);

  return token;
}

/** 从 Cookie 取当前用户。未登录或会话过期返回 null。 */
export async function getCurrentUser(): Promise<PublicUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  /*
   * 必须 JOIN users 才能拿到 email 与 display_name——
   * sessions 表本身只有 token/user_id/expires_at。
   * 用 SELECT * 而不 JOIN 会返回 undefined 字段，界面就会显示空昵称。
   */
  const row = await db.one<{
    user_id: string;
    expires_at: string;
    email: string;
    display_name: string;
    created_at: string;
  }>(
    `SELECT s.user_id, s.expires_at, u.email, u.display_name, u.created_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token],
  );

  if (!row) return null;

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.run("DELETE FROM sessions WHERE token = $1", [token]);
    return null;
  }

  return {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at ?? "",
  };
}

/** 设置会话 Cookie。 */
export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    /*
     * Secure 只在真正走 HTTPS 时开启。
     *
     * 不能只看 NODE_ENV：本地 `next start` 跑的也是 production 构建，
     * 但服务在 http://127.0.0.1 上，带 Secure 的 Cookie 浏览器不会回传，
     * 表现为「注册成功但立刻变未登录」。
     * Vercel 线上 VERCEL_ENV=production 且是 https，此时才加 Secure。
     */
    secure:
      process.env.VERCEL_ENV === "production" || process.env.FORCE_SECURE_COOKIE === "1",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** 登出：删库里的会话 + 清 Cookie。 */
export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.run("DELETE FROM sessions WHERE token = $1", [token]);
  }
  jar.delete(SESSION_COOKIE);
}

/** 要求已登录，否则抛错。API 路由里用。 */
export async function requireUser(): Promise<PublicUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}
