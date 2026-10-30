# 验证记录

> 本文的「本轮」指 2026-10-30 这一轮实跑；更早一轮的结果会明确标注「上一轮」或「2026-10-29」。

## 门禁与实测

所有数字都来自本机实跑，命令可直接复制；跑不了的项目写「未验证」，不写推算值。

## 一个被测试抓到的真实 bug

`pathHash` 依赖一个手写的同步 SHA-256——Web Crypto 是异步的，而 `planPath` 必须是同步纯函数。初版实现在消息填充边界（55、119 字节）算错了填充块数，哈希值错误。`src/lib/hash.test.ts` 用 Node 内置 `crypto` 逐条交叉验证时发现了它（修复记录见提交 `12fe2c6` 的「过程中修复的真实缺陷」第 1 条）：现在 14 个用例覆盖空串、55/56/63/64/119/120/128/1000 字节与中英混合，全部一致（`src/lib/hash.test.ts:19-40`）。

如果不测，`pathHash` 的整个「可复现」承诺就是假的。

## 2026-10-30 本轮实测

| 命令 | 验证什么 | 本轮实测（2026-10-30） |
| --- | --- | --- |
| `npm run typecheck` | TypeScript strict | exit 0（无输出） |
| `npm run test` | 单元测试（94 个文件） | **1996 passed / 94 files**，exit 0 |
| `npm run kg:validate` | 9 学科逐科：无环、无悬空边、每 KC 恰好 3 题、难度均值在 1.8–2.9 | 0 error（9 学科 / 360 点 / 540 边 / 1080 题） |
| `npm run check:secrets` | 仓库无真实密钥 | **exit 1**：扫 309 个文件，3 处命中，均为新增测试里的 `fake-*` 占位符（`agent-route.test.ts:85`、`mcpServers-route.test.ts:28`、`mcpStore.test.ts:33`） |
| `npm run verify` | typecheck + test + kg + secrets 串跑 | **exit 1**（前三条通过，`check:secrets` 失败） |
| `npm run lint` | ESLint 9 扁平配置 | 0 error / 29 warning，exit 0 |
| `npm run build` | Next 16 生产构建 | **exit 0**，28 个路由（9 页面 + 18 API + `_not-found`） |
| `npm run eval:rag` | 50 条检索评测 | **exit 0**；recall@3 `1.000`、MRR@10 `1.000`、goldPhrase `1.000`、OOD empty `1.000`、unanswerableEmpty `0.500`；混合检索打印「未测」 |
| `npx tsx scripts/eval-tutor.ts --judge rules` | 10 条导师回答 rubric（8 维） | 10 条全部产出分数，硬门 R1≥1 / R5=2 / R7=2 全过，exit 0 |
| `BASE_URL=http://127.0.0.1:4322 npx tsx scripts/auth-smoke.ts` | 注册/登录/进度隔离/配置 401/ KB / 记忆卡 LWW / 市场 | **34/34 通过**，exit 0（`DATABASE_URL=` + `next start`，内存库） |
| `BASE_URL=http://127.0.0.1:4322 npx tsx scripts/mcp-smoke.ts` | MCP 三种原语、版本协商与错误码 | **18/18 通过**，exit 0（同一服务） |
| `npm run probe:external` | DeepSeek 搜索 / MiMo TTS / Embedding 真机探测 | 本轮未跑；上一轮结果是通过 0 / 失败 0 / **未验证 3**（缺凭据） |
| `npm run bench` | 路径算法性能 | 本轮未跑；`plan.ts` 未改，[§6](architecture.md) 数字沿用上一轮 |

`npm run verify` 本轮整体串跑为 **exit 1**，卡在 `check:secrets`；不是测试失败。`npm run build`、`npm run eval:rag`、`eval-tutor` 与两个 smoke 的退出码来自本轮实跑。

**本轮仍未验证**：Neon 上的 `CREATE EXTENSION vector` / `$1::vector` / `<=>`、真实第三方 MCP 服务器的端到端调用、浏览器本地嵌入的完整链路、真实 TTS（`speech` / mimo `chat-audio`）、PDF worker 浏览器侧、Lighthouse / Core Web Vitals。代码与单测存在不等于这些环境已验证。

## 2026-10-30 门禁原始输出（判定行）

```text
$ npm run test
 Test Files  94 passed (94)
      Tests  1996 passed (1996)
EXIT=0
```

```text
$ npm run build
✓ Compiled successfully
✓ Generating static pages using 30 workers (28/28)
# 路由：/、/about、/diagnose、/directions、/login、/market、/path、/settings、/tutor
# API：agent、auth、config、directions(×3)、health、kb、kb/similar、kb/vectors、
#      llm/chat、llm/embeddings、mcp、mcp/servers、memories、progress、search、tts
EXIT=0
```

```text
$ npm run check:secrets
密钥扫描：检查 309 个文件
发现 3 处疑似密钥：
  ✗ src/lib/agent-route.test.ts:85
  ✗ src/lib/mcpServers-route.test.ts:28
  ✗ src/lib/mcpStore.test.ts:33
EXIT=1
```

```text
$ npm run eval:rag
recall@3 1.000（30/30） · MRR@10 1.000（30/30） · goldPhraseInFullText 1.000
answer-absent relatedHitRate 1.000（10/10）
out-of-domain emptyRate 1.000（10/10） · falseContextRate 0.000（0/10）
unanswerableEmptyRate 0.500（10/20）
混合检索：未测（未提供 --vectors，且未配置 ALP_EMBED_*）
EXIT=0
```

```text
$ npx tsx scripts/eval-tutor.ts --judge rules
问题：10 条；维度：8 个（0/1/2）；judge：rules
硬门 R1 结构完整 >=1：✓   R5 例子具体 =2：✓   R7 无禁语 =2：✓
EXIT=0
```

## 最终门禁原始输出（2026-10-29 上一轮，保留作历史对照）

环境：Windows 10.0.26300 x64 / Git Bash / Node v24.15.0。以下为逐条命令的实际终端输出（长输出只截取判定行，未改数字）。**其中的 1723 tests / 74 files / 252 文件 / 24 路由等数字只代表 2026-10-29 上一轮，不是当前结论；当前数字见上一节。**

```text
$ npm run typecheck
> tsc --noEmit
EXIT=0
```

```text
$ npm run test
 Test Files  74 passed (74)
      Tests  1723 passed (1723)
EXIT=0
```

```text
$ npm run kg:validate
合计 9 个学科 · 360 知识点 · 540 先修边 · 1080 题（每知识点 3 题）
校验通过：0 error。
EXIT=0
```

```text
$ npm run check:secrets
密钥扫描：检查 252 个文件
────────────────────────────────────────────────────
未发现疑似密钥。
EXIT=0
```

```text
$ npm run build
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 1165ms
✓ Generating static pages using 26 workers (24/24) in 721ms
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /about
├ ƒ /api/auth
├ ƒ /api/config
├ ƒ /api/directions
├ ƒ /api/directions/generate
├ ƒ /api/directions/items
├ ƒ /api/health
├ ƒ /api/kb
├ ƒ /api/llm/chat
├ ƒ /api/llm/embeddings
├ ƒ /api/mcp
├ ƒ /api/memories
├ ƒ /api/progress
├ ƒ /api/search
├ ƒ /api/tts
├ ○ /diagnose
├ ○ /directions
├ ○ /login
├ ○ /market
├ ○ /path
├ ○ /settings
└ ○ /tutor
EXIT=0
```

```text
$ npm run eval:rag
[BM25 基线]
  recall@3                 1.000（30/30）   字面 1.000（15/15） / 同义 1.000（15/15）
  MRR@10                   1.000（30/30）
  goldPhraseInFullText     1.000（30/30）
  answer-absent relatedHitRate   1.000（10/10）
  out-of-domain emptyRate        1.000（10/10）
  unanswerableEmptyRate    0.500（10/20）   （answer-absent ∪ out-of-domain）
混合检索：未测（未提供 --vectors，且未配置 ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL）
EXIT=0
```

```text
$ npm run path:hash
algoVersion  plan-v2
kgVersion    kg-v1
inputHash    f9f9999230b4c06be74c235e4f7bedc39dcb7c4b947dea80f4dbb89539e61ecd
pathHash     ad7ccec537db36ee7b0070aca3f9f99006e92521e16ce2608def4df76f2b9e66
steps        c01:15 c02:15 c15:15 c35:15 c03:15 c05:15 c16:15 c22:15
totalMinutes 120
EXIT=0
```

```text
$ git diff -- src/lib/plan.ts
（空输出）
$ git diff -- package.json
@@ -17,6 +17,9 @@
     "bench": "node bench/bench-path.mjs",
     "smoke": "tsx scripts/smoke.ts",
     "smoke:mcp": "tsx scripts/mcp-smoke.ts",
+    "smoke:auth": "tsx scripts/auth-smoke.ts",
+    "probe:external": "tsx scripts/probe-external.ts",
+    "eval:rag": "tsx scripts/eval-rag.ts",
     "verify": "npm run typecheck && npm run test && npm run kg:validate && npm run check:secrets",
     "path:hash": "tsx scripts/path-hash.ts"
（只有 scripts 三行；dependencies / devDependencies 无变化）
```

```text
$ DATABASE_URL= npx next start -p 4321 -H 127.0.0.1   # 3211/3218 在本机被 Windows 保留端口占用（EACCES）
$ BASE_URL=http://127.0.0.1:4321 npx tsx scripts/auth-smoke.ts
34/34 通过
EXIT=0
```

> 端口说明：本机 `3211`、`3218` 监听时返回 `EACCES: permission denied`（被系统保留），换 `4321` 后正常。脚本只读 `BASE_URL`，端口不是功能差异。

**生产构建本轮已跑（exit 0）**，但 PDF worker 的浏览器侧仍未验证：`src/lib/pdf.ts` 用 `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)` 交给 Turbopack；构建通过只说明产物能生成，不说明运行时会加载 worker。`scripts/pdf-smoke.ts` 用 Playwright 在真实 Chromium 里验证「有文本层 PDF 能抽两页、纯图片 PDF 报无文本层、Network 里加载了 pdf.worker」，本轮**未跑**（需要先 `npx playwright install chromium` 并起 Next 服务）。

**E2E 必须显式清空 `DATABASE_URL`**：仓库的 `.env.local` 里可能有真实 Neon 连接串，
`next dev` 会自动读取它，于是 E2E 会往远端库写测试账号与方向。
命令前缀加 `DATABASE_URL=` 后 `getDb()` 退化为进程内内存存储，测试数据随进程退出消失。

三个脚本都要求先起服务（`DATABASE_URL= npx next start -p 4321` 或 `next dev`）。**E2E 的数字是在
内存库上跑出来的**；Postgres 路径没有实跑（会写用户库），只按 neon 驱动的类型定义与
`fullResults` 文档修正了 `run()` 的返回值口径，并用假 Db 的接口测试锁住调用方语义。
本轮 `auth-smoke.ts` 34/34、`mcp-smoke.ts` 18/18 实跑；`smoke.ts` 未重跑（上一轮 53/53），
新增的流式 / 思考、引用核对、联网、上传知识库、记忆、校准、朗读与账号同步仍未进入 `smoke.ts`。

密钥扫描的反向自测是上一轮做的：临时写入一个 `sk-` 开头的假密钥，`npx tsx scripts/check-secrets.ts` 报「发现 1 处疑似密钥」并以退出码 1 结束；删除后恢复退出码 0。上一轮把这些值改成非凭据形状的占位符后扫描恢复 exit 0；本轮新增的 Agent / MCP 测试又引入了 3 个 `fake-*` 占位符，扫描回到 exit 1（见本轮实测表）。

## 端到端测试

需要先 `npm run build && npm start`：

| 脚本 | 覆盖 | 最近一次实测 |
| --- | --- | --- |
| `DATABASE_URL= BASE_URL=http://localhost:3211 npx tsx scripts/smoke.ts` | 首页/主题/设置/诊断/路径/导师/方向/市场 UI 流程，含 7 条自定义方向回归 | 53/53（上一轮；本轮未重跑） |
| `DATABASE_URL= BASE_URL=http://127.0.0.1:4322 npx tsx scripts/auth-smoke.ts` | 注册/登录/登出/进度隔离/配置 401/密钥写入拒绝/KB 往返/记忆卡 LWW/方向权限/市场复制 | **34/34（本轮实跑）** |
| `DATABASE_URL= BASE_URL=http://127.0.0.1:4322 npx tsx scripts/mcp-smoke.ts` | MCP 三种原语、版本协商与错误码 | **18/18（本轮实跑）** |

> 开发服务器下用 `localhost` 而不是 `127.0.0.1`：Next 16 默认拦截 `127.0.0.1` 的 HMR 请求，客户端组件不会 hydrate，页面看起来「点了没反应」。本轮的两个 smoke 跑在 `next start` 生产产物上，`127.0.0.1:4322` 正常可用。

## 可控 Mock 供应商（生成链路集成检查）

`scripts/mock-provider.ts` 是一个只监听 `127.0.0.1` 的 OpenAI 兼容端点，按 baseUrl 路径分档；`scripts/mock-gen-check.ts` 用真实 `ensureItems` 跑生成链路（L1–L4 + 落库），只把 `/api/directions/items` stub 成内存回显。两条命令都不需要数据库、Next 服务或真实 key：

```bash
# 单独启动 mock（127.0.0.1:3212），用于在设置页里手填供应商
node node_modules/tsx/dist/cli.mjs scripts/mock-provider.ts

# 一键跑集成检查（脚本自己起 mock，不需要先开服务）
node node_modules/tsx/dist/cli.mjs scripts/mock-gen-check.ts
```

在设置页填 `http://127.0.0.1:3212/v1`、密钥任意非空、模型名 `mock-model`（mock 不校验 key 与模型名，只要求请求体是 OpenAI 兼容形状）。各档证明什么：

| baseUrl | mock 行为 | 证明什么 |
| --- | --- | --- |
| `/v1` | 按题目当前选项顺序返回正确文本 | 正常链路：4 题全部 accepted，`checks` 同时带「双解校验」与「依据：」 |
| `/shuffle/v1` | `answers` 数组整体倒序，但每条 `index` 仍是正确题号 | L4 必须按 `index` 落槽：按 index 对齐后 4 题全 accepted；同一响应若按数组顺序取，`compareSolverAnswers` 4 题全 false（脚本里的哨兵） |
| `/badsolve/v1` | 反转批次里第 3、4 题故意答错 | 双解不一致只降级为 practice：2 accepted + 2 practice，并报「未达到 3 题门槛」 |
| `/truncate/v1` | 返回 `finish_reason=length`、空 content | `callChat` 抛 `ChatError(kind=truncated)`；`ensureItems` 会吞掉异常，所以脚本直接对 `callChat` 断言 |
| `/stream/v1` | SSE：先 `reasoning_content` 增量，再正文增量，最后 usage 与 `[DONE]` | 浏览器手测流式思考面板：思考先出现、正文开始后自动折叠 |
| `/think400/v1` | 请求带 `thinking` / `reasoning_effort` 时返回 400，去掉后正常流式返回 | 验证 `callChatStream` 的「思考参数被拒 → 降级一次」与设置页的 unsupported 写回 |

上一轮实跑（本轮未重跑）：`node node_modules/tsx/dist/cli.mjs scripts/mock-gen-check.ts` → **19 项 PASS**（exit 0）。除上表前四档外，脚本还覆盖**坏 JSON**（两次都不可解析时报「模型输出无法解析」，而不是静默 0 题）与**同批重复题干**（L2 去重拒题、本批凑不够 4 题）。

> `mock-gen-check.ts` 显式传 `verification: false`：它只验证出题 + L4 + 落库，mock 没有实现核对档；开着 L6 会多打一次非批解请求并把「依据核对：未完成」写进 `checks`，打穿现有 19 项断言。L6 的通过 / 未通过 / 未完成 / 跳过由 `src/lib/directionItems.test.ts` 覆盖；`/stream` 与 `/think400` 两档只用于浏览器手测，不在 19 项里。

**它不替代什么。** `mock-gen-check.ts` 把 `/api/directions/items` stub 掉，不经过 Next 路由、数据库与浏览器：服务端落库语义仍由 `src/lib/items-route.test.ts` 锁，完整 UI 流程仍靠 `scripts/smoke.ts` / `scripts/auth-smoke.ts`。mock 固定回答 4 道栈题，也不检查出题质量。

## 可访问性

`node research/tools/contrast-audit.mjs` 对 5 套配色 × 明暗两种模式逐对计算 WCAG 对比度：**210 对，未通过 0 对**（含参考项）。正文最低 15.50:1，次要文字最低 7.24:1。

## 其他可验证的工程点

- **PBKDF2-HMAC-SHA256 600,000 次**（`src/lib/auth.ts:20`），常量时间比较（`:100`），账号不存在时也跑一次哈希以免暴露时序（`:213`）。参数对齐 OWASP Password Storage Cheat Sheet 对 PBKDF2-HMAC-SHA256 的建议值。
- **Postgres 12 表 + 内存双实现**（`src/lib/db.ts:996` 的 `getDb`、`:182` 的 `parseInsert`、`:1014` 的 `SCHEMA`），同一套 SQL 接口，测试不需要外部服务。内存实现的删除 / 分页形状有精确分支，见 [§14](rag.md)。
- **BM25 中文 bigram + 单字降权 0.35**（`src/lib/rag.ts:61`、`:64`），不引分词库；512 维上传向量另存 `kb_chunk_vectors` 并由 `POST /api/kb/similar` 精确扫描，BM25 本身不依赖向量库。标题加权默认关（`titleBoost = 1` 时整段分支不执行），评测用 ×2。
- **混合检索纯函数**：RRF `k=60`、每路候选 20、注入 3 条、余弦阈值 0.25、相邻切块重叠 ≥20 码点去重（`src/lib/hybrid.ts:40-52`）；向量无效 / 维度不符一律拒绝而不是当 0 分（`src/lib/vectorContracts.ts:59`）。
- **供应商预检**：地址为空/格式错/粘了 `/chat/completions`/HTTPS 页面填 HTTP 地址，都在发请求前分类拦下（`src/lib/provider.ts:447` 的 `checkBaseUrl`）；错误按 401/404/429/5xx/CORS/超时分类给修复建议（`src/lib/provider.ts:761` 的 `testConnection`）。
- **服务端密钥与 SSRF**：AES-256-GCM（12 字节 IV、16 字节 tag、AAD=`user_secrets:${userId}:${kind}`），掩码固定四个圆点；出站地址三层判定（形状 → DNS 逐条 → 连接钉 IP，`src/lib/ssrf.ts`、`src/lib/ssrfGuard.ts:153`、`:262`）；搜索端点写死，不接受调用方传 URL。
- **CSRF 与体积上限**：有副作用的请求走 `assertMutationOrigin` / `sameOriginFromRequest`；`/api/config` 32 KiB、`/api/llm/chat` 2 MiB、`/api/llm/embeddings` 1 MiB、`/api/kb` 32 MiB、`/api/agent` 4 MiB、`/api/kb/vectors` 512 KiB、`/api/kb/similar` 64 KiB、`/api/memories` 1 MiB；`/api/search` 与 `/api/tts` 目前**没有**请求体上限（已知缺口，见 [§11](limits.md)）。
- **三个新增纯函数层**：`memory.ts` 的所有时间由调用方传入 `now`；`calibration.ts` 只做统计；`knowledge.ts` 不做 IO。三者的单测分别覆盖容量拒绝、Wilson 数值与切块不变量。
- **IndexedDB 单事务**：`kbStore.ts` 先在事务外准备全部行，`putDocWithChunks` 用一个 readwrite 事务写入 docs + chunks；失败整体回滚，错误文案写「已导入 0/M 段，未写入任何内容」。
- **SSE 解析与正文 / 思考分流**：`reasoning.ts` 的 `createSseDecoder` 支持跨 chunk 半行、`\r\n`、多行 `data:` 与 `[DONE]`；`reasoning` 永不拼进 `text`。服务端代理的 SSE 头带 `X-Accel-Buffering: no`，见 [部署说明](deploy.md) 的 nginx 配置。
- **密钥与资料按模式分开存**：server 模式的三类供应商密钥进 `user_secrets` 密文列，任何响应只回掩码；local 模式仍是 `alp.provider.v1` / `alp.search.v1` / `alp.tts.v1`；教材 / 讲义 `alp.materials.v1`；上传知识库本机 IndexedDB + 登录后账号同步。
