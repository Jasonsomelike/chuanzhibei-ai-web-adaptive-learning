import { z } from "zod";
import { dbBackend, getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/routeAuth";
import { archiveId, conversationMutation } from "@/lib/conversationContracts";
import { archiveFailure, archiveJson, archiveResponse } from "@/lib/conversationRoute";
import { branchConversation, createConversation, getConversation, listConversations, updateConversation } from "@/lib/conversationStore";

export const runtime = "nodejs";
const query = z.object({ id: archiveId.optional(), mode: z.enum(["active", "archived", "trash"]).optional(), q: z.string().max(100).regex(/^[^\u0000]*$/u).optional(), cursor: z.string().max(500).optional() });
export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const params = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const db = await getDb();
    const data = params.id ? { conversation: await getConversation(db, auth.user.id, params.id) } : await listConversations(db, auth.user.id, { mode: params.mode, query: params.q, cursor: params.cursor });
    return archiveResponse({ ...data, storage: dbBackend() === "postgres" ? "persistent" : "temporary" });
  } catch (error) { return archiveFailure(error); }
}
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const body = await archiveJson(request, 16 * 1024);
  if (!body.ok) return body.response;
  try {
    const data = conversationMutation.parse(body.data);
    const db = await getDb();
    const conversation = data.action === "create" ? await createConversation(db, auth.user.id, data.targetId, data.title)
      : data.action === "branch" ? await branchConversation(db, auth.user.id, data.id, data.messageId, data.title)
      : await updateConversation(db, auth.user.id, data);
    return archiveResponse({ conversation });
  } catch (error) { return archiveFailure(error); }
}
