import type { Db } from "./db";
import { buildUploadIndex, retrieveUploads } from "./knowledge";
import { rowToChunk, type KbChunkRow } from "./kbServer";
import { validateDocumentReferences } from "./documentReferences";
import {
  budgetUploadHits,
  contextBudget,
  type ContextBudgetConfig,
} from "./contextBudget";
export async function retrieveDocuments(
  db: Db,
  user: string,
  target: string,
  query: string,
  ids: readonly string[],
  config: ContextBudgetConfig = {},
  occupiedTokens = 0,
) {
  const documents = await validateDocumentReferences(db, user, target, ids);
  const rows = await db.all<KbChunkRow>(
    `SELECT user_id, chunk_id, doc_id, direction_id, idx, title, section, page_from, page_to, text, updated_at FROM kb_chunks WHERE user_id = $1 AND direction_id = $2${ids.length ? " AND doc_id = ANY($3::text[])" : ""} ORDER BY doc_id, idx`,
    [user, target, ...(ids.length ? [ids] : [])],
  );
  const all = rows.map(rowToChunk);
  const chunks = ids.length ? all.filter((c) => ids.includes(c.docId)) : all;
  const topK = Math.min(
    100,
    Math.max(3, Math.ceil(contextBudget(config).retrieval / 200)),
  );
  let ranked = retrieveUploads(buildUploadIndex(chunks), chunks, query, topK);
  let notice: string | undefined;
  if (
    !ranked.length &&
    ids.length &&
    /总结|概括|梳理|文档|附件|讲义|资料|全文|大意|摘要/u.test(query)
  ) {
    ranked = documents.flatMap((d) => {
      const group = chunks
        .filter((c) => c.docId === d.id)
        .sort((a, b) => a.index - b.index);
      return [...new Set([0, Math.floor(group.length / 2), group.length - 1])]
        .map((index) => group[index])
        .filter((c) => c !== undefined)
        .map((chunk) => ({ chunk, score: 0 }));
    });
    notice = "本轮选取文档代表性片段概览，未覆盖全文；可围绕具体章节继续检索。";
  }
  const seen = new Set<string>();
  ranked = ranked.filter((hit) => {
    const text = hit.chunk.text.trim();
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
  return {
    ...budgetUploadHits(ranked, config, occupiedTokens),
    documents,
    ...(notice ? { notice } : {}),
  };
}
