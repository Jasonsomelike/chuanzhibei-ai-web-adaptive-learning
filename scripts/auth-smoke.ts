/**
 * 认证与方向市场的端到端测试。
 *
 * 验证真实的服务端行为，不是界面渲染：
 *   - 注册 → 会话生效 → 取当前用户
 *   - 重复注册被拒
 *   - 登录 / 错误密码 / 登出
 *   - 进度按用户隔离
 *   - 创建方向 → 公开 → 出现在市场 → 另一个用户复制
 *   - 未登录不能创建、不能看私有方向
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
      if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
      }

      const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });

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

// ── 22. 清理：删掉测试创建的方向 ──
await a.fetch(`/api/directions?id=${encodeURIComponent(directionId)}`, { method: "DELETE" });
await b.fetch(`/api/directions?id=${encodeURIComponent(copyData.id ?? "")}`, { method: "DELETE" });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log("失败项：");
  for (const f of failed) console.log(`  · ${f.name}: ${f.detail}`);
  process.exit(1);
}
