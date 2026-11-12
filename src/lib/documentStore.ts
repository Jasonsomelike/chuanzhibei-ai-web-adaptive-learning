import { createHash } from "node:crypto";
import type { Db } from "./db";
import {
  ARTIFACT_SQL,
  readArtifact,
  writeArtifact,
  type ArtifactRow,
} from "./learningArtifacts";
import {
  chunkBlocks,
  MAX_FILE_CHARS,
  MAX_DIRECTION_CHUNKS,
  MAX_DIRECTION_CHARS,
  type TextBlock,
  type UploadChunk,
  type UploadDoc,
} from "./knowledge";
import { chunkToRow, docToRow, getKbDoc, listDirectionDocs } from "./kbServer";
import {
  DOCUMENT_PART_BYTES,
  type DocumentProgress,
  type DocumentReference,
} from "./documentContracts";
import { parseDocumentPages } from "./documentParser";
import { DOCUMENT_PUBLISH_SQL } from "./documentSql";
interface ImportJob {
  id: string;
  targetId: string;
  name: string;
  size: number;
  sha256: string;
  status: DocumentProgress["status"];
  next: number;
  pageCount: number;
  ocrPages: number;
  blocks: TextBlock[];
  leaseUntil: number;
  error?: string;
  document?: DocumentReference;
}
const ns = "document-imports";
const parts = (id: string) => `document-parts:${id}`;
import { DocumentError } from "./documentReferences";
export {
  DocumentError,
  validateDocumentReferences,
} from "./documentReferences";
function idFor(target: string, hash: string) {
  const h = createHash("sha256").update(`${target}:${hash}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function rawParts(db: Db, user: string, id: string) {
  return db.all<{ id: string }>(ARTIFACT_SQL.keys, [user, parts(id)]);
}
async function response(
  db: Db,
  user: string,
  job: ImportJob,
  reused = false,
): Promise<DocumentProgress> {
  const rows =
    job.status === "uploading" ? await rawParts(db, user, job.id) : [];
  return {
    id: job.id,
    status: job.status,
    received: rows.map((r) => Number(r.id)),
    pagesDone: job.next,
    pageCount: job.pageCount,
    ocrPages: job.ocrPages,
    ...(job.document ? { document: job.document } : {}),
    ...(job.error ? { error: job.error } : {}),
    reused,
  };
}
export async function createDocumentImport(
  db: Db,
  user: string,
  input: { targetId: string; name: string; size: number; sha256: string },
) {
  if (!/\.(pdf|md|txt)$/iu.test(input.name))
    throw new DocumentError(400, "支持 PDF、Markdown 和 TXT 文件。");
  const id = idFor(input.targetId, input.sha256);
  const existing = await readArtifact<ImportJob>(db, user, ns, id);
  if (existing && existing.value.status !== "failed") {
    if (existing.value.status !== "ready" || (await getKbDoc(db, user, id)))
      return response(db, user, existing.value, true);
  }
  // Remove expired temporary bytes when this account next imports. Ready metadata stays for deduplication.
  const old = await db.all<ArtifactRow>(ARTIFACT_SQL.list, [user, ns]);
  const active = old
    .filter((r) => r.id !== id && Number(r.touched) > Date.now() - 86400_000)
    .map((r) => JSON.parse(r.data) as ImportJob)
    .filter((j) => j.status === "uploading" || j.status === "processing");
  if (
    active.length >= 8 ||
    active.reduce((n, j) => n + j.size, 0) + input.size > 256 * 1024 * 1024
  )
    throw new DocumentError(429, "待处理附件较多，请先完成已有上传。");
  for (const row of old)
    if (Number(row.touched) < Date.now() - 86400_000) {
      await db.run(ARTIFACT_SQL.expire, [
        user,
        parts(row.id),
        Date.now() - 86400_000,
      ]);
    }
  const job: ImportJob = {
    ...input,
    id,
    status: "uploading",
    next: 0,
    pageCount: 0,
    ocrPages: 0,
    blocks: [],
    leaseUntil: 0,
  };
  const claimed = await writeArtifact(
    db,
    user,
    ns,
    id,
    job,
    existing?.revision ?? null,
  );
  if (!claimed)
    return response(db, user, (await jobFor(db, user, id)).value, true);
  if (existing) {
    const stale = await rawParts(db, user, id);
    for (const row of stale)
      await db.run(ARTIFACT_SQL.remove, [user, parts(id), row.id]);
  }
  return response(db, user, job);
}
async function jobFor(db: Db, user: string, id: string) {
  const job = await readArtifact<ImportJob>(db, user, ns, id);
  if (!job) throw new DocumentError(404, "附件不存在或不属于当前账号。");
  return job;
}
export async function putDocumentPart(
  db: Db,
  user: string,
  id: string,
  index: number,
  data: string,
) {
  const { value: job } = await jobFor(db, user, id);
  if (job.status !== "uploading") return response(db, user, job);
  const expected = Math.min(
    DOCUMENT_PART_BYTES,
    job.size - index * DOCUMENT_PART_BYTES,
  );
  const bytes = Buffer.from(data, "base64");
  if (
    expected <= 0 ||
    bytes.length !== expected ||
    bytes.toString("base64") !== data
  )
    throw new DocumentError(400, "文件分片长度或编码不正确。");
  const old = await readArtifact<string>(db, user, parts(id), String(index));
  if (old && old.value !== data)
    throw new DocumentError(409, "同一文件分片内容不一致，请重新选择文件。");
  if (!old) await writeArtifact(db, user, parts(id), String(index), data, null);
  return response(db, user, job);
}
export async function processDocumentImport(
  db: Db,
  user: string,
  id: string,
  parser = parseDocumentPages,
): Promise<DocumentProgress> {
  const entry = await jobFor(db, user, id);
  let job = entry.value;
  if (
    job.status === "ready" ||
    job.status === "failed" ||
    job.leaseUntil > Date.now()
  )
    return response(db, user, job);
  const rows = await rawParts(db, user, id);
  if (rows.length !== Math.ceil(job.size / DOCUMENT_PART_BYTES))
    throw new DocumentError(
      409,
      "文件还未上传完整，可重新选择同一文件继续上传。",
    );
  const buffers: Buffer[] = [];
  const ordered = rows.sort((a, b) => Number(a.id) - Number(b.id));
  // Bound each database response too: a 64MB binary is ~85MB in base64.
  for (let offset = 0; offset < ordered.length; offset += 8) {
    const batch = await db.all<ArtifactRow>(ARTIFACT_SQL.batch, [
      user,
      parts(id),
      ordered.slice(offset, offset + 8).map((r) => r.id),
    ]);
    buffers.push(
      ...batch
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map((r) => Buffer.from(JSON.parse(r.data) as string, "base64")),
    );
  }
  const bytes = Buffer.concat(buffers);
  if (
    bytes.length !== job.size ||
    createHash("sha256").update(bytes).digest("hex") !== job.sha256
  ) {
    const message = "文件校验失败，未解析或写入知识库。请重新选择原文件重试。";
    await writeArtifact(
      db,
      user,
      ns,
      id,
      { ...job, status: "failed", leaseUntil: 0, error: message },
      entry.revision,
    );
    throw new DocumentError(422, message);
  }
  if (
    !(await writeArtifact(
      db,
      user,
      ns,
      id,
      { ...job, status: "processing", leaseUntil: Date.now() + 180_000 },
      entry.revision,
    ))
  )
    return response(db, user, (await jobFor(db, user, id)).value);
  const revision = entry.revision + 1;
  try {
    const parsed = await parser(bytes, job.name, job.next);
    const blocks = [...job.blocks, ...parsed.blocks];
    const charCount = blocks.reduce((n, b) => n + Array.from(b.text).length, 0);
    if (charCount > MAX_FILE_CHARS)
      throw new Error(
        `正文超过 ${MAX_FILE_CHARS} 字的服务端安全上限，未截断导入。`,
      );
    job = {
      ...job,
      blocks,
      next: parsed.next,
      pageCount: parsed.pageCount,
      ocrPages: job.ocrPages + parsed.ocrPages,
      status: "processing",
      leaseUntil: 0,
    };
    if (parsed.next === parsed.pageCount) {
      const drafts = chunkBlocks(blocks);
      if (!drafts.length)
        throw new Error(
          "文本解析和扫描页 OCR 后仍未识别到文字，请提供更清晰的文件。",
        );
      const otherDocs = (
        await listDirectionDocs(db, user, job.targetId)
      ).filter((d) => d.id !== id);
      if (
        otherDocs.reduce((n, d) => n + d.charCount, 0) + charCount >
          MAX_DIRECTION_CHARS ||
        otherDocs.reduce((n, d) => n + d.chunkCount, 0) + drafts.length >
          MAX_DIRECTION_CHUNKS
      )
        throw new Error(
          "当前课程资料已达到服务端安全容量，请先移除不再使用的资料。",
        );
      const now = Date.now();
      const doc: UploadDoc = {
        id,
        directionId: job.targetId,
        title: job.name,
        fileName: job.name,
        kind: /\.pdf$/iu.test(job.name)
          ? "pdf"
          : /\.md$/iu.test(job.name)
            ? "md"
            : "txt",
        size: job.size,
        ...(/\.pdf$/iu.test(job.name) ? { pageCount: job.pageCount } : {}),
        charCount,
        chunkCount: drafts.length,
        kcIds: [],
        createdAt: new Date(now).toISOString(),
        updatedAt: now,
      };
      const chunks: UploadChunk[] = drafts.map((draft, index) => ({
        ...draft,
        id: `${id}:${index}`,
        docId: id,
        directionId: job.targetId,
        title: job.name,
        index,
      }));
      // One SQL statement makes the completed document and all its chunks visible together.
      await db.run(DOCUMENT_PUBLISH_SQL, [
        JSON.stringify(docToRow(user, doc, now)),
        JSON.stringify(chunks.map((c) => chunkToRow(user, c, now))),
      ]);
      job = {
        ...job,
        status: "ready",
        blocks: [],
        document: {
          id,
          name: job.name,
          sha256: job.sha256,
          size: job.size,
          pageCount: doc.pageCount ?? 0,
          chunkCount: drafts.length,
          ocrPages: job.ocrPages,
        },
      };
    }
    if (!(await writeArtifact(db, user, ns, id, job, revision)))
      throw new DocumentError(409, "解析状态已更新，请重试。");
    if (job.status === "ready")
      for (const row of rows)
        await db.run(ARTIFACT_SQL.remove, [user, parts(id), row.id]);
    return response(db, user, job);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 250)
        : "附件解析失败，请重试。";
    await writeArtifact(
      db,
      user,
      ns,
      id,
      { ...job, status: "failed", leaseUntil: 0, error: message },
      revision,
    );
    throw new DocumentError(422, message);
  }
}
