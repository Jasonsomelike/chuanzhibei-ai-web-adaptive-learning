import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireApiUser } from "@/lib/routeAuth";
import { ARCHIVE_BODY_BYTES, archiveId } from "@/lib/conversationContracts";
import { archiveFailure, archiveJson, archiveResponse } from "@/lib/conversationRoute";
import { appendConversationTurn, getArchivedMessage, readConversationPage, updateArchivedMessage } from "@/lib/conversationStore";

export const runtime = "nodejs";
const query = z.object({ conversationId: archiveId, messageId: archiveId.optional(), before: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() });
export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  try {
    const params = query.parse(Object.fromEntries(new URL(request.url).searchParams));
    const db = await getDb();
    return archiveResponse(params.messageId ? { message: await getArchivedMessage(db, auth.user.id, params.conversationId, params.messageId) }
      : await readConversationPage(db, auth.user.id, params.conversationId, params.before));
  } catch (error) { return archiveFailure(error); }
}
export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const body = await archiveJson(request, ARCHIVE_BODY_BYTES);
  if (!body.ok) return body.response;
  try { return archiveResponse(await appendConversationTurn(await getDb(), auth.user.id, body.data)); }
  catch (error) { return archiveFailure(error); }
}
export async function PUT(request: Request) {
  const auth = await requireApiUser();
  if (!auth.ok) return auth.response;
  const body = await archiveJson(request, ARCHIVE_BODY_BYTES);
  if (!body.ok) return body.response;
  try { return archiveResponse({ message: await updateArchivedMessage(await getDb(), auth.user.id, body.data) }); }
  catch (error) { return archiveFailure(error); }
}
