export const DOCUMENT_PUBLISH_SQL = `WITH doc AS (
 INSERT INTO kb_docs SELECT * FROM jsonb_populate_record(NULL::kb_docs, $1::jsonb)
 ON CONFLICT (user_id, doc_id) DO NOTHING RETURNING doc_id
) INSERT INTO kb_chunks SELECT c.* FROM jsonb_populate_recordset(NULL::kb_chunks, $2::jsonb) c
 WHERE EXISTS (SELECT 1 FROM doc) ON CONFLICT (user_id, chunk_id) DO NOTHING`;
