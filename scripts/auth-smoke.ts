/**
 * 认证、账号配置与方向市场的端到端测试。
 *
 * 验证真实的服务端行为，不是界面渲染：
 *   - 注册 → 会话生效 → 取当前用户
 *   - 重复注册被拒
 *   - 登录 / 错误密码 / 登出
 *   - 进度按用户隔离
 *   - 未登录时读配置、服务端代发、写知识库与记忆卡一律 401
 *   - 登录后 PUT /api/config 加密保存（缺主密钥时 503）→ GET 只回掩码 → DELETE
 *   - PUT / GET / DELETE /api/kb 往返
 *   - 记忆卡 LWW：旧卡不会覆盖新卡
 *   - 创建方向 → 公开 → 出现在市场 → 另一个用户复制
 *   - 未登录不能创建、不能看私有方向
 *
 * 运行：BASE_URL=http://127.0.0.1:3218 npx tsx scripts/auth-smoke.ts
 */

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3218";

export {};

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

/** 带 Cookie 的简易客户端，模拟一个浏览器会话。 */
function client() {
  let cookie = "";

  return {
    async fetch(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      if (cookie) headers.set("Cookie", cookie);
      /*
       * 服务端对写请求做同源校验（origin.ts）：不带 Origin 的写请求一律 403。
       * 脚本没有浏览器上下文，用 BASE 自己当来源，等价于同源页面发起的请求。
       */
      headers.set("Origin", BASE);
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      /*
       * 线上跑时偶发 undici 的 ConnectTimeoutError（本机网络/代理抖动），
       * 与站点无关。重试三次，仍失败才抛，避免把网络抖动当成功能缺陷。
       */
      let res: Response | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      if (!res) throw lastErr;

      // Node 的 fetch 把多个 Set-Cookie 折叠成一个逗号分隔的串，
      // 这里按 alp_session 单独提取，避免解析整串。
      const raw =
        res.headers.getSetCookie?.() ??
        (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);

      for (const c of raw) {
        const m = /alp_session=([^;,\s]*)/.exec(c);
        if (m) {
          cookie = m[1] === "" ? "" : `alp_session=${m[1]}`;
        }
      }
      return res;
    },
    clearCookie() {
      cookie = "";
    },
  };
}

const stamp = Date.now();
const userA = { email: `alice${stamp}@test.local`, password: "test1234", displayName: "Alice" };
const userB = { email: `bob${stamp}@test.local`, password: "test5678", displayName: "Bob" };

const a = client();
const b = client();
const anon = client();

// ── 1. 注册 ──
const regA = await a.fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "register", ...userA }),
});
const regAData = (await regA.json()) as { ok?: boolean; user?: { id: string; displayName: string }; error?: string };
check(
  "注册成功并返回用户",
  regA.ok && regAData.ok === true && regAData.user?.displayName === "Alice",
  regAData.user ? `id=${regAData.user.id.slice(0, 8)}` : regAData.error ?? "无响应",
);

// ── 2. 会话生效 ──
const meA = await a.fetch("/api/auth");
const meAData = (await meA.json()) as { user: { email: string } | null };
check("注册后会话立即生效", meAData.user?.email === userA.email, meAData.user?.email ?? "null");

// ── 3. 重复注册被拒 ──
const dup = await anon.fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "register", ...userA }),
});
const dupData = (await dup.json()) as { error?: string };
check(
  "重复邮箱注册被拒",
  !dup.ok && (dupData.error ?? "").includes("已注册"),
  `HTTP ${dup.status} · ${dupData.error}`,
);

// ── 4. 弱密码被拒 ──
const weak = await anon.fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "register", email: `weak${stamp}@t.local`, password: "abc", displayName: "W" }),
});
check("弱密码注册被拒", !weak.ok, `HTTP ${weak.status}`);

// ── 5. 未登录不能看进度 ──
const anonProgress = await anon.fetch("/api/progress");
check("未登录访问进度返回 401", anonProgress.status === 401, `HTTP ${anonProgress.status}`);

// ── 6. 写进度 ──
const writeProgress = await a.fetch("/api/progress", {
  method: "POST",
  body: JSON.stringify({
    subjectId: "data-structures",
    progress: { mastery: [{ kcId: "c01", alpha: 2, beta: 1, evidenceN: 1 }], attempts: [] },
  }),
});
check("登录后可写进度", writeProgress.ok, `HTTP ${writeProgress.status}`);

// ── 7. 读回进度 ──
const readProgress = await a.fetch("/api/progress");
const readData = (await readProgress.json()) as {
  progress?: Record<string, { mastery?: { kcId: string }[] }>;
};
check(
  "能读回刚写的进度",
  readData.progress?.["data-structures"]?.mastery?.[0]?.kcId === "c01",
  `学科数 ${Object.keys(readData.progress ?? {}).length}`,
);

// ── 8. 注册第二个用户，进度隔离 ──
await b.fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "register", ...userB }),
});
const bProgress = await b.fetch("/api/progress");
const bData = (await bProgress.json()) as { progress?: Record<string, unknown> };
check(
  "不同用户的进度互相隔离",
  Object.keys(bData.progress ?? {}).length === 0,
  `Bob 的学科数 ${Object.keys(bData.progress ?? {}).length}`,
);

// ── 9. 创建方向（规则拼装，不需要模型）──
const createRes = await a.fetch("/api/directions", {
  method: "POST",
  body: JSON.stringify({ description: "我想系统学一遍树结构", isPublic: true }),
});
const createData = (await createRes.json()) as {
  ok?: boolean;
  id?: string;
  source?: string;
  conceptCount?: number;
  error?: string;
  issues?: string[];
};
check(
  "创建方向成功（规则拼装）",
  createRes.ok && createData.ok === true && typeof createData.id === "string",
  createData.ok ? `${createData.conceptCount} 个知识点 · source=${createData.source}` : `${createData.error} ${(createData.issues ?? []).join(";")}`,
);

const directionId = createData.id ?? "";

// ── 10. 未登录不能创建 ──
const anonCreate = await anon.fetch("/api/directions", {
  method: "POST",
  body: JSON.stringify({ description: "树结构", isPublic: true }),
});
check("未登录不能创建方向", anonCreate.status === 401, `HTTP ${anonCreate.status}`);

// ── 11. 公开方向出现在市场 ──
const market = await anon.fetch("/api/directions?scope=market");
const marketData = (await market.json()) as { directions: { id: string; title: string }[] };
check(
  "公开方向出现在市场（未登录可见）",
  marketData.directions.some((d) => d.id === directionId),
  `市场共 ${marketData.directions.length} 个`,
);

// ── 12. 市场搜索 ──
const searched = await anon.fetch("/api/directions?scope=market&q=" + encodeURIComponent("树"));
const searchedData = (await searched.json()) as { directions: { id: string }[] };
check(
  "市场支持搜索",
  searchedData.directions.some((d) => d.id === directionId),
  `命中 ${searchedData.directions.length} 个`,
);

// ── 13. 我的方向（只返回自己的）──
const mineA = await a.fetch("/api/directions?scope=mine");
const mineAData = (await mineA.json()) as { directions: { id: string }[] };
const mineAList = mineAData.directions ?? [];
check(
  "「我的方向」只含自己的",
  mineAList.some((d) => d.id === directionId),
  `Alice 有 ${mineAList.length} 个`,
);

const mineB = await b.fetch("/api/directions?scope=mine");
const mineBData = (await mineB.json()) as { directions: { id: string }[] };
const mineBList = mineBData.directions ?? [];
check(
  "Bob 看不到 Alice 的私有列表",
  !mineBList.some((d) => d.id === directionId),
  `Bob 有 ${mineBList.length} 个`,
);

// ── 14. Bob 复制 Alice 的公开方向 ──
const copyRes = await b.fetch("/api/directions", {
  method: "POST",
  body: JSON.stringify({ copyFrom: directionId }),
});
const copyData = (await copyRes.json()) as { ok?: boolean; id?: string; error?: string };
check(
  "其他用户可复制公开方向",
  copyRes.ok && copyData.ok === true && copyData.id !== directionId,
  copyData.ok ? `新 id=${copyData.id?.slice(0, 8)}` : copyData.error,
);

// ── 15. 复制出的方向默认私有 ──
const marketAfter = await anon.fetch("/api/directions?scope=market");
const marketAfterData = (await marketAfter.json()) as { directions: { id: string }[] };
check(
  "副本默认不公开",
  !marketAfterData.directions.some((d) => d.id === copyData.id),
  "副本未出现在市场",
);

// ── 16. 只有作者能改 ──
const patchByB = await b.fetch("/api/directions", {
  method: "PATCH",
  body: JSON.stringify({ id: directionId, title: "被篡改" }),
});
check("非作者不能修改他人方向", patchByB.status === 403, `HTTP ${patchByB.status}`);

// ── 17. 作者可改公开状态 ──
const unpublish = await a.fetch("/api/directions", {
  method: "PATCH",
  body: JSON.stringify({ id: directionId, isPublic: false }),
});
const marketUnpub = await anon.fetch("/api/directions?scope=market");
const unpubData = (await marketUnpub.json()) as { directions: { id: string }[] };
check(
  "作者可设为私有，市场随即消失",
  unpublish.ok && !unpubData.directions.some((d) => d.id === directionId),
  `HTTP ${unpublish.status}`,
);

// ── 18. 非法方向被拒（生成接口）──
const badDraft = await a.fetch("/api/directions/generate", {
  method: "POST",
  body: JSON.stringify({
    description: "测试",
    rawModelOutput: JSON.stringify({
      title: "有环的图",
      description: "故意构造",
      concepts: [
        { id: "k1", name: "A", summary: "" },
        { id: "k2", name: "B", summary: "" },
        { id: "k3", name: "C", summary: "" },
        { id: "k4", name: "D", summary: "" },
        { id: "k5", name: "E", summary: "" },
      ],
      edges: [
        { before: "k1", after: "k2" },
        { before: "k2", after: "k1" },
      ],
    }),
  }),
});
const badData = (await badDraft.json()) as { error?: string; issues?: string[] };
check(
  "有环的图被校验拒绝",
  !badDraft.ok && (badData.issues ?? []).some((i) => i.includes("环")),
  `HTTP ${badDraft.status}`,
);

// ── 19. 登录 ──
const freshClient = client();
const loginRes = await freshClient.fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "login", email: userA.email, password: userA.password }),
});
check("已有账号可登录", loginRes.ok, `HTTP ${loginRes.status}`);

// ── 20. 错误密码 ──
const wrongPw = await client().fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "login", email: userA.email, password: "wrongpass1" }),
});
const wrongData = (await wrongPw.json()) as { error?: string };
check(
  "错误密码被拒且不泄露账号是否存在",
  wrongPw.status === 401 && (wrongData.error ?? "").includes("邮箱或密码"),
  wrongData.error ?? "",
);

// ── 21. 登出 ──
await freshClient.fetch("/api/auth", {
  method: "POST",
  body: JSON.stringify({ action: "logout" }),
});
const afterLogout = await freshClient.fetch("/api/auth");
const afterLogoutData = (await afterLogout.json()) as { user: unknown };
check("登出后会话失效", afterLogoutData.user === null, `user=${JSON.stringify(afterLogoutData.user)}`);

// ── 22. 未登录：读配置 / 服务端代发 / 写知识库与记忆卡一律 401 ──
const smokeDirectionId = `smoke-${stamp}`;
const smokeDocId = `smoke-doc-${stamp}`;
const smokeChunkId = `smoke-chunk-${stamp}`;
const nowIso = new Date(stamp).toISOString();
const smokeDoc = {
  id: smokeDocId,
  directionId: smokeDirectionId,
  title: "冒烟文档",
  fileName: "smoke.md",
  kind: "md" as const,
  size: 8,
  charCount: 8,
  chunkCount: 1,
  kcIds: [] as string[],
  createdAt: nowIso,
};
const smokeChunk = {
  id: smokeChunkId,
  docId: smokeDocId,
  directionId: smokeDirectionId,
  title: "冒烟",
  section: "",
  text: "栈是后进先出。",
  index: 0,
};

async function errorCodeOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown };
    if (typeof body.error === "object" && body.error !== null) {
      const nested = (body.error as { code?: unknown }).code;
      if (typeof nested === "string") return nested;
    }
    return typeof body.code === "string" ? body.code : "";
  } catch {
    return "";
  }
}

const anonConfig = await anon.fetch("/api/config");
check(
  "未登录 GET /api/config 返回 401",
  anonConfig.status === 401,
  `HTTP ${anonConfig.status} · ${await errorCodeOf(anonConfig)}`,
);

const anonChat = await anon.fetch("/api/llm/chat", {
  method: "POST",
  body: JSON.stringify({ messages: [{ role: "user", content: "你好" }], stream: false }),
});
check(
  "未登录 POST /api/llm/chat 返回 401（不代发）",
  anonChat.status === 401,
  `HTTP ${anonChat.status} · ${await errorCodeOf(anonChat)}`,
);

const anonKb = await anon.fetch("/api/kb", {
  method: "PUT",
  body: JSON.stringify({ doc: smokeDoc, chunks: [smokeChunk], baseUpdatedAt: null }),
});
check(
  "未登录 PUT /api/kb 返回 401",
  anonKb.status === 401,
  `HTTP ${anonKb.status} · ${await errorCodeOf(anonKb)}`,
);

const anonMemories = await anon.fetch("/api/memories", {
  method: "PUT",
  body: JSON.stringify({ subjectId: "data-structures", memories: [] }),
});
check(
  "未登录 PUT /api/memories 返回 401",
  anonMemories.status === 401,
  `HTTP ${anonMemories.status} · ${await errorCodeOf(anonMemories)}`,
);

// ── 23. 登录后 PUT /api/config：有主密钥则 200 + 掩码 + 删除，否则 503 ──
interface ConfigProbe {
  readonly res: Response;
  readonly text: string;
  readonly data: {
    config?: { configured?: boolean; hint?: string; baseUrl?: string; model?: string };
    error?: { code?: string; message?: string };
  } | null;
}

const smokeKey = `sk-smoke-${stamp}-0123456789abcdef`;

async function putLlmConfig(baseUrl: string): Promise<ConfigProbe> {
  const res = await a.fetch("/api/config", {
    method: "PUT",
    body: JSON.stringify({
      provider: "llm",
      label: "Smoke account config",
      kind: "openai-compatible",
      baseUrl,
      apiKey: smokeKey,
      model: "deepseek-chat",
    }),
  });
  const text = await res.text();
  return {
    res,
    text,
    data: JSON.parse(text || "null") as ConfigProbe["data"],
  };
}

let putConfig = await putLlmConfig("https://api.deepseek.com/v1");
let dnsNote = "";

/*
 * 部分 CI / 代理网络会把所有域名解析到 198.18/15（基准测试保留段），
 * 服务端的 SSRF 校验会据此拒绝真实域名。这不是配置保存逻辑的问题，
 * 用公网字面量地址再试一次，确保 200 / 503 分支真的被执行到。
 * 该地址只写入再删除，不会发任何请求。
 */
if (
  putConfig.res.status === 400 &&
  (putConfig.data?.error?.message ?? "").includes("上游地址不允许")
) {
  dnsNote = "（api.deepseek.com 在当前网络被解析到内网段，改用公网字面量地址复测）";
  console.log(`NOTE  ${dnsNote}`);
  putConfig = await putLlmConfig("https://1.1.1.1/v1");
}

const putConfigData = putConfig.data;
const putConfigCode = putConfigData?.error?.code ?? "";

if (putConfig.res.ok) {
  check(
    "登录后 PUT /api/config 加密保存成功",
    putConfigData?.config?.configured === true && putConfigData.config.model === "deepseek-chat",
    `HTTP ${putConfig.res.status} · hint=${putConfigData?.config?.hint ?? ""}${dnsNote}`,
  );

  const getConfig = await a.fetch("/api/config");
  const getConfigText = await getConfig.text();
  const getConfigData = JSON.parse(getConfigText || "null") as {
    config?: { llm?: { configured?: boolean; hint?: string } };
  } | null;
  check(
    "GET /api/config 只回掩码，响应里没有明文密钥",
    getConfig.ok &&
      getConfigData?.config?.llm?.configured === true &&
      (getConfigData.config.llm.hint ?? "") !== "" &&
      !getConfigText.includes(smokeKey),
    `hint=${getConfigData?.config?.llm?.hint ?? ""}`,
  );

  const delConfig = await a.fetch("/api/config?kind=llm", { method: "DELETE" });
  const delConfigData = (await delConfig.json().catch(() => null)) as {
    deleted?: boolean;
  } | null;
  const afterDel = await a.fetch("/api/config");
  const afterDelData = (await afterDel.json().catch(() => null)) as {
    config?: { llm?: { configured?: boolean } };
  } | null;
  check(
    "DELETE /api/config 后 llm 行回到未配置",
    delConfig.ok &&
      delConfigData?.deleted === true &&
      afterDelData?.config?.llm?.configured === false,
    `HTTP ${delConfig.status} · deleted=${String(delConfigData?.deleted)}`,
  );
} else {
  check(
    "未配置主密钥 / 持久化时拒绝写密钥（503）",
    putConfig.res.status === 503 &&
      (putConfigCode === "KEY_ENC_UNAVAILABLE" || putConfigCode === "PERSISTENCE_UNAVAILABLE"),
    `HTTP ${putConfig.res.status} · ${putConfigCode}${
      putConfigCode === "PERSISTENCE_UNAVAILABLE" ? "（内存后端，符合预期）" : ""
    }${dnsNote}${putConfigData?.error?.message ? ` · ${putConfigData.error.message}` : ""}`,
  );
}

// ── 24. PUT / GET / DELETE /api/kb 往返 ──
const putKb = await a.fetch("/api/kb", {
  method: "PUT",
  body: JSON.stringify({ doc: smokeDoc, chunks: [smokeChunk], baseUpdatedAt: null }),
});
check("PUT /api/kb 写入文档与片段", putKb.ok, `HTTP ${putKb.status} · ${await errorCodeOf(putKb)}`);

const getKb = await a.fetch(`/api/kb?directionId=${encodeURIComponent(smokeDirectionId)}`);
const getKbData = (await getKb.json().catch(() => null)) as {
  docs?: { id: string }[];
  chunks?: { id: string }[];
} | null;
check(
  "GET /api/kb 读回刚写的文档与片段",
  getKb.ok &&
    (getKbData?.docs ?? []).some((doc) => doc.id === smokeDocId) &&
    (getKbData?.chunks ?? []).some((chunk) => chunk.id === smokeChunkId),
  `docs=${getKbData?.docs?.length ?? 0} · chunks=${getKbData?.chunks?.length ?? 0}`,
);

const delKb = await a.fetch(`/api/kb?directionId=${encodeURIComponent(smokeDirectionId)}`, {
  method: "DELETE",
});
const delKbData = (await delKb.json().catch(() => null)) as {
  deletedDocs?: number;
  deletedChunks?: number;
} | null;
const getKbAfter = await a.fetch(`/api/kb?directionId=${encodeURIComponent(smokeDirectionId)}`);
const getKbAfterData = (await getKbAfter.json().catch(() => null)) as {
  docs?: unknown[];
  chunks?: unknown[];
} | null;
check(
  "DELETE /api/kb 按方向清空",
  delKb.ok &&
    (delKbData?.deletedDocs ?? 0) >= 1 &&
    (getKbAfterData?.docs?.length ?? -1) === 0,
  `deletedDocs=${delKbData?.deletedDocs ?? 0} · deletedChunks=${delKbData?.deletedChunks ?? 0}`,
);

// ── 25. 记忆卡 LWW：旧卡不会覆盖新卡 ──
const smokeMemId = `smoke-mem-${stamp}`;
const t0 = new Date(stamp - 60_000).toISOString();
const t1 = new Date(stamp - 30_000).toISOString();
const t2 = new Date(stamp).toISOString();
const oldCard = {
  id: smokeMemId,
  kind: "error" as const,
  kcId: "c01",
  questionId: "q-smoke",
  prompt: "旧卡",
  correction: "",
  createdAt: t0,
  lastSeenAt: t1,
  status: "open" as const,
  streak: 0,
  reviewCount: 1,
};
const newCard = { ...oldCard, prompt: "新卡", lastSeenAt: t2, reviewCount: 2 };

async function putMemories(card: typeof oldCard): Promise<Response> {
  return a.fetch("/api/memories", {
    method: "PUT",
    body: JSON.stringify({ subjectId: "data-structures", memories: [card] }),
  });
}

const putOld = await putMemories(oldCard);
const putOldData = (await putOld.json().catch(() => null)) as {
  stored?: number;
  skippedStale?: number;
} | null;
const putNew = await putMemories(newCard);
const putNewData = (await putNew.json().catch(() => null)) as {
  stored?: number;
  skippedStale?: number;
} | null;
const putStale = await putMemories(oldCard);
const putStaleData = (await putStale.json().catch(() => null)) as {
  stored?: number;
  skippedStale?: number;
} | null;

check(
  "PUT /api/memories 先写入旧卡再写入新卡",
  putOld.ok && putOldData?.stored === 1 && putNew.ok && putNewData?.stored === 1,
  `old stored=${putOldData?.stored ?? "?"} · new stored=${putNewData?.stored ?? "?"}`,
);
check(
  "旧卡不会覆盖新卡（skippedStale=1，且没有写入）",
  putStale.ok && putStaleData?.stored === 0 && putStaleData?.skippedStale === 1,
  `stored=${putStaleData?.stored ?? "?"} · skippedStale=${putStaleData?.skippedStale ?? "?"}`,
);

const getMemories = await a.fetch("/api/memories?subjectId=data-structures");
const getMemoriesData = (await getMemories.json().catch(() => null)) as {
  memories?: { id: string; prompt: string }[];
} | null;
check(
  "GET /api/memories 读回的是新卡",
  getMemories.ok && (getMemoriesData?.memories ?? []).some((item) => item.id === smokeMemId && item.prompt === "新卡"),
  `卡片数=${getMemoriesData?.memories?.length ?? 0}`,
);

const delMemories = await a.fetch("/api/memories?subjectId=data-structures", { method: "DELETE" });
const delMemoriesData = (await delMemories.json().catch(() => null)) as {
  deleted?: number;
} | null;
check(
  "DELETE /api/memories 清空该学科",
  delMemories.ok && (delMemoriesData?.deleted ?? 0) >= 1,
  `deleted=${delMemoriesData?.deleted ?? 0}`,
);

// ── 26. 清理：删掉测试创建的方向 ──
await a.fetch(`/api/directions?id=${encodeURIComponent(directionId)}`, { method: "DELETE" });
await b.fetch(`/api/directions?id=${encodeURIComponent(copyData.id ?? "")}`, { method: "DELETE" });

// An old account can enroll without registering again. Rotations invalidate
// earlier sessions and only the first successful reset consumes the proof.
const postAuth = (session: ReturnType<typeof client>, body: Record<string, unknown>) =>
  session.fetch("/api/auth", { method: "POST", body: JSON.stringify(body) });
const recovery = { question: "哪一本书对你影响最大？", answer: "离散数学", code: crypto.randomUUID().replaceAll("-", "") };
const password = crypto.randomUUID() + "a1";
const newPassword = crypto.randomUUID() + "b2";
const device = client();
await postAuth(device, { action: "login", ...userA });
const enrolled = await postAuth(a, { action: "set-recovery", password: userA.password, recovery });
check("现有账号设置安全问题与恢复码", enrolled.ok, `HTTP ${enrolled.status}`);
const changed = await postAuth(a, { action: "change-password", password: userA.password, newPassword: password });
const oldDevice = await (await device.fetch("/api/auth")).json();
check("改密后旧设备失效、当前设备继续登录", changed.ok && oldDevice.user === null && (await (await a.fetch("/api/auth")).json()).user?.email === userA.email, "");
const reset = { action: "reset-password", email: userA.email, newPassword, recovery };
check("错误安全答案不能找回账号", !(await postAuth(anon, { ...reset, recovery: { ...recovery, answer: "错误" } })).ok, "");
const attempts = await Promise.all([postAuth(anon, reset), postAuth(anon, reset)]);
check("一次性恢复码并发使用仅一次生效", attempts.filter(res => res.ok).length === 1, "");
check("重设密码后旧会话失效，新密码可以登录", (await (await a.fetch("/api/auth")).json()).user === null &&
  !(await postAuth(a, { action: "login", email: userA.email, password })).ok &&
  (await postAuth(a, { action: "login", email: userA.email, password: newPassword })).ok, "");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log("失败项：");
  for (const f of failed) console.log(`  · ${f.name}: ${f.detail}`);
  process.exit(1);
}
