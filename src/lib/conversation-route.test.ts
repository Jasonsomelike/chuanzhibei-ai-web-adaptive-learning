import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { __resetMemoryDbForTests, __setDbBackendForTests, getDb } from "./db";
import { ARCHIVE_BODY_BYTES } from "./conversationContracts";
import * as conversations from "../../app/api/conversations/route";
import * as messages from "../../app/api/conversations/messages/route";

const auth = vi.hoisted(() => ({ id: "alice" as string | null }));
vi.mock("@/lib/routeAuth", async importOriginal => ({
  ...await importOriginal<typeof import("./routeAuth")>(),
  requireApiUser: async () => auth.id ? { ok: true, user: { id: auth.id, email: `${auth.id}@test.local`, displayName: auth.id } }
    : { ok: false, response: Response.json({ error: "请先登录" }, { status: 401, headers: { "Cache-Control": "no-store" } }) },
}));
const base = "http://localhost:3218";
function request(path: string, method = "GET", data?: unknown, origin = base) {
  return new Request(`${base}${path}`, { method, ...(data === undefined ? {} : { headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(data) }) });
}
beforeEach(async () => {
  auth.id = "alice";
  __setDbBackendForTests("memory"); __resetMemoryDbForTests();
  const db = await getDb();
  for (const id of ["alice", "bob"]) await db.run("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)",[id,`${id}@test.local`,"hash",id,"2026-11-10T00:00:00.000Z"]);
});
afterEach(() => { __setDbBackendForTests(null); vi.restoreAllMocks(); });
async function create() {
  const response = await conversations.POST(request("/api/conversations","POST",{action:"create",targetId:"data-structures"}));
  expect(response.status).toBe(200);
  return (await response.json()).conversation as { id: string; revision: number };
}

describe("完整会话 API", () => {
  it("所有读取和写入要求登录", async () => {
    auth.id = null;
    for (const [handler, req] of [
      [conversations.GET,request("/api/conversations")],
      [conversations.POST,request("/api/conversations","POST",{action:"create",targetId:"data-structures"})],
      [messages.GET,request(`/api/conversations/messages?conversationId=${randomUUID()}`)],
      [messages.POST,request("/api/conversations/messages","POST",{})],
      [messages.PUT,request("/api/conversations/messages","PUT",{})],
      [messages.PATCH,request("/api/conversations/messages","PATCH",{})],
    ] as const) expect((await handler(req)).status).toBe(401);
  });
  it("拒绝跨站写入、非 JSON 和格式错误，记录不受影响", async () => {
    const response = await conversations.POST(request("/api/conversations","POST",{action:"create",targetId:"data-structures"},"https://unrelated.example"));
    expect(response.status).toBe(403);
    expect((await conversations.POST(new Request(`${base}/api/conversations`,{method:"POST",headers:{Origin:base},body:"text"}))).status).toBe(415);
    expect((await conversations.POST(new Request(`${base}/api/conversations`,{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:"{"}))).status).toBe(400);
    expect((await (await conversations.GET(request("/api/conversations"))).json()).conversations).toHaveLength(0);
  });
  it("创建、完整消息恢复与服务端同步能力如实返回，响应不缓存", async () => {
    const conversation=await create();
    const body={conversationId:conversation.id,revision:0,user:{id:randomUUID(),content:{text:"一个超过旧版长度的提问 "+"内容".repeat(1000)}},assistantId:randomUUID()};
    const appended=await messages.POST(request("/api/conversations/messages","POST",body));
    expect(appended.status).toBe(200);
    expect((await messages.PUT(request("/api/conversations/messages","PUT",{conversationId:conversation.id,id:body.assistantId,revision:0,content:{text:"完整答复 "+"讲解".repeat(2000)},state:"complete"}))).status).toBe(200);
    const response=await messages.GET(request(`/api/conversations/messages?conversationId=${conversation.id}`));
    const data=await response.json();
    expect(data.messages.map((message:{content:{text:string}})=>message.content.text)).toEqual([body.user.content.text,"完整答复 "+"讲解".repeat(2000)]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    const list=await (await conversations.GET(request("/api/conversations"))).json();
    expect(list.storage).toBe("temporary");
    expect(list.conversations[0].lastSeq).toBe(2);
  });
  it("账号由会话决定，不能通过请求参数指定另一位用户", async () => {
    const conversation=await create();
    auth.id="bob";
    expect((await conversations.GET(request(`/api/conversations?id=${conversation.id}&userId=alice`))).status).toBe(404);
    expect((await messages.GET(request(`/api/conversations/messages?conversationId=${conversation.id}&userId=alice`))).status).toBe(404);
    expect((await conversations.POST(request("/api/conversations","POST",{action:"update",id:conversation.id,revision:0,title:"越权"}))).status).toBe(404);
    const list=await (await conversations.GET(request("/api/conversations?userId=alice"))).json();
    expect(list.conversations).toEqual([]);
  });
  it("不接受伪造的工作流、判分或历史身份", async () => {
    const conversation=await create();
    for (const forged of [{workflow:{persisted:true}},{proof:{assessment:{correct:true}}},{role:"system"}]) {
      const response=await messages.POST(request("/api/conversations/messages","POST",{conversationId:conversation.id,revision:0,user:{id:randomUUID(),content:{text:"问题",...forged}},assistantId:randomUUID()}));
      expect(response.status).toBe(400);
    }
    const page=await (await messages.GET(request(`/api/conversations/messages?conversationId=${conversation.id}`))).json();
    expect(page.messages).toHaveLength(0);
  });
  it("限制真实请求体字节，不信任较小的 Content-Length", async () => {
    const req=new Request(`${base}/api/conversations/messages`,{method:"POST",headers:{Origin:base,"Content-Type":"application/json","Content-Length":"10"},body:JSON.stringify({text:"大".repeat(Math.ceil(ARCHIVE_BODY_BYTES/2))})});
    expect((await messages.POST(req)).status).toBe(413);
  });
  it("分页及动作参数错误返回 400，不退回其他会话", async () => {
    expect((await conversations.GET(request("/api/conversations?cursor=invalid"))).status).toBe(400);
    expect((await messages.GET(request("/api/conversations/messages?conversationId=unknown"))).status).toBe(400);
    expect((await messages.GET(request(`/api/conversations/messages?conversationId=${randomUUID()}&before=-1`))).status).toBe(400);
    expect((await conversations.POST(request("/api/conversations","POST",{action:"create",targetId:"data-structures",userId:"bob"}))).status).toBe(400);
  });
});
