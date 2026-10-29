/**
 * /api/memories：账号级记忆卡同步。
 *
 * GET    ?subjectId=            → {subjectId, memories}
 * PUT    {subjectId, memories}  → LWW upsert，返回 {stored, skippedStale}
 * DELETE ?memId= | ?subjectId=  → 显式删除，返回 {deleted}
 *
 * PUT 只 upsert，绝不删除不在列表里的卡：删除必须是用户明确操作，
 * 否则一台离线设备提交旧快照就会静默清空另一台刚复习过的卡。
 */

import { NextResponse } from "next/server";

import { apiErrorCodes, memoriesPut } from "@/lib/apiContracts";
import { getDb } from "@/lib/db";
import {
  MAX_MEMORIES_PUT_BYTES,
  deleteMemory,
  deleteSubjectMemories,
  listMemories,
  putMemories,
  validateMemoriesPayload,
} from "@/lib/memoryServer";
import { assertMutationOrigin, jsonError, readLimitedText, requireApiUser } from "@/lib/routeAuth";

export const runtime = "nodejs";

const SUBJECT_ID = /^[a-z0-9][a-z0-9-]*$/u;
const MEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function validSubjectId(value: string): boolean {
  return value.length > 0 && value.length <= 64 && SUBJECT_ID.test(value);
}

function validMemId(value: string): boolean {
  return value.length > 0 && value.length <= 120 && MEM_ID.test(value);
}

function param(request: Request, name: string): string {
  return (new URL(request.url).searchParams.get(name) ?? "").trim();
}

export async function GET(request: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const subjectId = param(request, "subjectId");
  if (!validSubjectId(subjectId)) {
    return jsonError(400, apiErrorCodes.badRequest, "缺少或非法的 subjectId");
  }

  const db = await getDb();
  const memories = await listMemories(db, guard.user.id, subjectId);
  return NextResponse.json({ subjectId, memories });
}

export async function PUT(request: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const origin = assertMutationOrigin(request);
  if (origin !== null) return origin;

  const contentType = (request.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return jsonError(415, apiErrorCodes.badRequest, "请求体必须是 application/json");
  }

  const body = await readLimitedText(request, MAX_MEMORIES_PUT_BYTES);
  if (!body.ok) return body.response;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.text);
  } catch {
    return jsonError(400, apiErrorCodes.badRequest, "请求体不是合法 JSON");
  }

  /*
   * 契约先于清洗：strictObject 拒绝未知字段与重复 id，避免客户端把
   * 将来才有的字段塞进来；parseMemories 再负责截断与丢弃坏记录。
   */
  const contract = memoriesPut.safeParse(parsed);
  if (!contract.success) {
    return jsonError(400, apiErrorCodes.badRequest, "记忆卡请求体不符合契约");
  }

  const payload = validateMemoriesPayload(contract.data);
  if (!payload.ok) {
    return jsonError(400, apiErrorCodes.badRequest, payload.error);
  }

  const db = await getDb();
  const result = await putMemories(db, guard.user.id, payload.subjectId, payload.memories);
  return NextResponse.json({
    subjectId: payload.subjectId,
    stored: result.stored,
    skippedStale: result.skippedStale,
  });
}

export async function DELETE(request: Request) {
  const guard = await requireApiUser();
  if (!guard.ok) return guard.response;

  const origin = assertMutationOrigin(request);
  if (origin !== null) return origin;

  const memId = param(request, "memId");
  const subjectId = param(request, "subjectId");

  if (memId !== "" && subjectId !== "") {
    return jsonError(400, apiErrorCodes.badRequest, "memId 与 subjectId 只能提供一个");
  }
  if (memId === "" && subjectId === "") {
    return jsonError(400, apiErrorCodes.badRequest, "缺少 memId 或 subjectId");
  }
  if (memId !== "" && !validMemId(memId)) {
    return jsonError(400, apiErrorCodes.badRequest, "memId 不合法");
  }
  if (subjectId !== "" && !validSubjectId(subjectId)) {
    return jsonError(400, apiErrorCodes.badRequest, "subjectId 不合法");
  }

  const db = await getDb();
  const deleted =
    memId !== ""
      ? await deleteMemory(db, guard.user.id, memId)
      : await deleteSubjectMemories(db, guard.user.id, subjectId);

  return NextResponse.json({ deleted });
}
