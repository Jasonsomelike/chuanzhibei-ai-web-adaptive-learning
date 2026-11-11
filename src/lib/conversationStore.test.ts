import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { __resetMemoryDbForTests, __setDbBackendForTests, getDb, SCHEMA, type Db } from "./db";
import { CONVERSATION_SCHEMA, CONVERSATION_SQL } from "./conversationSql";
import { archiveContent, type ConversationSummary } from "./conversationContracts";
import { appendConversationTurn, branchConversation, claimConversationAgent, createConversation, getArchivedMessage, getConversation, interruptConversationMessage, listConversations, readConversationPage, saveConversationAgent, saveConversationAssessment, updateArchivedMessage, updateConversation } from "./conversationStore";
import type { WorkflowSnapshot } from "./learningWorkflowContracts";
import { base64BytesOfDataUrl } from "./image";

const insertUser = "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ($1, $2, $3, $4, $5)";
const imageUrl = "data:image/jpeg;base64,/9j/AA==";
const attachment = { id: "picture", name: "问题.jpg", dataUrl: imageUrl, bytes: base64BytesOfDataUrl(imageUrl), width: 1, height: 1, quality: .82 };
const snapshot = (): WorkflowSnapshot => ({ version: "learning-workflow-v1", runId: randomUUID(), targetId: "data-structures", intent: "practice", routeReason: "练习请求", focusKcId: "c09", focusName: "栈", budgetMinutes: 60, resumedTurns: 0, status: "awaiting_answer", persisted: true, stages: [], exercise: { questionId: "q1", kcId: "c09", stem: "检查后进先出", options: ["A", "B"], repeated: false } });

describe.each(["memory", "postgres"] as const)("完整会话存档 · %s", backend => {
  let db: Db;
  let postgres: PGlite | null = null;
  beforeAll(async () => {
    if (backend !== "postgres") return;
    postgres = new PGlite();
    await postgres.waitReady;
    const userSchema = SCHEMA.find(sql => sql.startsWith("CREATE TABLE IF NOT EXISTS users"))!;
    await postgres.exec([userSchema, ...CONVERSATION_SCHEMA].join(";\n"));
  }, 30_000);
  beforeEach(async () => {
    if (postgres) {
      await postgres.exec("TRUNCATE users CASCADE");
      const pg = postgres;
      db = { run: async (sql, params = []) => (await pg.query(sql, params)).affectedRows ?? 0,
        all: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows,
        one: async <T>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows[0] ?? null };
    } else { __setDbBackendForTests("memory"); __resetMemoryDbForTests(); db = await getDb(); }
    for (const id of ["alice", "bob"]) await db.run(insertUser, [id, `${id}@test.local`, "hash", id, "2026-11-10T00:00:00.000Z"]);
  });
  afterAll(async () => { await postgres?.close(); __setDbBackendForTests(null); });

  async function turn(conversation: ConversationSummary, question = "解释栈", answer = "完整讲解 [c09]") {
    const appended = await appendConversationTurn(db, "alice", { conversationId: conversation.id, revision: conversation.revision, user: { id: randomUUID(), content: { text: question, attachments: [attachment] } }, assistantId: randomUUID() });
    const message = await updateArchivedMessage(db, "alice", { conversationId: conversation.id, id: appended.assistant.id, revision: 0, content: archiveContent.parse({ text: answer, sources: ["教材·栈"], materialContext: "原文完整摘录", originals: [{ kcId: "c09", label: "教材·栈", text: "后进先出" }] }), state: "complete" });
    return { ...appended, assistant: message };
  }
  it("账号隔离，跨账号读写与分支都不能越权", async () => {
    const conversation = await createConversation(db, "alice", "data-structures");
    const saved = await turn(conversation);
    expect((await listConversations(db,"bob")).conversations).toEqual([]);
    await expect(getConversation(db,"bob",conversation.id)).rejects.toMatchObject({ status: 404 });
    await expect(readConversationPage(db,"bob",conversation.id)).rejects.toMatchObject({ status: 404 });
    await expect(branchConversation(db,"bob",conversation.id,saved.assistant.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateArchivedMessage(db,"bob", { conversationId: conversation.id, id: saved.assistant.id, revision: 1, content: { text: "改写" }, state: "complete" })).rejects.toMatchObject({ status: 404 });
    expect((await getArchivedMessage(db,"alice",conversation.id,saved.assistant.id)).content.text).toContain("完整讲解");
  });
  it("超过四轮的长问答、来源原文与图片分页完整恢复", async () => {
    let conversation = await createConversation(db,"alice","data-structures");
    for (let i = 0; i < 13; i++) conversation = (await turn(conversation, `第${i}问 ${"问题".repeat(1000)}`, `第${i}答 ${"讲解".repeat(3000)}`)).conversation;
    const loaded = [];
    let before: number | null | undefined;
    do { const page = await readConversationPage(db,"alice",conversation.id,before ?? undefined); loaded.unshift(...page.messages); before = page.before; } while (before);
    expect(loaded).toHaveLength(26);
    expect(loaded.map(message => message.seq)).toEqual(Array.from({ length: 26 },(_,i) => i+1));
    expect(loaded[0].content.text).toBe(`第0问 ${"问题".repeat(1000)}`);
    expect(loaded[1].content.text).toBe(`第0答 ${"讲解".repeat(3000)}`);
    expect(loaded[0].content.attachments).toEqual([attachment]);
    expect(loaded[1].content.originals?.[0].text).toBe("后进先出");
  });
  it("并发追加只有一方成功，消息对不会被拆开", async () => {
    const conversation = await createConversation(db,"alice","data-structures");
    const results = await Promise.allSettled([1,2].map(i => appendConversationTurn(db,"alice", { conversationId: conversation.id, revision: 0, user: { id: randomUUID(), content: { text: `并发${i}` } }, assistantId: randomUUID() })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect((await readConversationPage(db,"alice",conversation.id)).messages).toHaveLength(2);
    expect((await getConversation(db,"alice",conversation.id)).lastSeq).toBe(2);
  });
  it("追加重试幂等，重复消息标识不留下半轮或错误序号", async () => {
    const conversation = await createConversation(db,"alice","data-structures");
    const body = { conversationId: conversation.id, revision: 0, user: { id: randomUUID(), content: { text: "原问题" } }, assistantId: randomUUID() };
    const first = await appendConversationTurn(db,"alice",body);
    expect((await appendConversationTurn(db,"alice",body)).assistant.id).toBe(first.assistant.id);
    await expect(appendConversationTurn(db,"alice", { ...body, revision: 1, user: { id: randomUUID(), content: { text: "新问题" } } })).rejects.toThrow();
    expect((await getConversation(db,"alice",conversation.id)).lastSeq).toBe(2);
    expect((await readConversationPage(db,"alice",conversation.id)).messages).toHaveLength(2);
  });
  it("分支复制指定问答轮次的完整前缀，保留原会话和引用图片", async () => {
    const first = await turn(await createConversation(db,"alice","data-structures"),"第一问","第一答");
    const second = await turn(first.conversation,"第二问","第二答");
    await turn(second.conversation,"第三问","第三答");
    const original = await readConversationPage(db,"alice",first.conversation.id);
    const fork = await branchConversation(db,"alice",first.conversation.id,second.assistant.id);
    const prefix = (await readConversationPage(db,"alice",fork.id)).messages;
    expect(prefix).toHaveLength(4);
    expect(prefix.map(message => message.content)).toEqual(original.messages.slice(0,4).map(message => message.content));
    expect(prefix.every(message => message.inheritedFrom === first.conversation.id)).toBe(true);
    await expect(updateArchivedMessage(db,"alice", { conversationId: fork.id, id: prefix[1].id, revision: 0, content: { text: "改继承内容" }, state: "complete" })).rejects.toMatchObject({ status: 409 });
    await turn(fork,"分支追问","新分支回答");
    expect(await readConversationPage(db,"alice",first.conversation.id)).toEqual(original);
    expect(fork.parentMessageId).toBe(second.assistant.id);
  });
  it("进行中的回答不能被分支，不创建空壳分支", async () => {
    const conversation = await createConversation(db,"alice","data-structures");
    const saved = await appendConversationTurn(db,"alice", { conversationId: conversation.id, revision: 0, user: { id: randomUUID(), content: { text: "问题" } }, assistantId: randomUUID() });
    await expect(branchConversation(db,"alice",conversation.id,saved.assistant.id)).rejects.toMatchObject({ status: 409 });
    expect((await listConversations(db,"alice")).conversations).toHaveLength(1);
  });
  it("改名、置顶、归档和回收站使用版本检查且可恢复", async () => {
    const conversation = await createConversation(db,"alice","data-structures");
    const renamed = await updateConversation(db,"alice", { id: conversation.id, revision: 0, title: "栈与递归", pinned: true });
    expect((await listConversations(db,"alice",{query:"递归"})).conversations[0].id).toBe(conversation.id);
    await expect(updateConversation(db,"alice",{id: conversation.id,revision:0,title:"旧设备"})).rejects.toMatchObject({status:409});
    const archived = await updateConversation(db,"alice",{id:conversation.id,revision:renamed.revision,archived:true});
    expect((await listConversations(db,"alice")).conversations).toHaveLength(0);
    expect((await listConversations(db,"alice",{mode:"archived"})).conversations).toHaveLength(1);
    await expect(appendConversationTurn(db,"alice",{conversationId:conversation.id,revision:archived.revision,user:{id:randomUUID(),content:{text:"不应写入"}},assistantId:randomUUID()})).rejects.toMatchObject({status:409});
    const trashed = await updateConversation(db,"alice",{id:conversation.id,revision:archived.revision,trash:true});
    expect((await listConversations(db,"alice",{mode:"trash"})).conversations).toHaveLength(1);
    const restored = await updateConversation(db,"alice",{id:conversation.id,revision:trashed.revision,trash:false});
    expect(restored.archived).toBe(false);
    expect(restored.deletedAt).toBeNull();
  });
  it("客户端不能注入教学检查点；运行令牌与继承边界保护服务端证明", async () => {
    const conversation = await createConversation(db,"alice","data-structures");
    const saved = await appendConversationTurn(db,"alice",{conversationId:conversation.id,revision:0,user:{id:randomUUID(),content:{text:"给一道练习"}},assistantId:randomUUID()});
    const workflow = snapshot();
    await expect(updateArchivedMessage(db,"alice",{conversationId:conversation.id,id:saved.assistant.id,revision:0,content:{text:"伪造",workflow},state:"complete"})).rejects.toThrow();
    const claim = await claimConversationAgent(db,"alice",conversation.id,saved.assistant.id,"data-structures");
    await expect(claimConversationAgent(db,"alice",conversation.id,saved.assistant.id,"data-structures")).rejects.toMatchObject({status:409});
    expect(await saveConversationAgent(db,"alice",conversation.id,saved.assistant.id,"wrong-token",archiveContent.parse({text:"覆盖"}),null,"complete")).toBe(false);
    expect(await saveConversationAgent(db,"alice",conversation.id,saved.assistant.id,claim.token,archiveContent.parse({text:"课程错配"}),{workflow:{...workflow,targetId:"network"},assessment:null},"complete")).toBe(false);
    expect(await saveConversationAgent(db,"alice",conversation.id,saved.assistant.id,claim.token,archiveContent.parse({text:"真实教学回答"}),{workflow,assessment:null},"complete")).toBe(true);
    const proof = (await getArchivedMessage(db,"alice",conversation.id,saved.assistant.id)).proof;
    expect(proof?.workflow.runId).toBe(workflow.runId);
    const assessment = {runId:workflow.runId,questionId:"q1",selectedIndex:0,correct:true,answerIndex:0,explanation:"核对后的解析",counted:true,evidenceN:1,evidenceStatus:"有证据",duplicate:false,workflow:{...workflow,status:"complete" as const}};
    expect(await saveConversationAssessment(db,"alice",conversation.id,saved.assistant.id,{workflow:assessment.workflow,assessment})).toBe(true);
    expect(await saveConversationAgent(db,"alice",conversation.id,saved.assistant.id,claim.token,archiveContent.parse({text:"晚到的生成更新"}),{workflow,assessment:null},"complete")).toBe(true);
    expect((await getArchivedMessage(db,"alice",conversation.id,saved.assistant.id)).proof?.assessment).toEqual(assessment);
    expect(await saveConversationAssessment(db,"alice",conversation.id,saved.assistant.id,{workflow,assessment:null})).toBe(false);
    const fork = await branchConversation(db,"alice",conversation.id,saved.assistant.id);
    expect((await getArchivedMessage(db,"alice",fork.id,saved.assistant.id)).proof?.assessment).toEqual(assessment);
    expect(await saveConversationAssessment(db,"alice",fork.id,saved.assistant.id,{workflow,assessment:null})).toBe(false);
    expect((await getArchivedMessage(db,"alice",conversation.id,saved.assistant.id)).proof?.assessment?.explanation).toBe("核对后的解析");
  });
  it("停止使旧运行令牌失效；迟到回答不能覆盖已停止的轮次", async () => {
    const conversation = await createConversation(db,"alice","data-structures");
    const saved = await appendConversationTurn(db,"alice",{conversationId:conversation.id,revision:0,user:{id:randomUUID(),content:{text:"解释栈"}},assistantId:randomUUID()});
    const claim = await claimConversationAgent(db,"alice",conversation.id,saved.assistant.id,"data-structures");
    const stopped = await interruptConversationMessage(db,"alice",conversation.id,saved.assistant.id);
    expect(stopped.state).toBe("interrupted");
    expect(stopped.content.streaming).toBe(false);
    expect(await saveConversationAgent(db,"alice",conversation.id,saved.assistant.id,claim.token,archiveContent.parse({text:"迟到的回答"}),null,"complete")).toBe(false);
    const fork = await branchConversation(db,"alice",conversation.id,saved.assistant.id);
    expect((await getArchivedMessage(db,"alice",fork.id,saved.assistant.id)).state).toBe("interrupted");
  });
  it("分页对大内容按响应字节收窄，但不截断任何消息", async () => {
    let conversation = await createConversation(db,"alice","data-structures");
    for (let i=0;i<5;i++) conversation=(await turn(conversation,`问题${i}`,"讲".repeat(180_000))).conversation;
    const page=await readConversationPage(db,"alice",conversation.id);
    expect(page.before).not.toBeNull();
    expect(page.messages.length).toBeLessThan(10);
    expect(page.messages.filter(message=>message.role==="assistant").every(message=>message.content.text.length===180_000)).toBe(true);
  });
  it("参数化名称与问题不会执行 SQL，合法表情和转义文本完整保留", async () => {
    const conversation=await createConversation(db,"alice","data-structures","'); DROP TABLE users; --");
    const answer="😀 文字 \\u0000 与单引号 ' 都是内容";
    const saved=await turn(conversation,answer,answer);
    expect((await getArchivedMessage(db,"alice",conversation.id,saved.assistant.id)).content.text).toBe(answer);
    expect(await db.one("SELECT * FROM users WHERE id = $1",["alice"])).not.toBeNull();
    await expect(updateArchivedMessage(db,"alice",{conversationId:conversation.id,id:saved.assistant.id,revision:saved.assistant.revision,content:{text:"无效\u0000字符"},state:"complete"})).rejects.toThrow();
  });
  it("消息单独更新不会改写服务端证明或旧问答", async () => {
    const saved=await turn(await createConversation(db,"alice","data-structures"));
    const original=await getArchivedMessage(db,"alice",saved.conversation.id,saved.user.id);
    await expect(updateArchivedMessage(db,"alice",{conversationId:saved.conversation.id,id:saved.user.id,revision:0,content:{text:"重写问题"},state:"complete"})).rejects.toMatchObject({status:409});
    expect(await getArchivedMessage(db,"alice",saved.conversation.id,saved.user.id)).toEqual(original);
    expect((await db.all(CONVERSATION_SQL.messages,["bob",saved.conversation.id,Number.MAX_SAFE_INTEGER,20,2400*1024]))).toEqual([]);
  });
  it("会话列表使用包含所有排序字段的游标，不遗漏同时间记录", async () => {
    const expected = new Set<string>();
    for (let i=0;i<53;i++) {
      const conversation=await createConversation(db,"alice","data-structures",`会话 ${i}`);
      expected.add(conversation.id);
      if (i<3) await updateConversation(db,"alice",{id:conversation.id,revision:0,pinned:true});
    }
    const first=await listConversations(db,"alice");
    expect(first.conversations.slice(0,3).every(item=>item.pinned)).toBe(true);
    expect(first.conversations).toHaveLength(50);
    const second=await listConversations(db,"alice",{cursor:first.nextCursor!});
    expect(second.conversations).toHaveLength(3);
    expect(new Set([...first.conversations,...second.conversations].map(item=>item.id))).toEqual(expected);
    expect(second.nextCursor).toBeNull();
  });
});
