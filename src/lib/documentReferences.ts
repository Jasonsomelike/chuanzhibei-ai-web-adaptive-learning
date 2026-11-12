/** Lightweight provenance validation, shared by archive/retrieval routes without loading OCR. */
import type { Db } from "./db";
import type { DocumentReference } from "./documentContracts";
import { ARTIFACT_SQL, type ArtifactRow } from "./learningArtifacts";
import { listDirectionDocs } from "./kbServer";
export class DocumentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function validateDocumentReferences(
  db: Db,
  user: string,
  target: string,
  ids: readonly string[],
) {
  const refs: DocumentReference[] = [];
  if (!ids.length) return refs;
  const [entries, docs] = await Promise.all([
    db.all<ArtifactRow>(ARTIFACT_SQL.batch, [
      user,
      "document-imports",
      [...new Set(ids)],
    ]),
    listDirectionDocs(db, user, target),
  ]);
  for (const id of [...new Set(ids)]) {
    const entry = entries.find((row) => row.id === id);
    if (!entry) throw new DocumentError(404, "附件不存在或不属于当前账号。");
    const job = JSON.parse(entry.data) as {
      targetId: string;
      status: string;
      document?: DocumentReference;
    };
    const doc = docs.find((d) => d.id === id);
    if (
      job.targetId !== target ||
      job.status !== "ready" ||
      !job.document ||
      !doc ||
      doc.directionId !== target
    )
      throw new DocumentError(409, "附件尚未就绪、已删除或不属于当前课程。");
    refs.push(job.document);
  }
  return refs;
}
