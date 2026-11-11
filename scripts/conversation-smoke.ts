/** Authenticated HTTP archive round-trip against the isolated local E2E server. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { request, type APIRequestContext } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3218";
assert(["localhost","127.0.0.1"].includes(new URL(base).hostname), "会话测试只允许隔离的本机服务");
let checks = 0;
function check(condition: unknown, label: string) { assert(condition,label); checks++; console.log(`PASS ${label}`); }
const contexts: APIRequestContext[] = [];
async function client(name: string) {
  const context = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
  contexts.push(context);
  const response = await context.post("/api/auth", { data: { action: "register", email: `${name}-${randomUUID()}@test.local`, password: `T3-${randomBytes(24).toString("base64url")}`, displayName: "会话回归" } });
  check(response.ok(), "隔离环境注册会话测试账号");
  return context;
}
try {
  const alice = await client("archive-a"), bob = await client("archive-b");
  const created = await alice.post("/api/conversations",{data:{action:"create",targetId:"data-structures"}});
  check(created.ok(),"已登录账号可创建课程会话");
  let conversation = (await created.json()).conversation;
  const originalId = conversation.id;
  const rounds: { id: string }[] = [];
  const picture = { id:"fixture",name:"问题.jpg",dataUrl:"data:image/jpeg;base64,/9j/AA==",bytes:4,width:1,height:1,quality:.82 };
  for (let i=0;i<6;i++) {
    const response = await alice.post("/api/conversations/messages",{data:{conversationId:originalId,revision:conversation.revision,user:{id:randomUUID(),content:{text:`第${i}问 `+"保留完整提问".repeat(200),attachments:[picture]}},assistantId:randomUUID()}});
    assert(response.ok()); const data=await response.json(); conversation=data.conversation;
    const saved=await alice.put("/api/conversations/messages",{data:{conversationId:originalId,id:data.assistant.id,revision:0,content:{text:`第${i}答 `+"保留完整答复".repeat(500),sources:["教材·原文"],originals:[{kcId:"c09",label:"教材·原文",text:"后进先出的原始引用内容"}]},state:"complete"}});
    assert(saved.ok()); rounds.push((await saved.json()).message);
  }
  const anotherDevice=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base},storageState:await alice.storageState()});
  contexts.push(anotherDevice);
  const read=await anotherDevice.get(`/api/conversations/messages?conversationId=${originalId}`);
  const original=await read.json();
  check(read.ok()&&original.messages.length===12,"另一浏览器会话完整恢复六轮问答，超过旧版四轮上限");
  check(original.messages[0].content.text===`第0问 `+"保留完整提问".repeat(200),"跨设备保留完整较早提问");
  check(original.messages[1].content.text===`第0答 `+"保留完整答复".repeat(500),"跨设备答复不按旧长度截断");
  check(original.messages[0].content.attachments[0].dataUrl===picture.dataUrl&&original.messages[1].content.originals[0].text==="后进先出的原始引用内容","上传图片与引用原文按快照恢复");
  const branched=await anotherDevice.post("/api/conversations",{data:{action:"branch",id:originalId,messageId:rounds[1].id}});
  check(branched.ok(),"可从指定第二轮问答创建分支");
  const fork=(await branched.json()).conversation;
  const inherited=await (await alice.get(`/api/conversations/messages?conversationId=${fork.id}`)).json();
  check(inherited.messages.length===4&&inherited.messages.every((message:{inheritedFrom:string})=>message.inheritedFrom===originalId),"分支只继承所选轮次之前的完整前缀");
  const altered=await alice.put("/api/conversations/messages",{data:{conversationId:fork.id,id:rounds[0].id,revision:0,content:{text:"不能改写继承记录"},state:"complete"}});
  check(altered.status()===409,"继承的问答不可改写");
  const continued=await alice.post("/api/conversations/messages",{data:{conversationId:fork.id,revision:fork.revision,user:{id:randomUUID(),content:{text:"在新分支继续提问"}},assistantId:randomUUID()}});
  check(continued.ok(),"分支可以独立追加新轮次");
  const unchanged=await (await anotherDevice.get(`/api/conversations/messages?conversationId=${originalId}`)).json();
  check(JSON.stringify(original)===JSON.stringify(unchanged),"分支操作和继续提问保持原会话不变");
  check((await bob.get(`/api/conversations/messages?conversationId=${originalId}`)).status()===404,"其他账号不能读取历史或图片");
  check((await bob.post("/api/conversations",{data:{action:"branch",id:originalId,messageId:rounds[1].id}})).status()===404,"其他账号不能复制私有会话");
  const forged=await alice.put("/api/conversations/messages",{data:{conversationId:originalId,id:rounds[0].id,revision:1,content:{text:"伪造",workflow:{persisted:true}},state:"complete"}});
  check(forged.status()===400,"HTTP 接口拒绝客户端伪造教学证明");
  for (const change of [{title:"可检索的栈与递归",pinned:true},{archived:true},{trash:true},{trash:false}]) {
    const response=await alice.post("/api/conversations",{data:{action:"update",id:originalId,revision:conversation.revision,...change}});
    assert(response.ok()); conversation=(await response.json()).conversation;
  }
  const found=await (await anotherDevice.get("/api/conversations?q=栈与递归")).json();
  check(found.conversations.length===1&&found.conversations[0].pinned&&!found.conversations[0].archived,"改名、置顶、归档及回收站恢复可跨设备读取");
  const anonymous=await request.newContext({baseURL:base}); contexts.push(anonymous);
  check((await anonymous.get("/api/conversations")).status()===401,"匿名浏览器不能读取账号会话");
  const crossSite=await alice.post("/api/conversations",{headers:{Origin:"https://unrelated.example"},data:{action:"update",id:originalId,revision:conversation.revision,title:"跨站写入"}});
  check(crossSite.status()===403,"跨站页面不能修改历史会话");
  console.log(`${checks} 项会话 HTTP 回归通过`);
} finally { await Promise.all(contexts.map(context=>context.dispose())); }
