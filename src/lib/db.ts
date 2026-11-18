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
 * 表结构定义在本文件末尾的 SCHEMA 常量里，启动时自动执行建表语句（幂等）。
 */

import { neon } from "@neondatabase/serverless";
import { createConversationMemory } from "@/lib/conversationMemory";
import { CONVERSATION_SCHEMA } from "@/lib/conversationSql";
import { ARTIFACT_SCHEMA, createArtifactMemory } from "@/lib/learningArtifacts";
import { DOCUMENT_PUBLISH_SQL } from "@/lib/documentSql";

/** 一条可进入事务的语句。 */
export interface DbStatement {
  readonly sql: string;
  readonly params?: unknown[];
  /** Abort the whole transaction when a compare-and-swap does not claim its row. */
  readonly expectedRows?: number;
}

export class DbWriteConflict extends Error {
  constructor() { super("Concurrent write conflict"); this.name = "DbWriteConflict"; }
}

/** A runtime SQL assertion, inside the transaction, never a post-commit check. */
export function guardedStatement(stmt: DbStatement): string {
  if (stmt.expectedRows === undefined) return stmt.sql;
  if (!Number.isSafeInteger(stmt.expectedRows) || stmt.expectedRows < 0) throw new Error("Invalid row expectation");
  return `WITH changed AS (${stmt.sql} RETURNING 1)
    SELECT count(*)::int AS affected,
      1 / CASE WHEN count(*) = ${stmt.expectedRows} THEN 1 ELSE 0 END AS guard FROM changed`;
}

/** 一个可执行查询的最小接口，让内存实现与 Postgres 实现共用上层代码。 */
export interface Db {
  /** 执行写操作，返回受影响行数（或 0）。 */
  run(sql: string, params?: unknown[]): Promise<number>;
  /** 查询多行。 */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** 查询单行，没有则返回 null。 */
  one<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  /**
   * 在单个事务里顺序执行一批语句，返回每条语句的受影响行数；
   * 任一失败全部回滚。Postgres 侧走 neon HTTP 的非交互事务；
   * 内存侧先快照再执行，抛错时整体还原。
   */
  tx(statements: readonly DbStatement[]): Promise<number[]>;
}

// ── 新表的 SQL 形状（Postgres 与内存实现共用） ─────────────────────

/**
 * kb_chunk_vectors 的 SQL 形状。
 *
 * 表里**不存 direction_id**：按方向取向量必须先 JOIN kb_chunks 拿 c.direction_id。
 * 直接写 `WHERE direction_id = $2` 会报「column does not exist」——这是 ADR
 * 决策二里示例查询的缺陷，这里按修正后的 JOIN 形状落地。
 */
export const KB_VECTOR_SQL = {
  /**
   * 单行 upsert。
   *
   * 向量以字符串传入再 ::vector：驱动会把 JS 数组序列化成 `{1,2,3}`，
   * 那不是 pgvector 认的文本格式。内存实现只认这一种单行形状；ADR 里的
   * 「50 条一条多行 INSERT」只允许出现在 dbBackend()==='postgres' 的分支。
   */
  upsert: `INSERT INTO kb_chunk_vectors (user_id, chunk_id, model, dim, vec, updated_at)
    VALUES ($1, $2, $3, $4, $5::vector(512), $6)
    ON CONFLICT (user_id, chunk_id, model) DO UPDATE SET
      dim = EXCLUDED.dim,
      vec = EXCLUDED.vec,
      updated_at = EXCLUDED.updated_at`,
  /** 按方向列向量。参数顺序固定：user_id, direction_id, model。 */
  byDirection: `SELECT v.chunk_id, v.model, v.dim, v.updated_at::text AS updated_at
    FROM kb_chunk_vectors v
    JOIN kb_chunks c ON c.user_id = v.user_id AND c.chunk_id = v.chunk_id
    WHERE v.user_id = $1 AND c.direction_id = $2 AND v.model = $3
    ORDER BY v.chunk_id`,
  /**
   * 精确扫描的相似度查询（默认路径，不依赖 HNSW）。
   * 参数顺序固定：user_id, direction_id, model, 查询向量（字符串）, limit。
   */
  similar: `SELECT v.chunk_id, 1 - (v.vec <=> $4::vector(512)) AS score
    FROM kb_chunk_vectors v
    JOIN kb_chunks c ON c.user_id = v.user_id AND c.chunk_id = v.chunk_id
    WHERE v.user_id = $1 AND c.direction_id = $2 AND v.model = $3
    ORDER BY v.vec <=> $4::vector(512) LIMIT $5`,
  /** 删一个片段在该用户下的全部模型行（对应复合外键的父行删除）。 */
  deleteByChunk: `DELETE FROM kb_chunk_vectors WHERE user_id = $1 AND chunk_id = $2`,
} as const;

/**
 * kb_tombstones 的 SQL 形状：跨设备删除标记。
 *
 * 删除文档/方向时写下 tombstone（deleted_at 单调不减）。文档 PUT 的事务末尾
 * 用 undoIfTombstoned 自查：若写入期间出现了不比 base 旧的 tombstone，
 * 说明另一设备的删除与本写入并发，删除赢——撤掉刚写入的文档（片段随外键级联），
 * 调用方收到 409。base 为 null（全新导入）时不撤：重新导入是新的用户意图，
 * 同时由 deleteById 清掉旧 tombstone。
 */
export const KB_TOMBSTONE_SQL = {
  /** 写入/刷新一个删除标记。参数顺序固定：user_id, doc_id, direction_id, deleted_at。 */
  upsert: `INSERT INTO kb_tombstones (user_id, doc_id, direction_id, deleted_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, doc_id) DO UPDATE SET
      direction_id = EXCLUDED.direction_id,
      deleted_at = EXCLUDED.deleted_at`,
  /** 全新导入（base 为 null）成功后清掉旧 tombstone。参数：user_id, doc_id。 */
  deleteById: `DELETE FROM kb_tombstones WHERE user_id = $1 AND doc_id = $2`,
  /**
   * PUT 事务末尾的复活守卫：仅当存在 deleted_at >= base 的 tombstone 时，
   * 撤掉本事务刚写入的文档行。deleted_at 由本代码写入，恒为毫秒数字符串，
   * ::numeric 比较不会遇到历史 ISO 行。参数：user_id, doc_id, updated_at, base(nullable)。
   */
  undoIfTombstoned: `DELETE FROM kb_docs WHERE user_id = $1 AND doc_id = $2 AND updated_at = $3
    AND $4::text IS NOT NULL
    AND EXISTS (SELECT 1 FROM kb_tombstones t
      WHERE t.user_id = $1 AND t.doc_id = $2 AND t.deleted_at::numeric >= $4::numeric)`,
} as const;

/** 按方向读回的向量行。updated_at 在 SQL 里 ::text，两种后端都返回字符串。 */
export interface KbChunkVectorRef {
  chunk_id: string;
  model: string;
  dim: number;
  updated_at: string;
}

/**
 * 按方向列出一个模型下已写入的向量（参考实现，调用方应优先用它而不是自拼 SQL）。
 *
 * user_id 只能来自会话；方向与模型由调用方校验后传入。
 */
export async function listKbChunkVectorsByDirection(
  db: Db,
  userId: string,
  directionId: string,
  model: string,
): Promise<KbChunkVectorRef[]> {
  return db.all<KbChunkVectorRef>(KB_VECTOR_SQL.byDirection, [userId, directionId, model]);
}

/**
 * mcp_servers 的 SQL 形状。
 *
 * 鉴权头只进密文列（auth_ct/auth_iv/auth_tag）：明文密钥、header 名与格式
 * 一律在应用层加密后再写；auth_hint 是给界面看的掩码。
 * 公开服务器没有鉴权头，此时四个密文字段为空串。
 */
export const MCP_SERVER_SQL = {
  upsert: `INSERT INTO mcp_servers (user_id, server_id, label, url, enabled, allowed_tools_json,
    auth_ct, auth_iv, auth_tag, auth_kid, auth_hint, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (user_id, server_id) DO UPDATE SET
      label = EXCLUDED.label,
      url = EXCLUDED.url,
      enabled = EXCLUDED.enabled,
      allowed_tools_json = EXCLUDED.allowed_tools_json,
      auth_ct = EXCLUDED.auth_ct,
      auth_iv = EXCLUDED.auth_iv,
      auth_tag = EXCLUDED.auth_tag,
      auth_kid = EXCLUDED.auth_kid,
      auth_hint = EXCLUDED.auth_hint,
      updated_at = EXCLUDED.updated_at`,
  list: `SELECT * FROM mcp_servers WHERE user_id = $1 ORDER BY server_id`,
  byId: `SELECT * FROM mcp_servers WHERE user_id = $1 AND server_id = $2`,
  deleteById: `DELETE FROM mcp_servers WHERE user_id = $1 AND server_id = $2`,
} as const;

// ── Postgres 实现 ──────────────────────────────────────────────────

/**
 * Neon 的 HTTP 驱动默认只返回「行数组」。
 * INSERT/UPDATE/DELETE 无 RETURNING 时那是空数组，`rows.length` 恒为 0——
 * 用它判断「插入是否成功」在 Postgres 上永远为假，而内存实现返回 1，
 * 于是本地全绿、线上「写入成功却报失败」。
 *
 * 这里用 fullResults: true 拿 rowCount。它是驱动文档承诺的字段
 * （node_modules/@neondatabase/serverless/index.d.ts 的 fullResults 说明），
 * 与 node-postgres 的 result.rowCount 同义。
 */
function createPostgresDb(url: string): Db {
  const sql = neon(url, { fullResults: true });

  interface FullResult {
    rows?: unknown[];
    rowCount?: number | null;
  }

  const query = async (text: string, params: unknown[]): Promise<FullResult> => {
    // neon 的模板标签接口不接受动态 SQL，这里用 query 方法
    return (await sql.query(text, params)) as unknown as FullResult;
  };

  return {
    async run(text, params = []) {
      const result = await query(text, params);
      // 优先 rowCount；个别语句（如 DDL）驱动可能给 null，退回行数
      if (typeof result.rowCount === "number") return result.rowCount;
      return Array.isArray(result.rows) ? result.rows.length : 0;
    },
    async all<T>(text: string, params: unknown[] = []) {
      const result = await query(text, params);
      return Array.isArray(result.rows) ? (result.rows as T[]) : [];
    },
    async one<T>(text: string, params: unknown[] = []) {
      const result = await query(text, params);
      return Array.isArray(result.rows) && result.rows.length > 0
        ? (result.rows[0] as T)
        : null;
    },
    async tx(statements) {
      /*
       * neon HTTP 的非交互事务：整批语句一次提交，任一失败全部回滚。
       * 事务内沿用 fullResults: true，逐个取 rowCount，与 run() 同口径。
       */
      try {
        const results = await sql.transaction((txn) =>
          statements.map((stmt) => txn.query(guardedStatement(stmt), stmt.params ?? [])),
        );
        return (results as unknown as FullResult[]).map((result, index) =>
          statements[index].expectedRows !== undefined
            ? Number((result.rows?.[0] as { affected: number }).affected)
            : result.rowCount ?? result.rows?.length ?? 0,
        );
      } catch (error) {
        if (statements.some(s => s.expectedRows !== undefined) && (error as { code?: string }).code === "22012") throw new DbWriteConflict();
        throw error;
      }
    },
  };
}

// ── 内存实现（本地开发 / 测试） ────────────────────────────────────

interface InsertShape {
  readonly table: string;
  readonly columns: readonly string[];
  /** ON CONFLICT 的冲突列；null 表示语句没写 ON CONFLICT。 */
  readonly conflict: readonly string[] | null;
  /** ON CONFLICT ... DO NOTHING：重复时不写、返回 0。 */
  readonly doNothing: boolean;
  /** DO UPDATE SET 的「列名 → 取值函数」。 */
  readonly assignments: ReadonlyMap<string, () => unknown>;
}

/**
 * 解析本文件用到的 INSERT ... ON CONFLICT 形状。
 *
 * 只认一种写法：列名列表与 $n 参数一一对应（参数 i 就是 columns[i]），
 * 冲突赋值只允许 `EXCLUDED.列名` 或 `$n`。这不是通用 SQL 解析器：
 * 遇到不认识的表达式宁可抛错，也不静默写错值——写错一个字段比报错难查得多。
 */
function parseInsert(q: string, params: unknown[]): InsertShape {
  const head = /^insert into ([a-z_]+)\s*\((.+?)\)\s*values/.exec(q);
  if (!head) {
    throw new Error(`内存实现无法解析 INSERT：${q.slice(0, 100)}`);
  }

  const table = head[1];
  const columns = head[2].split(",").map((part) => part.trim());
  if (columns.length !== params.length) {
    throw new Error(
      `INSERT 列数与参数数不一致：${table} 有 ${columns.length} 列、${params.length} 个参数`,
    );
  }
  const valueOf = (column: string): unknown => params[columns.indexOf(column)];

  const update = /on conflict \((.+?)\) do update set (.+)$/.exec(q);
  if (update) {
    const conflict = update[1].split(",").map((part) => part.trim());
    const assignments = new Map<string, () => unknown>();

    for (const part of update[2].split(",")) {
      const eq = part.indexOf("=");
      if (eq < 0) {
        throw new Error(`内存实现无法解析 ON CONFLICT 赋值：${part.trim()}`);
      }
      const column = part.slice(0, eq).trim();
      const source = part.slice(eq + 1).trim();

      const excluded = /^excluded\.([a-z_]+)$/.exec(source);
      if (excluded) {
        const from = excluded[1];
        if (!columns.includes(from)) {
          throw new Error(`ON CONFLICT 引用了 INSERT 列表里没有的列：EXCLUDED.${from}`);
        }
        assignments.set(column, () => valueOf(from));
        continue;
      }

      const numbered = /^\$(\d+)$/.exec(source);
      if (numbered) {
        const index = Number(numbered[1]) - 1;
        if (index < 0 || index >= params.length) {
          throw new Error(`ON CONFLICT 引用了越界参数：${source}`);
        }
        assignments.set(column, () => params[index]);
        continue;
      }

      throw new Error(`内存实现不支持 ON CONFLICT 赋值表达式：${column} = ${source}`);
    }

    return { table, columns, conflict, doNothing: false, assignments };
  }

  const nothing = /on conflict \((.+?)\) do nothing/.exec(q);
  if (nothing) {
    const conflict = nothing[1].split(",").map((part) => part.trim());
    return { table, columns, conflict, doNothing: true, assignments: new Map() };
  }

  return { table, columns, conflict: null, doNothing: false, assignments: new Map() };
}

/**
 * 四张新表共用的 upsert。
 *
 * 冲突列必须与 Postgres 的主键完全一致：对不上说明两条 SQL 已经分叉，
 * 直接抛错，避免内存里悄悄多出一行「看起来写成功」的重复数据。
 * 返回值与 Postgres 的 rowCount 同义：插入 1、更新 1、DO NOTHING 命中 0。
 */
function upsertRow(
  map: Map<string, Record<string, unknown>>,
  q: string,
  params: unknown[],
  table: string,
  conflictColumns: readonly string[],
  keyOf: (row: Record<string, unknown>) => string,
): number {
  const shape = parseInsert(q, params);
  if (shape.table !== table) {
    throw new Error(`内存实现期望写入 ${table}，收到 ${shape.table}`);
  }

  const row: Record<string, unknown> = {};
  shape.columns.forEach((column, i) => {
    row[column] = params[i];
  });

  const key = keyOf(row);
  const existing = map.get(key);
  if (!existing) {
    map.set(key, row);
    return 1;
  }

  if (shape.conflict === null) {
    // 与 Postgres 的 23505 对齐：没写 ON CONFLICT 的重复插入是错误，不是静默忽略
    throw new Error(`duplicate key in ${table}: ${key}`);
  }

  const expected = [...conflictColumns].sort().join(",");
  const actual = [...shape.conflict].sort().join(",");
  if (actual !== expected) {
    throw new Error(`${table} 的 ON CONFLICT 列与主键不一致：期望 ${expected}，收到 ${actual}`);
  }
  if (shape.doNothing) return 0;

  const next = { ...existing };
  for (const [column, read] of shape.assignments) {
    next[column] = read();
  }
  map.set(key, next);
  return 1;
}

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
  const learningSessions = new Map<string, Record<string, unknown>>();
  const conversationArchive = createConversationMemory(id => users.has(id));
  const artifacts = createArtifactMemory();
  const directions = new Map<string, Record<string, unknown>>();
  /** key = `${direction_id}|${content_hash}`，对应 Postgres 的唯一约束。 */
  const directionItems = new Map<string, Record<string, unknown>>();
  /** 以下四张表的 key 都对应 Postgres 的复合主键，用 `|` 拼接。 */
  const userSecrets = new Map<string, Record<string, unknown>>();
  const kbDocs = new Map<string, Record<string, unknown>>();
  const kbChunks = new Map<string, Record<string, unknown>>();
  /** key = `${user_id}|${doc_id}`，对应 Postgres 的复合主键。 */
  const kbTombstones = new Map<string, Record<string, unknown>>();
  const memories = new Map<string, Record<string, unknown>>();
  /** key = `${user_id}|${chunk_id}|${model}`，对应 Postgres 的复合主键。 */
  const kbChunkVectors = new Map<string, Record<string, unknown>>();
  /** key = `${user_id}|${server_id}`，对应 Postgres 的复合主键。 */
  const mcpServers = new Map<string, Record<string, unknown>>();

  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  /*
   * 删片段时同步删掉它的向量行：Postgres 侧由 kb_chunk_vectors 的复合外键
   * ON DELETE CASCADE 完成。少了这一步，内存实现会在「删片段 → 用同一个
   * chunk_id 重新写入」时把旧向量带出来，本地绿、线上不同。
   */
  const dropChunk = (key: string, row: Record<string, unknown>): void => {
    kbChunks.delete(key);
    for (const [vectorKey, vector] of kbChunkVectors) {
      if (vector.user_id === row.user_id && vector.chunk_id === row.chunk_id) {
        kbChunkVectors.delete(vectorKey);
      }
    }
  };

  const memory = {
    /*
     * 事务：先快照全部表再顺序执行；任一语句抛错就整体还原。
     * 覆盖的是 createMemoryDb 自己持有的表；conversationArchive / artifacts
     * 有独立存储，当前没有事务调用方写它们，真有时再纳入快照。
     */
    tx(statements: readonly DbStatement[]) {
      const tables = [
        users, sessions, progress, learningSessions, directions, directionItems,
        userSecrets, kbDocs, kbChunks, kbTombstones, memories, kbChunkVectors, mcpServers,
      ];
      const backups = tables.map((table) => new Map(table));
      try {
        const counts: number[] = [];
        for (const stmt of statements) {
          const count = this.run(stmt.sql, stmt.params ?? []);
          if (stmt.expectedRows !== undefined && count !== stmt.expectedRows) throw new DbWriteConflict();
          counts.push(count);
        }
        return counts;
      } catch (err) {
        tables.forEach((table, index) => {
          table.clear();
          for (const [key, value] of backups[index]) table.set(key, value);
        });
        throw err;
      }
    },

    run(text: string, params: unknown[] = []) {
      const q = norm(text);
      const archiveResult = conversationArchive.run(text, params);
      if (archiveResult !== undefined) return archiveResult;
      const artifactResult = artifacts.run(text, params);
      if (artifactResult !== undefined) return artifactResult;
      if (text === DOCUMENT_PUBLISH_SQL) {
        const doc = JSON.parse(String(params[0])) as Record<string,unknown>;
        const key = `${doc.user_id}|${doc.doc_id}`;
        if (kbDocs.has(key)) return 0;
        const chunks = JSON.parse(String(params[1])) as Record<string,unknown>[];
        kbDocs.set(key,doc);
        for (const chunk of chunks) kbChunks.set(`${chunk.user_id}|${chunk.chunk_id}`,chunk);
        return chunks.length;
      }

      if (q.startsWith("insert into learning_sessions")) {
        const [user_id, target_id, revision, data, base] = params;
        const key = `${user_id}|${target_id}`;
        const existing = learningSessions.get(key);
        if (existing && (base === null || existing.revision !== base)) return 0;
        learningSessions.set(key, { user_id, target_id, revision, data });
        return 1;
      }

      if (q.startsWith("insert into users")) {
        const [id, email, password_hash, display_name, created_at] = params as string[];
        if ([...users.values()].some((u) => u.email === email)) {
          throw new Error("duplicate email");
        }
        users.set(id, { id, email, password_hash, display_name, created_at, recovery_hash: params[5] ?? null, auth_version: 0 });
        return 1;
      }

      if (q.startsWith("update users set recovery_hash") || q.startsWith("update users set password_hash")) {
        const stored = users.get(params[1] as string);
        const row = stored && { ...stored };
        if (!row || row.password_hash !== params[2]) return 0;
        if (q.includes("and recovery_hash =") && row.recovery_hash !== params[3]) return 0;
        if (q.startsWith("update users set recovery_hash")) row.recovery_hash = params[0];
        else {
          row.password_hash = params[0];
          row.auth_version = Number(row.auth_version) + 1;
          if (q.includes("recovery_hash = null")) row.recovery_hash = null;
        }
        users.set(params[1] as string, row);
        return 1;
      }

      if (q.startsWith("insert into sessions")) {
        const [token, user_id, expires_at, created_at] = params as string[];
        sessions.set(token, { token, user_id, expires_at, created_at, auth_version: params[4] ?? 0 });
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
        if (q.includes("where progress.updated_at")) {
          const existing = progress.get(`${user_id}:${subject_id}`);
          if (existing && (params[4] === null || existing.updated_at !== params[4])) return 0;
          if (!existing && params[4] !== null) return 0;
        }
        progress.set(`${user_id}:${subject_id}`, { user_id, subject_id, data, updated_at });
        return 1;
      }

      /*
       * 两种删除形状，按 WHERE 里有没有 subject_id 区分：
       *   - 带 subject_id：删 (user_id, subject_id) 这一行；
       *   - 不带：清空该用户的全部学科，返回真实删除数。
       * 返回值必须是真的删了几行——调用方（清空进度）据此判断是否成功，
       * 旧实现无条件返回 1，行还在却报成功。
       */
      if (q.startsWith("delete from progress")) {
        if (q.includes("subject_id")) {
          const [user_id, subject_id] = params as string[];
          return progress.delete(`${user_id}:${subject_id}`) ? 1 : 0;
        }
        const user_id = params[0] as string;
        let n = 0;
        for (const [key, row] of progress) {
          if (row.user_id === user_id) {
            progress.delete(key);
            n += 1;
          }
        }
        return n;
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
        // 模拟 ON DELETE CASCADE：方向删掉，它的题也不该留着
        for (const [key, row] of directionItems) {
          if (row.direction_id === id) directionItems.delete(key);
        }
        return 1;
      }

      if (q.startsWith("insert into direction_picks")) {
        return 1;
      }

      /*
       * 题目批量落库。Postgres 侧用 ON CONFLICT DO NOTHING，内存侧按唯一键跳过，
       * 两边都是「重复提交不报错、不新增行」。
       */
      if (q.startsWith("insert into direction_items")) {
        const [
          id,
          direction_id,
          kc_id,
          difficulty,
          stem,
          options_json,
          answer_index,
          explanation,
          content_hash,
          source,
          status,
          checks_json,
          created_at,
        ] = params as (string | number)[];
        const key = `${direction_id}|${content_hash}`;
        if (directionItems.has(key)) return 0;
        directionItems.set(key, {
          id,
          direction_id,
          kc_id,
          difficulty,
          stem,
          options_json,
          answer_index,
          explanation,
          content_hash,
          source,
          status,
          checks_json,
          created_at,
        });
        return 1;
      }

      // 方向被删时级联删题，对应 Postgres 的 ON DELETE CASCADE
      // （directions 的 DELETE 分支已处理；这里保留供显式清理调用）
      if (q.startsWith("delete from direction_items")) {
        if (q.includes("direction_id =")) {
          const dirId = params[0] as string;
          let n = 0;
          for (const [key, row] of directionItems) {
            if (row.direction_id === dirId) {
              directionItems.delete(key);
              n += 1;
            }
          }
          return n;
        }
        return 0;
      }

      if (q.startsWith("insert into user_secrets")) {
        return upsertRow(userSecrets, q, params, "user_secrets", ["user_id", "kind"], (row) =>
          `${row.user_id}|${row.kind}`,
        );
      }

      if (q.startsWith("insert into kb_docs")) {
        if (q.includes("where kb_docs.updated_at")) {
          const existing = kbDocs.get(`${params[0]}|${params[1]}`);
          if (existing && (params[13] === null || existing.updated_at !== params[13])) return 0;
          if (!existing && params[13] !== null) return 0;
        }
        return upsertRow(kbDocs, q.split(" where kb_docs.updated_at")[0], q.includes("where kb_docs.updated_at") ? params.slice(0, 13) : params, "kb_docs", ["user_id", "doc_id"], (row) =>
          `${row.user_id}|${row.doc_id}`,
        );
      }

      if (q.startsWith("insert into kb_chunks")) {
        return upsertRow(kbChunks, q, params, "kb_chunks", ["user_id", "chunk_id"], (row) =>
          `${row.user_id}|${row.chunk_id}`,
        );
      }

      if (q.startsWith("insert into kb_tombstones")) {
        return upsertRow(kbTombstones, q, params, "kb_tombstones", ["user_id", "doc_id"], (row) =>
          `${row.user_id}|${row.doc_id}`,
        );
      }

      if (q.startsWith("delete from kb_tombstones")) {
        const [user_id, doc_id] = params as string[];
        return kbTombstones.delete(`${user_id}|${doc_id}`) ? 1 : 0;
      }

      if (q.startsWith("insert into memories")) {
        return upsertRow(memories, q, params, "memories", ["user_id", "mem_id"], (row) =>
          `${row.user_id}|${row.mem_id}`,
        );
      }

      /*
       * kb_chunk_vectors：只认单行 upsert。
       * `kb_chunk_vectors` 不以 `kb_chunks` 为前缀（第 9 个字符是 `_` 而不是 `s`），
       * 所以上面的片段分支不会误吞这条语句；不要改成别的表名风格。
       */
      if (q.startsWith("insert into kb_chunk_vectors")) {
        return upsertRow(
          kbChunkVectors,
          q,
          params,
          "kb_chunk_vectors",
          ["user_id", "chunk_id", "model"],
          (row) => `${row.user_id}|${row.chunk_id}|${row.model}`,
        );
      }

      if (q.startsWith("insert into mcp_servers")) {
        return upsertRow(mcpServers, q, params, "mcp_servers", ["user_id", "server_id"], (row) =>
          `${row.user_id}|${row.server_id}`,
        );
      }

      /*
       * mcp_servers 的唯一删除形状是 (user_id, server_id)。
       * 只写 user_id 的「删全部」形状没有实现：那会让一次误传参删光用户配置，
       * 真需要时再加，并在这里显式分支。
       */
      if (q.startsWith("delete from mcp_servers")) {
        const [user_id, server_id] = params as string[];
        return mcpServers.delete(`${user_id}|${server_id}`) ? 1 : 0;
      }

      /*
       * kb_chunk_vectors 的唯一删除形状是 (user_id, chunk_id)：一个片段在多个
       * 模型下各有一行，删片段就要把该片段的所有模型行一起删掉。
       * 其它 WHERE（比如按 model 删）当前没有调用方，直接抛错而不是静默删 0 行——
       * 「删除返回 0、调用方当成功」是本文件里反复出现过的坑。
       */
      if (q.startsWith("delete from kb_chunk_vectors")) {
        if (!q.includes("chunk_id =")) {
          throw new Error(`内存实现不支持的 kb_chunk_vectors 删除形状：${q.slice(0, 100)}`);
        }
        const [user_id, chunk_id] = params as string[];
        let n = 0;
        for (const [key, row] of kbChunkVectors) {
          if (row.user_id === user_id && row.chunk_id === chunk_id) {
            kbChunkVectors.delete(key);
            n += 1;
          }
        }
        return n;
      }

      /*
       * user_secrets 的唯一删除形状是 (user_id, kind)。
       * 返回真实删除数：调用方（删除配置）据此区分「删掉了」与「本来就没有」。
       */
      if (q.startsWith("delete from user_secrets")) {
        const [user_id, kind] = params as string[];
        return userSecrets.delete(`${user_id}|${kind}`) ? 1 : 0;
      }

      /*
       * kb_docs 的三种删除形状：
       *   - 复活守卫（含 kb_tombstones 子查询）：条件全命中才删，用于 PUT 事务末尾；
       *   - (user_id, doc_id)：删一篇文档，并级联删它的全部片段；
       *   - (user_id, direction_id)：删一个方向的全部文档与片段。
       * 先判 doc_id：`direction_id =` 不含 `doc_id =`，但反过来判定顺序错会把
       * 「删一篇」误当成「删整个方向」——多删比少删更难恢复。
       * 级联在 Postgres 侧由 kb_chunks 的复合外键 ON DELETE CASCADE 完成，这里手动模拟。
       */
      if (q.startsWith("delete from kb_docs")) {
        const user_id = params[0] as string;
        let n = 0;

        /*
         * 复活守卫（KB_TOMBSTONE_SQL.undoIfTombstoned）：多了 updated_at 精确匹配
         * 与 tombstone 存在性两个条件，必须最先判，否则会落进下面的普通删除分支，
         * 把「条件不命中该删 0 行」误判成「删掉了」。
         */
        if (q.includes("kb_tombstones")) {
          const [, doc_id, updated_at, base] = params as [string, string, string, string | null];
          if (base === null) return 0;
          const key = `${user_id}|${doc_id}`;
          const existing = kbDocs.get(key);
          if (!existing || existing.updated_at !== updated_at) return 0;
          const tomb = kbTombstones.get(key);
          if (!tomb || Number(tomb.deleted_at) < Number(base)) return 0;
          kbDocs.delete(key);
          for (const [chunkKey, row] of kbChunks) {
            if (row.user_id === user_id && row.doc_id === doc_id) dropChunk(chunkKey, row);
          }
          return 1;
        }

        if (q.includes("doc_id =")) {
          const doc_id = params[1] as string;
          if (kbDocs.delete(`${user_id}|${doc_id}`)) n += 1;
          for (const [key, row] of kbChunks) {
            if (row.user_id === user_id && row.doc_id === doc_id) dropChunk(key, row);
          }
          return n;
        }

        if (q.includes("direction_id =")) {
          const direction_id = params[1] as string;
          for (const [key, row] of kbDocs) {
            if (row.user_id === user_id && row.direction_id === direction_id) {
              kbDocs.delete(key);
              n += 1;
            }
          }
          for (const [key, row] of kbChunks) {
            if (row.user_id === user_id && row.direction_id === direction_id) {
              dropChunk(key, row);
            }
          }
          return n;
        }

        return 0;
      }

      /*
       * kb_chunks 的三种删除形状：(user_id, doc_id)、(user_id, chunk_id)、(user_id, direction_id)。
       * chunk_id 必须先判：三种键都含 `id =`，顺序错了会把「删一段」当成「删整篇」。
       * 三种都不命中时落到文件末尾的 return 0——这正是「漏一种即静默成功」的来源，
       * 因此每一种形状在 db.test.ts 里都有独立断言。
       */
      if (q.startsWith("delete from kb_chunks")) {
        const user_id = params[0] as string;
        let n = 0;

        if (q.includes("chunk_id =")) {
          const key = `${user_id}|${params[1]}`;
          const row = kbChunks.get(key);
          if (!row) return 0;
          dropChunk(key, row);
          return 1;
        }

        if (q.includes("doc_id =")) {
          const doc_id = params[1] as string;
          for (const [key, row] of kbChunks) {
            if (row.user_id === user_id && row.doc_id === doc_id) {
              dropChunk(key, row);
              n += 1;
            }
          }
          return n;
        }

        if (q.includes("direction_id =")) {
          const direction_id = params[1] as string;
          for (const [key, row] of kbChunks) {
            if (row.user_id === user_id && row.direction_id === direction_id) {
              dropChunk(key, row);
              n += 1;
            }
          }
          return n;
        }

        return 0;
      }

      /*
       * memories 的两种删除形状：(user_id, subject_id) 清空学科快照，
       * (user_id, mem_id) 删单张。先判 mem_id，理由同上：键的包含关系不成立，
       * 但少判一层就多一条静默 return 0 的路径。
       */
      if (q.startsWith("delete from memories")) {
        const user_id = params[0] as string;

        if (q.includes("mem_id =")) {
          return memories.delete(`${user_id}|${params[1]}`) ? 1 : 0;
        }

        if (q.includes("subject_id =")) {
          const subject_id = params[1] as string;
          let n = 0;
          for (const [key, row] of memories) {
            if (row.user_id === user_id && row.subject_id === subject_id) {
              memories.delete(key);
              n += 1;
            }
          }
          return n;
        }

        return 0;
      }

      return 0;
    },

    all<T>(text: string, params: unknown[] = []) {
      const q = norm(text);
      const archiveRows = conversationArchive.all(text, params);
      if (archiveRows !== undefined) return archiveRows as T[];
      const artifactRows = artifacts.all(text, params);
      if (artifactRows !== undefined) return artifactRows as T[];

      if (q.includes("from user_secrets")) {
        const rows = [...userSecrets.values()]
          .filter((r) => r.user_id === params[0])
          .filter((r) => !q.includes("kind =") || r.kind === params[1])
          .sort((a, b) => String(a.kind).localeCompare(String(b.kind)));
        return rows as T[];
      }

      if (q.includes("from kb_docs")) {
        let rows = [...kbDocs.values()].filter((r) => r.user_id === params[0]);
        if (q.includes("direction_id =")) {
          rows = rows.filter((r) => r.direction_id === params[1]);
        }
        if (q.includes("doc_id =")) {
          rows = rows.filter((r) => r.doc_id === params[1]);
        }
        rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        return rows as T[];
      }

      /*
       * kb_tombstones 的读取形状：按用户列出，可选按方向过滤。
       * 参数顺序固定：user_id（$1），可选 direction_id（$2）。
       */
      if (q.includes("from kb_tombstones")) {
        let rows = [...kbTombstones.values()].filter((r) => r.user_id === params[0]);
        if (q.includes("direction_id =")) {
          rows = rows.filter((r) => r.direction_id === params[1]);
        }
        rows.sort((a, b) => String(a.doc_id).localeCompare(String(b.doc_id)));
        return rows as T[];
      }

      /*
       * kb_chunk_vectors 的读取形状：按方向取向量。
       *
       * 表里不存 direction_id，方向过滤只能 JOIN kb_chunks：
       *   FROM kb_chunk_vectors v
       *   JOIN kb_chunks c ON c.user_id = v.user_id AND c.chunk_id = v.chunk_id
       *   WHERE v.user_id = $1 AND c.direction_id = $2 AND v.model = $3
       * 参数顺序固定：user_id, direction_id, model。必须先判这一条：如果把 JOIN
       * 写成 `FROM kb_chunks c JOIN kb_chunk_vectors v`，文本里也会含
       * `from kb_chunks`，顺序反了就会把向量查询当成片段查询处理。
       *
       * 其它形状直接抛错而不是静默返回空——向量查询写错列名正是 ADR 里
       * `direction_id` 缺陷的来源，静默空会让这类错误在线下永远暴露不出来。
       */
      if (q.includes("from kb_chunk_vectors")) {
        /*
         * 相似度排序（vec <=> $4::vector）在内存实现里没有 pgvector：返回空数组。
         * 不用应用层余弦冒充 pgvector 结果——本地绿、线上不同是最难查的偏差。
         * 调用方拿到空数组时应退回 vector.ts 的余弦路径（或直接报「未启用」）。
         */
        if (q.includes("<=>")) return [];

        if (!q.includes("join kb_chunks") || !q.includes("direction_id =")) {
          throw new Error(`内存实现不支持的 kb_chunk_vectors 查询形状：${q.slice(0, 100)}`);
        }

        const [userId, directionId, model] = params as string[];
        const chunks = new Map<string, Record<string, unknown>>();
        for (const chunk of kbChunks.values()) {
          if (chunk.user_id === userId) chunks.set(String(chunk.chunk_id), chunk);
        }

        const rows = [...kbChunkVectors.values()]
          .filter((r) => r.user_id === userId && r.model === model)
          .filter((r) => {
            const chunk = chunks.get(String(r.chunk_id));
            // JOIN 的另一半：片段不存在（被删）或不在该方向，都不该出现在结果里
            return chunk !== undefined && chunk.direction_id === directionId;
          })
          .sort(
            (a, b) =>
              String(a.chunk_id).localeCompare(String(b.chunk_id)) ||
              String(a.model).localeCompare(String(b.model)),
          );
        return rows as T[];
      }

      /*
       * mcp_servers：列表与按 server_id 的单条查询共用同一个分支。
       * 参数顺序固定：user_id（$1），可选的 server_id（$2）。排序按 server_id，
       * 与 MCP_SERVER_SQL.list 的 ORDER BY 一致。
       */
      if (q.includes("from mcp_servers")) {
        let rows = [...mcpServers.values()].filter((r) => r.user_id === params[0]);
        if (q.includes("server_id =")) {
          rows = rows.filter((r) => r.server_id === params[1]);
        }
        rows.sort((a, b) => String(a.server_id).localeCompare(String(b.server_id)));
        return rows as T[];
      }

      /*
       * kb_chunks 的游标分页必须先判 `chunk_id >`。
       * 分页 SQL 同时含 `direction_id = $2` 与 `chunk_id > $3`：
       * 若先命中方向过滤就 return，会把整方向的向量一次返回，
       * 游标永远推不动，调用方还会以为「这已经是全部」。
       *
       * 分页分支的参数顺序固定：user_id, direction_id, after(chunk_id), limit。
       */
      if (q.includes("from kb_chunks")) {
        let rows = [...kbChunks.values()].filter((r) => r.user_id === params[0]);

        if (q.includes("chunk_id >")) {
          const after = String(params[2]);
          const limit = Number(params[3]);
          rows = rows
            .filter((r) => r.direction_id === params[1] && String(r.chunk_id) > after)
            .sort((a, b) => String(a.chunk_id).localeCompare(String(b.chunk_id)));
          return (Number.isFinite(limit) ? rows.slice(0, limit) : rows) as T[];
        }

        if (q.includes("direction_id =")) {
          rows = rows.filter((r) => r.direction_id === params[1]);
        }
        /*
         * 按文档列片段（putKbDocument 用它找「本次没提交的旧片段」）。
         * 少了这一层过滤会返回该用户所有文档的片段，调用方会把别的文档也删掉。
         */
        if (q.includes("doc_id = any($3::text[])")) {
          rows=rows.filter(r=>(params[2] as string[]).includes(String(r.doc_id)));
        } else if (q.includes("doc_id =")) {
          rows = rows.filter((r) => r.doc_id === params[1]);
        }
        if (q.includes("order by chunk_id")) {
          rows.sort((a, b) => String(a.chunk_id).localeCompare(String(b.chunk_id)));
        } else {
          rows.sort(
            (a, b) =>
              String(a.doc_id).localeCompare(String(b.doc_id)) ||
              Number(a.idx) - Number(b.idx),
          );
        }
        return rows as T[];
      }

      if (q.includes("from memories")) {
        let rows = [...memories.values()].filter((r) => r.user_id === params[0]);
        if (q.includes("subject_id =")) {
          rows = rows.filter((r) => r.subject_id === params[1]);
        }
        if (q.includes("status =")) {
          // 规范查询的参数顺序是 user_id, subject_id, status；没有 subject_id 时 status 是 $2
          const index = q.includes("subject_id =") ? 2 : 1;
          rows = rows.filter((r) => r.status === params[index]);
        }
        rows.sort(
          (a, b) =>
            String(a.created_at).localeCompare(String(b.created_at)) ||
            String(a.mem_id).localeCompare(String(b.mem_id)),
        );
        return rows as T[];
      }

      if (q.includes("from direction_items")) {
        let rows = [...directionItems.values()];
        // 参数顺序固定：direction_id 永远第一个；kc_id 可选第二个。
        // 状态过滤在调用方做——这里只认这两种查询，多一种就要多一处双实现。
        if (q.includes("direction_id =")) {
          const dirId = params[0] as string;
          rows = rows.filter((r) => r.direction_id === dirId);
        }
        if (q.includes("kc_id =")) {
          const kcId = params[1] as string;
          rows = rows.filter((r) => r.kc_id === kcId);
        }
        rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        return rows as T[];
      }

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

      /*
       * 全量进度（GET /api/progress）。没有 user_id 过滤时按用户分组取全部，
       * 有过滤时只取该用户。缺这条分支会让内存模式下「写入成功、读回为空」，
       * 而写入返回 200 不会报错——是最难查的那类缺口。
       */
      if (q.includes("from progress")) {
        const uid = q.includes("user_id =") ? (params[0] as string) : null;
        const rows = [...progress.values()].filter((r) => uid === null || r.user_id === uid);
        return rows as T[];
      }

      return [];
    },

    one<T>(text: string, params: unknown[] = []) {
      const q = norm(text);
      const archiveRows = conversationArchive.all(text, params);
      if (archiveRows !== undefined) return (archiveRows[0] ?? null) as T | null;
      const artifactRows = artifacts.all(text, params);
      if (artifactRows !== undefined) return (artifactRows[0] ?? null) as T | null;

      if (q.includes("from learning_sessions")) {
        return (learningSessions.get(`${params[0]}|${params[1]}`) ?? null) as T | null;
      }

      // 必须放在 from users 之前：`from user_secrets` 也含 `user` 前缀
      if (q.includes("from user_secrets") && q.includes("kind =")) {
        const found = userSecrets.get(`${params[0]}|${params[1]}`);
        return (found ?? null) as T | null;
      }

      // 单条 MCP 服务器配置：(user_id, server_id) 就是主键
      if (q.includes("from mcp_servers") && q.includes("server_id =")) {
        const found = mcpServers.get(`${params[0]}|${params[1]}`);
        return (found ?? null) as T | null;
      }

      if (q.includes("from kb_docs") && q.includes("doc_id =")) {
        const found = kbDocs.get(`${params[0]}|${params[1]}`);
        return (found ?? null) as T | null;
      }

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
        if (!u || s.auth_version !== u.auth_version) return null;
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

      if (q.includes("count(*)") && q.includes("from direction_items")) {
        const dirId = params[0] as string;
        const n = [...directionItems.values()].filter((r) => r.direction_id === dirId).length;
        return { count: String(n) } as T;
      }

      if (q.includes("count(*)") && q.includes("from directions")) {
        const n = [...directions.values()].filter((d) => d.is_public === true).length;
        return { count: String(n) } as T;
      }

      return null;
    },
  };
  // Mutations and snapshots run synchronously to completion. Async callers cannot
  // interleave another write halfway through a transaction or its rollback.
  return {
    run: async (q, p) => memory.run(q, p),
    all: async <T>(q: string, p?: unknown[]) => memory.all<T>(q, p),
    one: async <T>(q: string, p?: unknown[]) => memory.one<T>(q, p),
    tx: async statements => memory.tx(statements),
  };
}

// ── 单例与建表 ─────────────────────────────────────────────────────

export type DbBackend = "postgres" | "memory";

let cached: Db | null = null;
let initialized = false;
let backendOverride: DbBackend | null = null;

/**
 * 当前数据库后端。
 *
 * /api/config 用它决定是否允许写密钥：内存后端重启即丢、多实例各存各的，
 * 把加密后的密钥存进去等于没存。判定只看 DATABASE_URL 是否以 postgres 开头，
 * 与 getDb 的连接选择保持一致。
 */
export function dbBackend(): DbBackend {
  if (backendOverride !== null) return backendOverride;
  const url = process.env.DATABASE_URL;
  return url !== undefined && url.startsWith("postgres") ? "postgres" : "memory";
}

/** 取数据库实例。首次调用时执行建表（幂等）。 */
export async function getDb(): Promise<Db> {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    cached =
      dbBackend() === "postgres" && url !== undefined && url.startsWith("postgres")
        ? createPostgresDb(url)
        : createMemoryDb();
  }

  if (!initialized) {
    await ensureSchema(cached);
    initialized = true;
  }

  return cached;
}

/** 建表语句。幂等，可重复执行；db/migrations/0001_capability.sql 必须与它逐条一致。 */
export const SCHEMA = [
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
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_hash TEXT`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, subject_id)
  )`,
  `CREATE TABLE IF NOT EXISTS learning_sessions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (user_id, target_id)
  )`,
  ...CONVERSATION_SCHEMA,
  ARTIFACT_SCHEMA,
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
  /*
   * 自定义方向的题目。按 KC 懒生成、落库永久缓存。
   * UNIQUE(direction_id, content_hash) 让「同一题重复落库」变成幂等操作，
   * 生成重试与「生成全部题目」重复点击都不会产生重复行。
   */
  `CREATE TABLE IF NOT EXISTS direction_items (
    id TEXT PRIMARY KEY,
    direction_id TEXT NOT NULL REFERENCES directions(id) ON DELETE CASCADE,
    kc_id TEXT NOT NULL,
    difficulty INTEGER NOT NULL,
    stem TEXT NOT NULL,
    options_json TEXT NOT NULL,
    answer_index INTEGER NOT NULL,
    explanation TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    checks_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (direction_id, content_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_direction_items_kc ON direction_items(direction_id, kc_id)`,
  /*
   * 用户自配的供应商密钥。
   *
   * 只存密文：secret_ct / secret_iv / secret_tag 是 AES-256-GCM 的三个部分，
   * secret_kid 记录加密时的密钥版本，secret_hint 是给界面看的掩码（不还原明文）。
   * options_json 只放白名单里的非敏感字段；apiKey / extraHeaders 一律进密文。
   *
   * secret_ct 允许空串：TTS 的浏览器语音模式没有密钥，此时三个密文字段都为空，
   * 表示「这一行没有需要加密的内容」，而不是「加密失败」。
   */
  `CREATE TABLE IF NOT EXISTS user_secrets (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    api TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    options_json TEXT NOT NULL DEFAULT '{}',
    secret_ct TEXT NOT NULL DEFAULT '',
    secret_iv TEXT NOT NULL DEFAULT '',
    secret_tag TEXT NOT NULL DEFAULT '',
    secret_kid TEXT NOT NULL,
    secret_hint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, kind)
  )`,
  /*
   * 知识库文档与片段（服务端同步副本）。
   *
   * 片段用复合外键指向文档：Postgres 侧删文档会自动删片段，
   * 内存实现必须在 kb_docs 的 DELETE 分支里手动做同样的事。
   * embedding 存 JSON 数组文本而不是 vector 类型：本项目不引入 pgvector 扩展，
   * 向量检索在应用层做（vector.ts），维度由 embedding_dim 校验。
   */
  `CREATE TABLE IF NOT EXISTS kb_docs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL,
    direction_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    size BIGINT NOT NULL,
    page_count INTEGER NOT NULL,
    char_count INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    kc_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, doc_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kb_docs_direction ON kb_docs(user_id, direction_id)`,
  /*
   * 跨设备删除标记：删除文档/方向时留下 tombstone，PUT 事务末尾用它撤掉
   * 与删除并发的在途写入（删除赢），防止已删除的文档被旧设备「复活」。
   * deleted_at 恒为毫秒数字符串，复活守卫按 ::numeric 比较。
   */
  `CREATE TABLE IF NOT EXISTS kb_tombstones (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_id TEXT NOT NULL,
    direction_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (user_id, doc_id)
  )`,
  `CREATE TABLE IF NOT EXISTS kb_chunks (
    user_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    direction_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    title TEXT NOT NULL,
    section TEXT NOT NULL,
    page_from INTEGER,
    page_to INTEGER,
    text TEXT NOT NULL,
    embedding TEXT,
    embedding_model TEXT,
    embedding_dim INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, chunk_id),
    FOREIGN KEY (user_id, doc_id) REFERENCES kb_docs(user_id, doc_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_kb_chunks_direction ON kb_chunks(user_id, direction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kb_chunks_direction_chunk ON kb_chunks(user_id, direction_id, chunk_id)`,
  `CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(user_id, doc_id)`,
  /*
   * pgvector 窄表：只承载 512 维本地嵌入（bge-small-zh），1024/1536 维外部
   * 嵌入继续走 kb_chunks.embedding 的 TEXT 列 + 应用层余弦（vector.ts）。
   *
   * 不存 direction_id：方向过滤靠 JOIN kb_chunks（见 KB_VECTOR_SQL.byDirection）。
   * 窄表而不是给 kb_chunks 加列：不动热表、删表即回滚，TEXT 列仍是唯一真相。
   *
   * vec 依赖 vector 扩展：ensureSchema 在建表前单独 try/catch 创建扩展，
   * 扩展不可用时跳过这一条语句，其余表照建——向量是可选能力，不能让应用起不来。
   * 默认查询走精确扫描，因此这里不建 HNSW 索引（规模上去后另行评估）。
   */
  `CREATE TABLE IF NOT EXISTS kb_chunk_vectors (
    user_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    model TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vec vector(512) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, chunk_id, model),
    FOREIGN KEY (user_id, chunk_id) REFERENCES kb_chunks(user_id, chunk_id) ON DELETE CASCADE
  )`,
  /*
   * 用户自建的 MCP 服务器。
   *
   * 鉴权头与其他密钥一样只存密文：auth_ct/auth_iv/auth_tag 是 AES-256-GCM 的
   * 三个部分，auth_kid 记录加密时的密钥版本，auth_hint 是给界面看的掩码。
   * 公开服务器没有鉴权头，此时四个密文字段为空串（不是「加密失败」）。
   * allowed_tools_json 是用户勾选的工具白名单，与代码内只读集合、tools/list 取交集。
   */
  `CREATE TABLE IF NOT EXISTS mcp_servers (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    server_id TEXT NOT NULL,
    label TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    allowed_tools_json TEXT NOT NULL DEFAULT '[]',
    auth_ct TEXT NOT NULL DEFAULT '',
    auth_iv TEXT NOT NULL DEFAULT '',
    auth_tag TEXT NOT NULL DEFAULT '',
    auth_kid TEXT NOT NULL DEFAULT '',
    auth_hint TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, server_id)
  )`,
  /*
   * 记忆卡。payload 是整张卡的 JSON：错题与易混字段差异较大，
   * 但读取时统一走 memory.ts 的 parseMemories 清洗，列只保留查询与容量需要的维度。
   */
  `CREATE TABLE IF NOT EXISTS memories (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mem_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    kc_id TEXT NOT NULL,
    with_kc_id TEXT,
    question_id TEXT,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, mem_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(user_id, subject_id)`,
];

/**
 * pgvector 扩展的启用语句。
 *
 * 必须是**单独一条**：扩展不存在或数据库用户没有 CREATE EXTENSION 权限时，
 * 只让这一条失败，不能拖垮后面的建表。db/migrations/0001_capability.sql
 * 里的同一条语句必须与它逐字一致（db.test.ts 有一致性断言）。
 */
export const PGVECTOR_EXTENSION = `CREATE EXTENSION IF NOT EXISTS vector`;

/** 依赖 pgvector 的建表语句：扩展不可用时整条跳过，其余表照建。 */
const VECTOR_DEPENDENT = /kb_chunk_vectors/i;

/** 已经告警过的键。同一种故障只刷一次日志，避免每次 getDb 都刷屏。 */
const warned = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 尝试启用 pgvector，返回扩展是否可用。
 *
 * 三种失败都走 catch：扩展没装、用户没有建扩展权限、后端是内存实现
 * （它不认 CREATE EXTENSION，但会返回 0 而不是抛错）。失败时只告警一次并
 * 返回 false——向量检索是可选能力，不能因为扩展装不上就让整个应用起不来。
 */
async function ensureVectorExtension(db: Db): Promise<boolean> {
  try {
    await db.run(PGVECTOR_EXTENSION);
    return true;
  } catch (err) {
    warnOnce(
      "pgvector-extension",
      `[db] pgvector 扩展不可用，跳过 kb_chunk_vectors（向量检索退回应用层余弦）：${errorText(err)}`,
    );
    return false;
  }
}

async function ensureSchema(db: Db): Promise<void> {
  const vectorReady = await ensureVectorExtension(db);

  for (const stmt of SCHEMA) {
    const vectorDependent = VECTOR_DEPENDENT.test(stmt);
    if (vectorDependent && !vectorReady) continue;

    try {
      await db.run(stmt);
    } catch (err) {
      const msg = errorText(err);
      // 内存实现不认 CREATE TABLE，忽略即可
      if (/not supported|unrecognized|syntax/i.test(msg)) continue;

      if (vectorDependent) {
        // 扩展在、建表仍失败（版本/权限）：也只告警，不让应用起不来
        warnOnce("pgvector-table", `[db] kb_chunk_vectors 建表失败，向量检索不可用：${msg}`);
        continue;
      }

      // Postgres 的真实错误要暴露出来，否则建表失败会静默
      if (process.env.DATABASE_URL) throw err;
    }
  }
}

/**
 * 测试用：直接跑一遍建表流程，不经过 getDb 的单例缓存。
 *
 * 生产路径由 getDb() 首次调用触发；单独暴露它是为了用注入的 Db 验证
 * 「pgvector 不可用时跳过向量表、其余表照建」这一条不能靠真实 Postgres 覆盖的分支。
 */
export async function __ensureSchemaForTests(db: Db): Promise<void> {
  await ensureSchema(db);
}

/**
 * 测试用：重置内存库。不清 backendOverride——它是后端选择，不是库内容。
 * 同时清空「只告警一次」的记录，让降级告警的断言在用例之间互相隔离。
 */
export function __resetMemoryDbForTests(): void {
  cached = null;
  initialized = false;
  warned.clear();
}

/**
 * 测试用：强制 dbBackend() 的返回值，传 null 恢复按 DATABASE_URL 判定。
 *
 * 路由测试常用「内存 Db + dbBackend() 报 postgres」的组合验证写密钥的放行路径，
 * 因此它只影响 dbBackend()，真正返回哪个 Db 由 __setDbForTests 决定。
 */
export function __setDbBackendForTests(backend: DbBackend | null): void {
  backendOverride = backend;
}

/**
 * 测试用：注入一个 Db 实现，跳过建表。
 *
 * 用途是验证「调用方如何解释 run() 的返回值」，不依赖真实 Postgres。
 * 生产代码不应调用它。
 */
export function __setDbForTests(db: Db): void {
  cached = db;
  initialized = true;
}
