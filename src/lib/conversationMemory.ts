/** Mirrors the named archive SQL statements for isolated local development and tests. */
import { CONVERSATION_SQL, type ConversationMessageRow, type ConversationRow } from "./conversationSql";

const normalize = (sql: string) => sql.replace(/\s+/gu, " ").trim().toLowerCase();
const statements = new Map(Object.entries(CONVERSATION_SQL).map(([name, sql]) => [normalize(sql), name]));
const key = (user: unknown, conversation: unknown, message?: unknown) => JSON.stringify([user, conversation, message]);
export function createConversationMemory(hasUser: (id: string) => boolean) {
  const conversations = new Map<string, ConversationRow>();
  const messages = new Map<string, ConversationMessageRow>();
  const active = (row: ConversationRow | undefined) => row && !row.deleted_at && !row.archived;
  return {
    run(sql: string, p: unknown[]): number | undefined {
      const action = statements.get(normalize(sql));
      if (!action) return undefined;
      const uid = String(p[0]), cid = String(p[1]);
      const meta = conversations.get(key(uid, cid));
      if (action === "create") {
        if (!hasUser(uid)) throw new Error("tutor_conversations foreign key violation");
        if (meta) throw new Error("duplicate conversation");
        conversations.set(key(uid, cid), { user_id: uid, id: cid, target_id: String(p[2]), target_name: String(p[3]), title: String(p[4]), pinned: false, archived: false, deleted_at: null, created_at: String(p[5]), updated_at: String(p[5]), revision: 0, last_seq: 0, parent_id: null, parent_message_id: null });
        return 1;
      }
      if (action === "update") {
        if (!meta || meta.revision !== p[2]) return 0;
        conversations.set(key(uid, cid), { ...meta, title: String(p[3]), pinned: p[4] === true, archived: p[5] === true, deleted_at: p[6] === null ? null : String(p[6]), updated_at: String(p[7]), revision: meta.revision + 1 });
        return 1;
      }
      if (action === "append") {
        if (!active(meta) || meta!.revision !== p[2]) return 0;
        const items = JSON.parse(String(p[4])) as { id: string; role: "user" | "assistant"; content: unknown; state: ConversationMessageRow["state"] }[];
        if (items.length !== 2 || new Set(items.map(item => item.id)).size !== 2 || items.some(item => messages.has(key(uid, cid, item.id)))) throw new Error("duplicate message");
        const base = meta!.last_seq;
        for (const [index, item] of items.entries()) messages.set(key(uid, cid, item.id), { user_id: uid, conversation_id: cid, id: item.id, seq: base + index + 1, role: item.role, data: JSON.stringify(item.content), state: item.state, proof: null, revision: 0, run_token: null, inherited_from: null, created_at: String(p[3]) });
        conversations.set(key(uid, cid), { ...meta!, last_seq: base + 2, revision: meta!.revision + 1, updated_at: String(p[3]), title: base === 0 && meta!.title === "新会话" ? String(p[5]) : meta!.title });
        return 2;
      }
      if (action === "branch") {
        const point = messages.get(key(uid, cid, p[2]));
        if (!meta || meta.deleted_at || !point || point.role !== "assistant" || point.state === "pending") return 0;
        const forkId = String(p[3]);
        if (conversations.has(key(uid, forkId))) throw new Error("duplicate branch");
        const prefix = [...messages.values()].filter(row => row.user_id === uid && row.conversation_id === cid && row.seq <= point.seq);
        conversations.set(key(uid, forkId), { ...meta, id: forkId, title: String(p[4]), pinned: false, archived: false, revision: 0, last_seq: point.seq, created_at: String(p[5]), updated_at: String(p[5]), parent_id: cid, parent_message_id: point.id });
        for (const row of prefix) messages.set(key(uid, forkId, row.id), { ...row, conversation_id: forkId, revision: 0, run_token: null, inherited_from: cid });
        return prefix.length;
      }
      const message = messages.get(key(uid, cid, p[2]));
      if (action === "updateMessage") {
        if (!active(meta) || !message || message.revision !== p[3] || message.role !== "assistant" || message.inherited_from || message.run_token && message.state === "pending") return 0;
        messages.set(key(uid, cid, p[2]), { ...message, data: String(p[4]), state: p[5] as ConversationMessageRow["state"], revision: message.revision + 1 });
        conversations.set(key(uid, cid), { ...meta!, updated_at: String(p[6]) });
        return 1;
      }
      if (action === "claimAgent") {
        if (!active(meta) || !message || message.role !== "assistant" || message.state !== "pending" || message.run_token || message.inherited_from || JSON.parse(message.data).text !== "") return 0;
        messages.set(key(uid, cid, p[2]), { ...message, run_token: String(p[3]), revision: message.revision + 1 });
        return 1;
      }
      if (action === "saveAgent") {
        const candidate = p[5] === null ? null : JSON.parse(String(p[5])) as { workflow: { targetId: string } };
        if (!meta || !message || message.run_token !== p[3] || message.inherited_from || message.state !== "pending" && p[6] === "pending" || candidate && candidate.workflow.targetId !== meta.target_id) return 0;
        const graded = message.proof && JSON.parse(message.proof).assessment != null;
        messages.set(key(uid, cid, p[2]), { ...message, data: String(p[4]), proof: graded ? message.proof : p[5] === null ? null : String(p[5]), state: graded ? "complete" : p[6] as ConversationMessageRow["state"], revision: message.revision + 1 });
        conversations.set(key(uid, cid), { ...meta, updated_at: String(p[7]) });
        return 1;
      }
      if (action === "saveAssessment") {
        const proof = message?.proof ? JSON.parse(message.proof) as { workflow: { runId: string }; assessment?: unknown } : null;
        if (!message || message.inherited_from || !proof || proof.workflow.runId !== p[3] || proof.assessment != null) return 0;
        messages.set(key(uid, cid, p[2]), { ...message, proof: String(p[4]), revision: message.revision + 1 });
        return 1;
      }
      return undefined;
    },
    all(sql: string, p: unknown[]): (ConversationRow | ConversationMessageRow)[] | undefined {
      const action = statements.get(normalize(sql));
      if (!action) return undefined;
      const uid = String(p[0]), cid = String(p[1]);
      if (action === "byId") { const row = conversations.get(key(uid, cid)); return row ? [{ ...row }] : []; }
      if (action === "message") { const row = messages.get(key(uid, cid, p[2])); return row ? [{ ...row }] : []; }
      if (action === "pair") return [...messages.values()].filter(row => row.user_id === uid && row.conversation_id === cid && (row.id === p[2] || row.id === p[3])).map(row => ({ ...row }));
      if (action === "messages") {
        let bytes = 0;
        return [...messages.values()].filter(row => row.user_id === uid && row.conversation_id === cid && row.seq < Number(p[2])).sort((a,b) => b.seq - a.seq).slice(0, Number(p[3])).filter((row,index) => {
          bytes += Buffer.byteLength(row.data, "utf8") + Buffer.byteLength(row.proof ?? "", "utf8") + 512;
          return bytes <= Number(p[4]) || index === 0;
        }).map(row => ({ ...row }));
      }
      if (action === "list") {
        return [...conversations.values()].filter(row => row.user_id === uid)
          .filter(row => p[1] === "trash" ? row.deleted_at !== null : row.deleted_at === null && row.archived === (p[1] === "archived"))
          .filter(row => !p[2] || row.title.toLocaleLowerCase().includes(String(p[2]).toLocaleLowerCase()))
          .filter(row => p[3] === null || Number(row.pinned) < Number(p[3]) || row.pinned === p[3] && (row.updated_at < String(p[4]) || row.updated_at === p[4] && row.id < String(p[5])))
          .sort((a,b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id))
          .slice(0, Number(p[6])).map(row => ({ ...row }));
      }
      return undefined;
    },
  };
}
