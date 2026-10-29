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
  const directions = new Map<string, Record<string, unknown>>();
  /** key = `${direction_id}|${content_hash}`，对应 Postgres 的唯一约束。 */
  const directionItems = new Map<string, Record<string, unknown>>();
  /** 以下四张表的 key 都对应 Postgres 的复合主键，用 `|` 拼接。 */
  const userSecrets = new Map<string, Record<string, unknown>>();
  const kbDocs = new Map<string, Record<string, unknown>>();
  const kbChunks = new Map<string, Record<string, unknown>>();
  const memories = new Map<string, Record<string, unknown>>();

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
        return upsertRow(kbDocs, q, params, "kb_docs", ["user_id", "doc_id"], (row) =>
          `${row.user_id}|${row.doc_id}`,
        );
      }

      if (q.startsWith("insert into kb_chunks")) {
        return upsertRow(kbChunks, q, params, "kb_chunks", ["user_id", "chunk_id"], (row) =>
          `${row.user_id}|${row.chunk_id}`,
        );
      }

      if (q.startsWith("insert into memories")) {
        return upsertRow(memories, q, params, "memories", ["user_id", "mem_id"], (row) =>
          `${row.user_id}|${row.mem_id}`,
        );
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
       * kb_docs 的两种删除形状：
       *   - (user_id, doc_id)：删一篇文档，并级联删它的全部片段；
       *   - (user_id, direction_id)：删一个方向的全部文档与片段。
       * 先判 doc_id：`direction_id =` 不含 `doc_id =`，但反过来判定顺序错会把
       * 「删一篇」误当成「删整个方向」——多删比少删更难恢复。
       * 级联在 Postgres 侧由 kb_chunks 的复合外键 ON DELETE CASCADE 完成，这里手动模拟。
       */
      if (q.startsWith("delete from kb_docs")) {
        const user_id = params[0] as string;
        let n = 0;

        if (q.includes("doc_id =")) {
          const doc_id = params[1] as string;
          if (kbDocs.delete(`${user_id}|${doc_id}`)) n += 1;
          for (const [key, row] of kbChunks) {
            if (row.user_id === user_id && row.doc_id === doc_id) kbChunks.delete(key);
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
              kbChunks.delete(key);
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
          return kbChunks.delete(`${user_id}|${params[1]}`) ? 1 : 0;
        }

        if (q.includes("doc_id =")) {
          const doc_id = params[1] as string;
          for (const [key, row] of kbChunks) {
            if (row.user_id === user_id && row.doc_id === doc_id) {
              kbChunks.delete(key);
              n += 1;
            }
          }
          return n;
        }

        if (q.includes("direction_id =")) {
          const direction_id = params[1] as string;
          for (const [key, row] of kbChunks) {
            if (row.user_id === user_id && row.direction_id === direction_id) {
              kbChunks.delete(key);
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

    async all<T>(text: string, params: unknown[] = []) {
      const q = norm(text);

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
        if (q.includes("doc_id =")) {
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

    async one<T>(text: string, params: unknown[] = []) {
      const q = norm(text);

      // 必须放在 from users 之前：`from user_secrets` 也含 `user` 前缀
      if (q.includes("from user_secrets") && q.includes("kind =")) {
        const found = userSecrets.get(`${params[0]}|${params[1]}`);
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

/** 测试用：重置内存库。不清 backendOverride——它是后端选择，不是库内容。 */
export function __resetMemoryDbForTests(): void {
  cached = null;
  initialized = false;
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
