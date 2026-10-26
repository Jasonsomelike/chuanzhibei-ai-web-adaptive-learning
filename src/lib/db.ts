/**
 * 数据库访问层。
 *
 * 线上用 Neon Postgres（Vercel 的 serverless 驱动，走 HTTP，无需连接池管理）。
 * 本地开发没有 DATABASE_URL 时，退化为**进程内内存存储**，便于跑测试与离线开发。
 *
 * 为什么本地不直接连同一个 Neon：每次开发都读写线上库既慢又危险，
 * 而 SQLite 需要原生模块、在 serverless 里不可用。内存实现让本地零依赖，
 * 代价是重启即丢失——这对开发与测试是可接受的。
 *
 * 表结构见 migrations/001_init.sql。启动时自动执行建表语句（幂等）。
 */

import { neon } from "@neondatabase/serverless";

/** 一个可执行查询的最小接口，让内存实现与 Postgres 实现共用上层代码。 */
export interface Db {
  /** 执行写操作，返回受影响行数（或 0）。 */
  run(sql: string, params?: unknown[]): Promise<number>;
  /** 查询多行。 */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 查询单行，没有则返回 null。 */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
}

// ── Postgres 实现 ──────────────────────────────────────────────────

function createPostgresDb(url: string): Db {
  const sql = neon(url);

  return {
    async run(text, params = []) {
      // neon 的模板标签接口不接受动态 SQL，这里用 query 方法
      const rows = (await sql.query(text, params)) as unknown[];
      // INSERT/UPDATE 无 RETURNING 时返回空数组
      return Array.isArray(rows) ? rows.length : 0;
    },
    async all<T>(text: string, params: unknown[] = []) {
      const rows = (await sql.query(text, params)) as T[];
      return Array.isArray(rows) ? rows : [];
    },
    async one<T>(text: string, params: unknown[] = []) {
      const rows = (await sql.query(text, params)) as T[];
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },
  };
}

// ── 内存实现（本地开发 / 测试） ────────────────────────────────────

/**
 * 内存实现只支持本项目实际用到的查询模式，不是通用 SQL 引擎。
 *
 * 它把每条 SQL 归一化后匹配到具体的处理函数。这样做的代价是：
 * 新增查询必须同时在两处实现。收益是本地开发零依赖、测试无需外部服务。
 *
 * 之所以不用 sql.js 之类的内存 SQL 引擎：那要额外 ~1.5MB wasm，
 * 而我们只用到十几条固定查询，手写映射更轻也更可控。
 */
function createMemoryDb(): Db {
  const users = new Map<string, Record<string, unknown>>();
  const sessions = new Map<string, Record<string, unknown>>();
  const progress = new Map<string, Record<string, unknown>>();
  const directions = new Map<string, Record<string, unknown>>();

  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  return {
    async run(text, params = []) {
      const q = norm(text);

      if (q.startsWith("insert into users")) {
        const [id, email, password_hash, display_name, created_at] = params as string[];
        if ([...users.values()].some((u) => u.email === email)) {
          throw new Error("duplicate email");
        }
        users.set(id, { id, email, password_hash, display_name, created_at });
        return 1;
      }

      if (q.startsWith("insert into sessions")) {
        const [token, user_id, expires_at, created_at] = params as string[];
        sessions.set(token, { token, user_id, expires_at, created_at });
        return 1;
      }

      if (q.startsWith("delete from sessions")) {
        if (q.includes("where token =")) {
          sessions.delete(params[0] as string);
        } else if (q.includes("expires_at <")) {
          const now = params[0] as string;
          for (const [k, v] of sessions) {
            if ((v.expires_at as string) < now) sessions.delete(k);
          }
        }
        return 1;
      }

      if (q.startsWith("insert into progress")) {
        const [user_id, subject_id, data, updated_at] = params as string[];
        progress.set(`${user_id}:${subject_id}`, { user_id, subject_id, data, updated_at });
        return 1;
      }

      if (q.startsWith("delete from progress")) {
        progress.delete(`${params[0]}:${params[1]}`);
        return 1;
      }

      if (q.startsWith("insert into directions")) {
        const [id, user_id, title, subject_id, description, graph_json, is_public, created_at, updated_at] =
          params as string[];
        directions.set(id, {
          id,
          user_id,
          title,
          subject_id,
          description,
          graph_json,
          is_public,
          created_at,
          updated_at,
        });
        return 1;
      }

      if (q.startsWith("update directions set")) {
        // SET 子句里字段顺序固定：title, description, graph_json, is_public, updated_at
        const [title, description, graph_json, is_public, updated_at, id, user_id] =
          params as string[];
        const existing = directions.get(id);
        if (!existing || existing.user_id !== user_id) return 0;
        directions.set(id, { ...existing, title, description, graph_json, is_public, updated_at });
        return 1;
      }

      if (q.startsWith("delete from directions")) {
        const [id, user_id] = params as string[];
        const existing = directions.get(id);
        if (!existing || existing.user_id !== user_id) return 0;
        directions.delete(id);
        return 1;
      }

      if (q.startsWith("insert into direction_picks")) {
        return 1;
      }

      return 0;
    },

    async all<T>(text: string, params: unknown[] = []) {
      const q = norm(text);

      if (q.includes("from directions") && q.includes("is_public = true")) {
        let rows = [...directions.values()].filter((d) => d.is_public === true);

        // 可选的搜索条件
        if (q.includes("title ilike") || q.includes("title like")) {
          const term = String(params[0] ?? "").replace(/%/g, "").toLowerCase();
          rows = rows.filter(
            (d) =>
              String(d.title).toLowerCase().includes(term) ||
              String(d.description).toLowerCase().includes(term),
          );
        }
        if (q.includes("subject_id =")) {
          const sid = params[params.length - 1] as string;
          rows = rows.filter((d) => d.subject_id === sid);
        }

        rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        const limit = 100;
        return rows.slice(0, limit) as T[];
      }

      if (q.includes("from directions") && q.includes("user_id =")) {
        const uid = params[0] as string;
        const rows = [...directions.values()]
          .filter((d) => d.user_id === uid)
          .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
        return rows as T[];
      }

      return [];
    },

    async one<T>(text: string, params: unknown[] = []) {
      const q = norm(text);

      if (q.includes("from users") && q.includes("email =")) {
        const email = params[0] as string;
        const found = [...users.values()].find((u) => u.email === email);
        return (found ?? null) as T | null;
      }

      if (q.includes("from users") && q.includes("id =")) {
        const found = users.get(params[0] as string);
        return (found ?? null) as T | null;
      }

      if (q.includes("from sessions") && q.includes("token =")) {
        const s = sessions.get(params[0] as string);
        if (!s) return null;
        // 关联查出用户（对应 Postgres 版的 JOIN users）
        const u = users.get(s.user_id as string);
        if (!u) return null;
        return {
          user_id: s.user_id,
          expires_at: s.expires_at,
          email: u.email,
          display_name: u.display_name,
          created_at: u.created_at,
        } as T;
      }

      if (q.includes("from progress") && q.includes("user_id =")) {
        const found = progress.get(`${params[0]}:${params[1]}`);
        return (found ?? null) as T | null;
      }

      if (q.includes("from directions") && q.includes("id =")) {
        const found = directions.get(params[0] as string);
        return (found ?? null) as T | null;
      }

      if (q.includes("count(*)") && q.includes("from directions")) {
        const n = [...directions.values()].filter((d) => d.is_public === true).length;
        return { count: String(n) } as T;
      }

      return null;
    },
  };
}

// ── 单例与建表 ─────────────────────────────────────────────────────

let cached: Db | null = null;
let initialized = false;

/** 取数据库实例。首次调用时执行建表（幂等）。 */
export async function getDb(): Promise<Db> {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    cached = url && url.startsWith("postgres") ? createPostgresDb(url) : createMemoryDb();
  }

  if (!initialized) {
    await ensureSchema(cached);
    initialized = true;
  }

  return cached;
}

/** 建表语句。幂等，可重复执行。 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subject_id)
  )`,
  `CREATE TABLE IF NOT EXISTS directions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    description TEXT NOT NULL,
    graph_json TEXT NOT NULL,
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_directions_public ON directions(is_public, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_directions_user ON directions(user_id)`,
  `CREATE TABLE IF NOT EXISTS direction_picks (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    direction_id TEXT NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, direction_id)
  )`,
];

async function ensureSchema(db: Db): Promise<void> {
  for (const stmt of SCHEMA) {
    try {
      await db.run(stmt);
    } catch (err) {
      // 内存实现不认 CREATE TABLE，忽略即可
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not supported|unrecognized|syntax/i.test(msg)) {
        // Postgres 的真实错误要暴露出来，否则建表失败会静默
        if (process.env.DATABASE_URL) throw err;
      }
    }
  }
}

/** 测试用：重置内存库。 */
export function __resetMemoryDbForTests(): void {
  cached = null;
  initialized = false;
}
