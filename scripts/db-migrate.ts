/**
 * 数据库迁移执行器。
 *
 * 用法：
 *   npx tsx scripts/db-migrate.ts             # 执行 db/migrations/*.sql 中未应用的文件
 *   npx tsx scripts/db-migrate.ts --dry-run   # 只列出将要执行的迁移，不写库
 *   npx tsx scripts/db-migrate.ts --help
 *
 * 规则（对应 ADR 评审问题 4 的结论）：
 *   - 文件名即版本号：按文件名排序执行，已应用的文件记在
 *     schema_migrations(filename, applied_at)，只按文件名判定，不按内容哈希；
 *   - 每个文件在**一个事务**里执行：文件里的语句与 schema_migrations 的写入同生共死，
 *     中途失败整文件回滚，不会留下「表建了一半、却记成已应用」的状态；
 *   - 禁止 CREATE INDEX CONCURRENTLY：它在事务块里会直接报错，而本执行器就是
 *     一个文件一个事务。新表为空时也用不上 CONCURRENTLY；
 *   - 没有 DATABASE_URL 时打印「未配置数据库」并以 0 退出——CI 里没有库不算失败，
 *     但也不会假装迁移成功。
 *
 * 连接走 @neondatabase/serverless 的 HTTP 驱动，与 src/lib/db.ts 一致。
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/** db/migrations/ 的绝对路径。用 import.meta.url 定位，从任何 cwd 运行都指向同一目录。 */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations/", import.meta.url));

/** 迁移账本。filename 是主键；applied_at 只用于审计。 */
export const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/**
 * 把一个 .sql 文件切成独立语句。
 *
 * 只处理本项目会写的 SQL 子集：行注释、块注释、单引号字符串（'' 转义）与
 * 美元引用（$$...$$ / $tag$...$tag$）。不做完整的 SQL 解析——真需要
 * 存储过程或 DO 块时再补，而不是在这里假装支持。
 */
export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed.length > 0) statements.push(trimmed);
    current = "";
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    // 行注释：-- 到行尾，替换成一个空格以免把前后 token 粘在一起
    if (ch === "-" && next === "-") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
      current += " ";
      continue;
    }

    // 块注释：/* ... */（Postgres 支持嵌套，本项目不用）
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      current += " ";
      continue;
    }

    // 单引号字符串整体消费：里面的 ; 与 -- 都不是语法符号
    if (ch === "'") {
      current += ch;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "'" && source[j + 1] === "'") {
          current += "''";
          j += 2;
          continue;
        }
        current += source[j];
        if (source[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }

    // 美元引用：$tag$ ... $tag$；`$1` 这类参数占位符不匹配（没有闭合的 $）
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(source.slice(i));
      if (tag !== null) {
        const marker = tag[0];
        const end = source.indexOf(marker, i + marker.length);
        const stop = end === -1 ? source.length : end + marker.length;
        current += source.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (ch === ";") {
      flush();
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  flush();
  return statements;
}

/** 待执行 = 本地文件里有、账本里没有；按文件名排序。 */
export function pendingMigrations(
  all: readonly string[],
  applied: readonly string[],
): string[] {
  const done = new Set(applied);
  return [...all].sort().filter((file) => !done.has(file));
}

/**
 * 拒绝 CONCURRENTLY。
 *
 * 本执行器把每个文件放进一个显式事务，PostgreSQL 明确禁止在事务块里执行
 * CREATE INDEX CONCURRENTLY；静默跳过会让「索引没建」被记成「已迁移」。
 */
export function assertNoConcurrently(filename: string, statements: readonly string[]): void {
  for (const statement of statements) {
    if (/\bconcurrently\b/i.test(statement)) {
      throw new Error(
        `${filename} 含 CONCURRENTLY：迁移在事务里执行，CONCURRENTLY 会被 PostgreSQL 拒绝；请去掉后重跑`,
      );
    }
  }
}

export interface MigrationPlan {
  file: string;
  statements: string[];
}

/**
 * 读出待执行迁移及其语句。目录不存在、读文件失败、含 CONCURRENTLY 都在这里抛错，
 * 保证 dry-run 也能看到真实的阻断项（而不是连库后才发现）。
 */
export function loadPendingMigrations(
  dir: string,
  applied: readonly string[],
): MigrationPlan[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw new Error(`读不到迁移目录 ${dir}：${errorText(err)}`);
  }

  const files = entries.filter((entry) => entry.endsWith(".sql")).sort();
  return pendingMigrations(files, applied).map((file) => {
    const source = readFileSync(join(dir, file), "utf8");
    const statements = splitSqlStatements(source);
    assertNoConcurrently(file, statements);
    return { file, statements };
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 只打印 host/path，绝不回显连接串里的用户名与密码。 */
function describeTarget(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return "（连接串无法解析，已隐去）";
  }
}

/** 42P01 = undefined_table：账本还没建时，dry-run 不写库也要能继续。 */
function isUndefinedTable(err: unknown): boolean {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "42P01"
  ) {
    return true;
  }
  return /relation .* does not exist/i.test(errorText(err));
}

/** neon() 默认（非 arrayMode、非 fullResults）返回的查询函数类型。 */
type NeonSql = NeonQueryFunction<false, false>;

async function readApplied(sql: NeonSql): Promise<string[]> {
  try {
    const rows = (await sql.query(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => String(row.filename));
  } catch (err) {
    // 账本不存在 = 一个都没应用过；dry-run 下不建表
    if (isUndefinedTable(err)) return [];
    throw err;
  }
}

function printUsage(): void {
  console.log(`用法：
  tsx scripts/db-migrate.ts             执行 db/migrations/*.sql 中未应用的文件
  tsx scripts/db-migrate.ts --dry-run   只打印将要执行的迁移
  tsx scripts/db-migrate.ts --help      显示本帮助`);
}

async function main(argv: readonly string[]): Promise<number> {
  const unknown = argv.filter((arg) => arg !== "--dry-run" && arg !== "--help");
  if (unknown.length > 0) {
    console.error(`未知参数：${unknown.join(" ")}`);
    printUsage();
    return 1;
  }
  if (argv.includes("--help")) {
    printUsage();
    return 0;
  }
  const dryRun = argv.includes("--dry-run");

  /*
   * 只有 DATABASE_URL 完全未定义时才读 .env.local。
   * 显式传 `DATABASE_URL=`（本地只验证「未配置」分支）时不会被文件覆盖。
   */
  if (process.env.DATABASE_URL === undefined) {
    try {
      process.loadEnvFile(".env.local");
    } catch {
      // 文件不存在或运行环境不支持：变量也可能由 shell 直接提供
    }
  }

  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === "") {
    console.log("未配置数据库：DATABASE_URL 为空，跳过迁移。");
    return 0;
  }
  if (!url.startsWith("postgres")) {
    console.error("DATABASE_URL 不是 postgres 连接串，拒绝执行迁移。");
    return 1;
  }

  const sql = neon(url);
  const applied = await readApplied(sql);
  const plans = loadPendingMigrations(MIGRATIONS_DIR, applied);

  if (dryRun) {
    // 只打印，不建表、不写 schema_migrations、不执行任何迁移语句
    console.log(`dry-run：数据库 ${describeTarget(url)}，仅打印不执行。`);
    for (const plan of plans) {
      console.log(`将执行 ${plan.file}（${plan.statements.length} 条语句）`);
    }
    if (plans.length === 0) console.log("无待执行迁移。");
    return 0;
  }

  console.log(`数据库：${describeTarget(url)}`);
  console.log(`已应用 ${applied.length} 个迁移，待执行 ${plans.length} 个。`);

  if (plans.length === 0) {
    console.log("无待执行迁移。");
    return 0;
  }

  await sql.query(MIGRATIONS_TABLE_SQL);

  for (const plan of plans) {
    try {
      // 一个文件一个事务：DDL 与账本写入同生共死
      await sql.transaction([
        ...plan.statements.map((statement) => sql.query(statement)),
        sql.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [plan.file]),
      ]);
    } catch (err) {
      throw new Error(`${plan.file} 执行失败，该文件已回滚：${errorText(err)}`);
    }
    console.log(`已应用 ${plan.file}`);
  }

  return 0;
}

/** 只有被当作脚本直接执行时才跑 main；被测试 import 时不能碰环境变量或连库。 */
function invokedAsScript(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return /(^|[\\/])db-migrate\.(ts|mts|cts|js|mjs|cjs)$/.test(entry);
}

if (invokedAsScript()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(`迁移失败：${errorText(err)}`);
      process.exitCode = 1;
    });
}
