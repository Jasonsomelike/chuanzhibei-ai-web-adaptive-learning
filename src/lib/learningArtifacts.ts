/** Owner-scoped durable checkpoints. Revisions also serve as short processing leases. */
import type { Db } from "./db";
export const ARTIFACT_SCHEMA = `CREATE TABLE IF NOT EXISTS learning_artifacts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
  revision INTEGER NOT NULL, touched BIGINT NOT NULL,
  PRIMARY KEY (user_id, namespace, id)
)`;
export const ARTIFACT_SQL = {
  get: "SELECT * FROM learning_artifacts WHERE user_id = $1 AND namespace = $2 AND id = $3",
  list: "SELECT * FROM learning_artifacts WHERE user_id = $1 AND namespace = $2 ORDER BY id",
  keys: "SELECT id FROM learning_artifacts WHERE user_id = $1 AND namespace = $2 ORDER BY id",
  batch:
    "SELECT * FROM learning_artifacts WHERE user_id = $1 AND namespace = $2 AND id = ANY($3::text[]) ORDER BY id",
  put: `INSERT INTO learning_artifacts (user_id, namespace, id, data, revision, touched)
    VALUES ($1,$2,$3,$4,0,$6) ON CONFLICT (user_id, namespace, id)
    DO UPDATE SET data = EXCLUDED.data, revision = learning_artifacts.revision + 1, touched = EXCLUDED.touched
    WHERE learning_artifacts.revision = $5`,
  remove:
    "DELETE FROM learning_artifacts WHERE user_id = $1 AND namespace = $2 AND id = $3",
  expire:
    "DELETE FROM learning_artifacts WHERE user_id = $1 AND namespace = $2 AND touched < $3",
} as const;
export interface ArtifactRow {
  user_id: string;
  namespace: string;
  id: string;
  data: string;
  revision: number;
  touched: number;
}
export async function readArtifact<T>(
  db: Db,
  user: string,
  ns: string,
  id: string,
): Promise<{ value: T; revision: number; touched: number } | null> {
  const row = await db.one<ArtifactRow>(ARTIFACT_SQL.get, [user, ns, id]);
  return row
    ? {
        value: JSON.parse(row.data) as T,
        revision: row.revision,
        touched: Number(row.touched),
      }
    : null;
}
export function writeArtifact(
  db: Db,
  user: string,
  ns: string,
  id: string,
  value: unknown,
  revision: number | null,
) {
  return db.run(ARTIFACT_SQL.put, [
    user,
    ns,
    id,
    JSON.stringify(value),
    revision,
    Date.now(),
  ]);
}
export function createArtifactMemory() {
  const rows = new Map<string, ArtifactRow>();
  const key = (p: unknown[]) => JSON.stringify(p.slice(0, 3));
  return {
    run(sql: string, p: unknown[]): number | undefined {
      if (sql === ARTIFACT_SQL.put) {
        const old = rows.get(key(p));
        if (old && old.revision !== p[4]) return 0;
        rows.set(key(p), {
          user_id: String(p[0]),
          namespace: String(p[1]),
          id: String(p[2]),
          data: String(p[3]),
          revision: old ? old.revision + 1 : 0,
          touched: Number(p[5]),
        });
        return 1;
      }
      if (sql === ARTIFACT_SQL.remove) return rows.delete(key(p)) ? 1 : 0;
      if (sql === ARTIFACT_SQL.expire) {
        let n = 0;
        for (const [k, r] of rows)
          if (
            r.user_id === p[0] &&
            r.namespace === p[1] &&
            r.touched < Number(p[2])
          ) {
            rows.delete(k);
            n++;
          }
        return n;
      }
      return undefined;
    },
    all(sql: string, p: unknown[]): ArtifactRow[] | undefined {
      if (sql === ARTIFACT_SQL.get) {
        const r = rows.get(key(p));
        return r ? [r] : [];
      }
      if (sql === ARTIFACT_SQL.list)
        return [...rows.values()]
          .filter((r) => r.user_id === p[0] && r.namespace === p[1])
          .sort((a, b) => a.id.localeCompare(b.id));
      if (sql === ARTIFACT_SQL.keys || sql === ARTIFACT_SQL.batch)
        return [...rows.values()]
          .filter(
            (r) =>
              r.user_id === p[0] &&
              r.namespace === p[1] &&
              (sql !== ARTIFACT_SQL.batch || (p[2] as string[]).includes(r.id)),
          )
          .sort((a, b) => a.id.localeCompare(b.id));
      return undefined;
    },
  };
}
