# ADR-0002 实施计划（2026-10-30）

- 关联 ADR：[2026-10-30-capability-upgrade.md](./2026-10-30-capability-upgrade.md)
- 评审状态：**未通过（approved: false）**，问题与建议见 ADR 文末「独立评审」。
- 编排原则：只使用 ADR 已给出的 8 个阶段（阶段 0–7），不新增阶段；文件路径按仓库现状核对，新文件标注「新建」。
- 本文件编写时未复跑 `npm run verify` / `npm run check:bundle` / `npm run eval:rag`；阶段 0 的数字来自 ADR 记录，不是本次执行结果。

## 执行约定

1. **所有阶段门禁为 `npm run verify` + `npm run build && npm run check:bundle`。** `scripts/check-bundle.ts:20-21` 明确要求先 `npm run build`，脚本读取 `.next/server/app/...` 的 manifest；只跑 `check:bundle` 会量到旧产物（评审问题 8）。
2. **DDL 与数据写入先对账。** 每条 `CREATE` / `ALTER` / 写入前先 `--dry-run` 或 `COUNT`；没有可执行迁移器时，只能手工执行并记录连接目标与输出，不能把「跑过 SQL」写成「已迁移」。
3. **未跑就写「未验证」。** 任何「已实现」结论必须能指到本文件或 ADR 中的命令、输出与日期；没有记录的一律不写成通过。
4. **不上调基线。** `scripts/check-bundle.ts` 的 `BASELINE_KB` 只允许在真正拆包后下调；超预算只能动态 import 或拆包（ADR Non-Goals）。
5. **并行文件所有权。** 阶段 1 冻结 `src/lib/apiContracts.ts`；阶段 2 与阶段 3 文件不相交；阶段 4 与阶段 5 可并行；阶段 6 是 `app/tutor/page.tsx` 的第二次也是最后一次编辑；阶段 7 最后做。

## 阶段总览

| 阶段 | 名称 | 源文件数 | 前置阶段 | 并行约束 |
| --- | --- | --- | --- | --- |
| 0 | 基线冻结 | 0 | 无 | 无 |
| 1 | 契约与模型通道 | 10 | 0 | 唯一允许改 `apiContracts.ts` 的阶段；结束后冻结契约 |
| 2 | Agent 服务端 + MCP 客户端 | 11 | 1 | 与阶段 3 并行，文件不相交 |
| 3 | 向量存储与零 key 嵌入 | 10 源码 + 2 静态资产 | 1 | 与阶段 2 并行，文件不相交 |
| 4 | RAG 评测 | 4 | 3 | 可与阶段 5 并行 |
| 5 | 人格与可读性 | 8 | 1 | 可与阶段 4 并行；必须先于阶段 6 |
| 6 | 多模态与 Agent 前端 | 6 | 5（工具轨迹 UI 另需阶段 2） | 阶段 5 之后；最后一次改 tutor 页 |
| 7 | 动效与视觉收敛 | 7 | 6 | 最后做，不与任何阶段并行 |

合计约 56 个源文件（10+11+10+4+8+6+7）。评审问题 1 已指出：这是单工作流难以可靠完成的总量，「单阶段 ≤12 文件」不改变总量。

## 评审阻断项与执行调整

以下调整只影响**执行顺序与命令写法**，不改变 ADR 的阶段划分和验收原文；未解决前，对应验收只能记为「未验证」。

| 涉及阶段 | 阻断/风险 | 执行调整 |
| --- | --- | --- |
| 全部 | `check:bundle` 需要先 build（问题 8） | 统一写成 `npm run build && npm run check:bundle` |
| 阶段 2 | `/tutor` 工具轨迹 UI 在阶段 6 才落地（问题 2） | 阶段 2 的 `/tutor` 手工验收顺延到阶段 6；阶段 2 结束时用 curl/SSE 断言事件序列 |
| 阶段 2 | 远程 MCP 工具无法靠 annotations 判只读；`tools/list` 描述可注入；DELETE 决策矛盾（问题 9、10） | 开工前定代码级 per-server/per-tool allowlist；工具描述按不可信输入处理；DELETE 二选一写进决策后再改 `ssrfGuard.ts` |
| 阶段 2 | `mcp-smoke.ts` 实际 18 个 `check(`，且需要 3211 已有服务（问题 11） | 验收按 18/18；先另开终端启动 3211，再跑 smoke |
| 阶段 3 | 表缺 `direction_id` 但查询使用它；`/api/kb/similar` 未定义 direction/model 来源（问题 3） | 先定 JOIN `kb_chunks` 或加 `direction_id`，并把 user_id 来源固定为会话 |
| 阶段 3 | 仓库无迁移执行器；`CONCURRENTLY` 不能在事务内；Neon HTTP 每次 query 独立，`SET LOCAL` 不保留（问题 4） | 先补 `scripts/migrate-schema.ts` / `npm run db:migrate` 或明确手工执行；空表用普通 `CREATE INDEX`；HNSW 本轮可不启用 |
| 阶段 3 | 服务端 `embedTextsForUser` 依赖的上游返回 404；本地嵌入结果没有写进 `kbPut.chunks[].embedding` 的路径（问题 5） | 先在客户端上传前算好 `embedding` 并随 PUT 提交，或提供可用服务端嵌入器；否则「写入 512 维」无落地路径 |
| 阶段 3 | 800 段 × 512 维 + 正文超过 8MB PUT 上限（问题 6） | 分页/提高上限/仅相似路由存向量三选一，并补满规模用例 |
| 阶段 4 | 阶段 4 无 Node 向量生成脚本；`eval-rag.ts` 只接受 `--mode hybrid` 且 `EXPECTED_TOTAL=50`（问题 7） | 先补向量生成或改由浏览器导出；三条 `--mode` 分开跑；同步改 `EXPECTED_TOTAL` 与分类计数 |
| 阶段 5 | 新 persona 可能丢现有 12 条安全规则（问题 15） | `tutorPersona` 增加 `BASE_RULES`，逐条保留并加回归 |
| 阶段 6 | 缺「模型不支持图片」的 400 档；tutor smooth-scroll 修复被阶段 7 禁止改（问题 12、14） | 阶段 1 的 `mock-provider` 补 `/vision/v1` 400 档；tutor 的 `scrollIntoView` 修复移到阶段 6 |
| 阶段 7 | settings 已 import gsap，不是「GSAP 只上 /」的现状（问题 16） | 表述改为「本轮新增动效只加在 /，settings 既有 GSAP 只做抽取」 |

---

## 阶段 0｜基线冻结

### 目标

把「改动前是什么样」变成可复现的数字，作为后续所有阶段的回归基准。

### 涉及文件（精确路径）

无（0 文件，只跑命令）。

### 依赖的前置阶段

无。

### 验收命令与预期

基线数字来自 ADR 记录（ADR acceptance 第 1 条）；开工前应复跑并保存输出。

- `npm run verify` → `tsc` exit 0；74 test files / 1723 tests passed；`kg:validate` 9 学科 0 error；`check:secrets` 扫 252 文件无命中。
- `npm run build && npm run check:bundle` → 9/9；`/tutor` 243.1/254.1KB、`/path` 227.2/238.4KB、`/` 39.7/180KB。
- `npm run eval:rag` → recall@3 1.000(30/30)、MRR@10 1.000、OOD empty 1.000、unanswerableEmpty 0.500、「混合检索：未测」。
- 只读库查询 → PostgreSQL 18.6、vector 0.8.6 **未安装**、`kb_chunks` 0 行。

---

## 阶段 1｜契约与模型通道

### 目标

让请求/响应通道同时支持「图片 parts」「工具调用」「多轮 transcript」，并冻结后续所有 HTTP 契约（vision parts、agent 请求与事件、MCP 服务器 CRUD、kb similar、`CHAT_PURPOSES` 增加 agent）。

### 涉及文件（精确路径）

- `src/lib/apiContracts.ts`（**本轮唯一允许修改的阶段**；阶段结束冻结）
- `src/lib/provider.ts`
- `src/lib/upstream.ts`
- `src/lib/chat.ts`
- `src/lib/reasoning.ts`
- `src/lib/toolCalls.ts`（新建）
- `src/lib/toolMessages.ts`（新建）
- `src/lib/vision.ts`（新建）
- `app/api/llm/chat/route.ts`
- `scripts/mock-provider.ts`（新增 `/tools/v1` 与 `/vision/v1` 档）

### 依赖的前置阶段

阶段 0。

### 验收命令与预期

- `npm run typecheck` → exit 0。
- `npm test` → 全绿；新增 `src/lib/toolCalls.test.ts`、`src/lib/toolMessages.test.ts`、`src/lib/vision.test.ts`；扩展 `src/lib/reasoning.test.ts`（纯 `tool_calls` chunk 不再返回 null）、`src/lib/chat.test.ts`（工具轮不算空响应）、`src/lib/apiContracts.test.ts`（content 数组通过、`data:` 以外被拒）、`src/lib/llm-route.test.ts`（4MB 上限的 413）。
- `npm run build && npm run check:bundle` → 9/9，且 `/tutor` 不高于 254.1KB。
- 真实端点手工验收（ADR 记录本轮已预跑 wire format，改动后需在应用内复跑）：
  1. `/settings` 保存 `ALP_E2E_LLM_*` 后，向 `/api/llm/chat` 发一条 content 数组消息 → 200 且正文非空。
  2. 发一条带 `tools` 的请求 → 不再报「模型返回空内容」。

---

## 阶段 2｜Agent 服务端 + MCP 客户端

### 目标

把 5 个只读工具抽成纯函数、实现有界循环与事件流、接入用户自建 MCP 服务器（鉴权头加密落库）、修补本项目 `/api/mcp` 的 notification 与协议版本。

### 涉及文件（精确路径）

- `src/lib/mcpTools.ts`（新建）
- `src/lib/mcpClient.ts`（新建）
- `src/lib/mcpServers.ts`（新建）
- `src/lib/agentLoop.ts`（新建）
- `src/lib/agentRunner.ts`（新建）
- `src/lib/agentProtocol.ts`（新建）
- `app/api/agent/route.ts`（新建）
- `app/api/mcp/servers/route.ts`（新建）
- `app/api/mcp/route.ts`
- `src/lib/db.ts`（新增 `mcp_servers` 的 SCHEMA 与内存分支）
- `src/lib/ssrfGuard.ts`（method 增加 `DELETE`）

关键拆分：`agentLoop` 是纯状态机（注入 `callModel` / `callTool` / `now` / `signal`），`agentRunner` 才碰 DB、`guardedRequest` 与密钥；工具集合在 run 开始时冻结。

### 依赖的前置阶段

阶段 1（契约冻结）。与阶段 3 并行，文件不相交。

### 验收命令与预期

- `npm run typecheck` → exit 0。
- `npm test` → 全绿；新增 `agentLoop` / `mcpClient` / `agentProtocol` / `mcpServers` 用例，覆盖并行工具、参数碎片拼接、`max_steps`、`loop_detected`、工具报错回灌、MCP 404 重协商一次。
- `BASE_URL=http://127.0.0.1:3211 npx tsx scripts/mcp-smoke.ts` → **18/18**（ADR 写 16/16；脚本实际 18 个 `check(`，评审问题 11）。运行前先另开终端启动服务，例如 `npm run dev -- --port 3211`。
- `npm run build && npm run check:bundle` → 9/9（agent 代码全在服务端，客户端体积不变）。
- 手工演示（**ADR 原文，顺延到阶段 6**：要求在 `/tutor` 开工具模式、显示轨迹，但 `agent-trace.tsx` 与 `app/tutor/page.tsx` 的工具 UI 属于阶段 6，阶段 2 结束无法执行；按评审问题 2，阶段 2 改用 curl/SSE 断言事件序列）：
  - `/tutor` 开工具模式问「给我排一条 90 分钟的路径」→ 轨迹至少 `list_subjects` + `plan_path` 两步，最终文本引用路径指纹。
  - 停掉 MCP 服务器后 → notice「MCP 不可用」且本地工具仍可完成。
  - 未登录 → 401；local 模式 → 明确提示切服务端模式。

---

## 阶段 3｜向量存储与零 key 嵌入

### 目标

建 pgvector 窄表与部分 HNSW 索引、双写 512 维向量、新增 `/api/kb/similar` 让浏览器只发查询向量、本地 Worker 模型、回填脚本。

### 涉及文件（精确路径）

- `db/migrations/0001_pgvector.sql`（新建）
- `src/lib/kbVectors.ts`（新建）
- `src/lib/kbServer.ts`
- `src/lib/embeddingLocal.ts`（新建）
- `public/embed/worker.js`（新建）
- `scripts/fetch-model.mjs`（新建）
- `scripts/migrate-vector.ts`（新建）
- `app/api/kb/similar/route.ts`（新建）
- `src/lib/hybridSearchClient.ts`
- `.gitignore`

静态资产（不计源码）：

- `public/embed/transformers.web.min.js`（新建，不入 git）
- `public/models/bge-small-zh-v1.5/`（新建，不入 git）

### 依赖的前置阶段

阶段 1。与阶段 2 并行，文件不相交。

### 验收命令与预期

**硬前置（ADR 记录本轮未跑；任一步失败则整体回退到「不建表」）：**

1. 在与主库隔离的 Neon 分支执行 `CREATE EXTENSION vector;`。
2. `SELECT extversion FROM pg_extension WHERE extname='vector'` → 期望 `0.8.6`。
3. 写入一条 `$1::vector`，执行 `SELECT 1 - (vec <=> $1::vector(512))` → 期望返回数值。

仓库当前没有迁移执行器，也没有 `db:migrate` 命令（`package.json` 的 scripts 为 `dev/build/start/lint/typecheck/test/kg:validate/check:secrets/check:bundle/bench/smoke/smoke:mcp/smoke:auth/probe:external/eval:rag/verify/path:hash`，无 `db:migrate`）；上述 SQL 需用 Neon SQL Editor 或临时脚本执行并保存输出。评审问题 4 要求先补 `scripts/migrate-schema.ts` / `npm run db:migrate`，否则不得声称「已迁移」。

**主库迁移后：**

- `SELECT count(*) FROM kb_chunk_vectors` 与 `SELECT count(*) FROM kb_chunks WHERE embedding_dim=512` → 相等。
- `npx tsx scripts/migrate-vector.ts --dry-run` → pending 0（当前 `kb_chunks` 0 行）。脚本必须像 `scripts/eval-rag.ts:37` 那样 `process.loadEnvFile('.env.local')` 并打印连接目标与 pending 数，否则会静默用内存库、pending 0 变成假通过（评审问题 11）。
- `npm run build && npm run check:bundle` → 9/9（worker 与模型在 `public/`，不进 bundle）。
- 浏览器断网 + `public/models` 存在 → 本地嵌入可用并写入 512 维。
- 删掉 `public/models` → 提示「本次未使用语义检索」并退回 BM25，主流程不受影响。

**开工前必须解决的阻断项（评审问题 3–6、10、13）：**

- `kb_chunk_vectors` 没有 `direction_id`，查询却使用 `direction_id`；`/api/kb/similar` 的 body 也未定义 `$2`/`$3` 来源。需明确 JOIN `kb_chunks` 或加列，并说明 direction/model 来源与鉴权（user_id 只取会话）。
- 服务端 `putKbDocument` 走 `embedTextsForUser`（`app/api/kb/route.ts:139`、`src/lib/kbServer.ts:330-370`），该上游返回 404；浏览器本地模型是唯一 512 维来源，但阶段 3 文件列表没有 `kbStore.importDocument` / `kbRemote.putDoc` / `app/tutor/page.tsx`，需先把 `embedLocal` 结果放进 `kbPut.chunks[].embedding`（契约已支持，`src/lib/apiContracts.ts:289-291`）。
- `MAX_KB_PUT_BYTES=8MB`（`src/lib/kbServer.ts:19`），800 段 × 512 维仅向量约 7.72MiB，再加正文与元数据会 413；需分页、提高上限或只在相似路由存向量，并补满规模用例。
- 仓库当前没有 `public/` 目录；模型与 worker 资产需先手工跑 `scripts/fetch-model.mjs`，并给「模型未就绪」明确 UI 状态（评审问题 13）。

---

## 阶段 4｜RAG 评测

### 目标

把「向量有没有用」变成带区间与 n 的实验结论。

### 涉及文件（精确路径）

- `scripts/eval-rag.ts`
- `src/lib/ragEval.ts`
- `scripts/eval-data/rag-eval-hard-40.jsonl`（新建数据）
- `scripts/eval-data/vectors-hard.jsonl`（生成物，不进 git）

### 依赖的前置阶段

阶段 3（向量产出）。可与阶段 5 并行。

### 验收命令与预期

ADR 原文把三种模式写成 `--mode bm25|vector|hybrid`，但 `|` 在 shell 是管道；且当前 `scripts/eval-rag.ts` 只接受 `--mode hybrid`，`EXPECTED_TOTAL=50` 硬编码（评审问题 7）。阶段 4 修改后应分别执行：

- `npm run eval:rag -- --data scripts/eval-data/rag-eval-hard-40.jsonl --mode bm25`
- `npm run eval:rag -- --data scripts/eval-data/rag-eval-hard-40.jsonl --mode vector`
- `npm run eval:rag -- --data scripts/eval-data/rag-eval-hard-40.jsonl --mode hybrid`
- `npm run eval:rag`（默认 50 条回归门槛）→ 现有 50 条仍为 1.000，只作门槛，不作向量有效的证据。

预期输出：

- 四臂表格（无检索 / BM25 / 纯向量 / RRF，可选启发式重排）、每臂 n、nDCG@10、recall@20、词面覆盖率、配对 bootstrap 区间。
- 明确打印「区间是否排除 0」。
- 现有 50 条仍为 1.000（只作门槛）。
- 未配置嵌入时打印「混合检索：未测」且 exit 0。
- 验收只看「表是否完整、结论是否照实」，不预设向量一定赢；若区间跨 0，写「未证明有收益」。

**阻断项：** 阶段 4 文件列表没有 Node 侧向量生成脚本；`embeddingLocal.ts` 是浏览器/Worker，`@huggingface/transformers` 不在 `package.json`。需先补生成脚本或明确用浏览器导出 `vectors-hard.jsonl`，否则向量臂只能得到「未测」，与「表完整」的验收冲突（评审问题 7）。

---

## 阶段 5｜人格与可读性

### 目标

三套可切换语气、结构化回答形状、段落与列表渲染、36em 阅读列、10 条 rubric 回归并接入 `verify`。

### 涉及文件（精确路径）

- `src/lib/tutorPersona.ts`（新建）
- `src/components/tutor-logic.ts`
- `src/components/mini-markdown-tokenizer.ts`
- `src/components/mini-markdown.tsx`
- `app/tutor/page.tsx`（第一次修改）
- `src/lib/tutorEval.ts`（新建）
- `scripts/eval-tutor.ts`（新建）
- `package.json`（只加 `eval:tutor` 与 `verify` 一行）

### 依赖的前置阶段

阶段 1。可与阶段 4 并行；必须先于阶段 6。

### 验收命令与预期

- `npm run eval:tutor -- --judge rules` → 10 条全部产出逐条分数；硬门 R1≥1、R5=2、R7=2 全过。
- `npm test` → 全绿；`tutor-logic` 新增：转写段里的 `[c09]` 不算引用、声明必须在结论前、段落与列表 token 正确、流式光标挂在最后一段。
- `npm run verify` → 通过（`eval:tutor` 已并入 `verify`）。
- `npm run build && npm run check:bundle` → `/tutor` ≤254.1KB。
- 未配置 judge 时打印「judge 未测」并 exit 0。

**约束与阻断项：**

- 声明必须排在结论之前（`tutor-logic.ts:207-221` 要求通用知识声明落在开头 20 字内）。
- assistant 去 Card 与 36em 行宽只在本阶段做一次，后续阶段不再改这块样式。
- `tutorPersona` 必须包含 `BASE_RULES`，逐条保留现有 `app/tutor/page.tsx:150-163` 的 12 条安全规则（引用、`[资料n]`、网络检索未核对、不得编造页码等），并加回归；否则现有安全口径会回退（评审问题 15）。

---

## 阶段 6｜多模态与 Agent 前端

### 目标

粘贴/选择/拍照 → 压缩 → 预览 → 带图提问；浏览器语音输入；`/api/agent` 的轨迹渲染与降级提示。

### 涉及文件（精确路径）

- `src/components/image-attachment.tsx`（新建）
- `src/components/speech-input.tsx`（新建）
- `src/lib/speech.ts`（新建）
- `src/lib/visionPrompt.ts`（新建）
- `src/components/agent-trace.tsx`（新建）
- `app/tutor/page.tsx`（第二次也是最后一次修改）

### 依赖的前置阶段

阶段 5；工具轨迹 UI 另需阶段 2 的 `/api/agent` 与事件协议。

### 验收命令与预期

- `npm run typecheck` → exit 0。
- `npm test` → 全绿；新增 `speech.test.ts`，用假构造器驱动 `result` / `error` / `end`。
- `npm run build && npm run check:bundle` → `/tutor` ≤254.1KB；超了只能动态 import 拆包、不上调基线。
- 手工验收：
  1. 只粘贴一张截图不输入文字也能发送（修复 `app/tutor/page.tsx:397` 的空文本早退）。
  2. 回答严格分成【图中文字】/【解答】且引用只来自解答段。
  3. 换成不支持图片的模型 → 明确提示「该模型不支持图片」并给「改为文字提问」按钮，不静默去图重发。
  4. Chrome 拒绝麦克风 → 提示如何授权。
  5. 不支持的浏览器 → 按钮给出具体原因且不自动重试。
- 阶段 2 顺延的 `/tutor` 工具轨迹手工验收在本阶段执行：至少 `list_subjects` + `plan_path` 两步、最终文本引用路径指纹；停掉 MCP 后 notice「MCP 不可用」且本地工具仍可完成；未登录 401、local 模式提示切服务端模式。
- tutor 的 `scrollIntoView({behavior:'smooth'})` reduced-motion 修复放在本阶段（ADR 原写在阶段 7 的 why，但阶段 7 禁止改 tutor 页；评审问题 12）。

**阻断项：** 「模型不支持图片」需要可重复的 400 档。当前可用端点支持 vision，ADR 未给第二个不支持的模型；应由阶段 1 的 `scripts/mock-provider.ts` 增加 `/vision/v1` 400 档并做错误码/文案映射测试，否则该条无法本机执行（评审问题 14）。

---

## 阶段 7｜动效与视觉收敛

### 目标

GSAP 只上首页、抽 `motion.ts` 复用、修 reduced-motion 两个漏洞、路径页高亮与滚动、数字滚动。

### 涉及文件（精确路径）

- `src/components/motion.ts`（新建）
- `src/components/hero-reveal.tsx`（新建）
- `app/page.tsx`
- `app/globals.css`
- `app/settings/page.tsx`
- `src/components/secret-config-form.tsx`
- `app/path/page.tsx`

### 依赖的前置阶段

阶段 6（作为最后阶段，应在阶段 1–6 全部完成后执行）。不与任何阶段并行。

### 验收命令与预期

- `npm run build && npm run check:bundle` → `/` 约 68KB（39.7 + gsap gzip 27.7）≤180KB；`/tutor` 与 `/path` 体积不变。
- `npm test` → 全绿。
- 手工：
  1. 系统开启「减少动态效果」→ 首页无入场动画、`/path` 不再平滑滚动、带 delay 的动画不空白。
  2. 关闭 → 首页只播一次 stagger。
  3. 控制台无 gsap 警告、切页不重复播放。

**禁止与说明：**

- 不改 `app/tutor/page.tsx`（避免第三次编辑同一文件）；`app/tutor/page.tsx:344` 的 smooth-scroll 修复已按评审问题 12 移到阶段 6。
- 不给 `/tutor` 与 `/path` 引入 gsap；不上调任何基线。
- `app/settings/page.tsx:4` 与 `src/components/secret-config-form.tsx:18` 当前已经 import gsap；本阶段只做 `motion.ts` 抽取，不把「GSAP 只上 /」写成现状（评审问题 16）。

---

## 验收清单（Acceptance Checklist）

> 勾选前必须能指到命令输出或实跑记录；未跑项保持未勾选并标注「未验证」。阶段 0 数字来自 ADR 记录，本文件编写时未复跑。

### A0 阶段 0｜基线

- [ ] `npm run verify` → `tsc` exit 0；74 test files / 1723 tests passed；`kg:validate` 9 学科 0 error；`check:secrets` 扫 252 文件无命中。
- [ ] `npm run build && npm run check:bundle`（ADR 原文只写 `check:bundle`）→ 9/9；`/tutor` 243.1/254.1KB、`/path` 227.2/238.4KB、`/` 39.7/180KB。
- [ ] `npm run eval:rag` → recall@3 1.000(30/30)、MRR@10 1.000、OOD empty 1.000、unanswerableEmpty 0.500、「混合检索：未测」。
- [ ] 只读库查询 → PostgreSQL 18.6、vector 0.8.6 未安装、`kb_chunks` 0 行。

### A1 阶段 1｜契约与模型通道

- [ ] `npm run typecheck` → exit 0。
- [ ] `npm test` → 全绿；新增 `src/lib/toolCalls.test.ts`、`src/lib/toolMessages.test.ts`、`src/lib/vision.test.ts`。
- [ ] `src/lib/reasoning.test.ts` 扩展：纯 `tool_calls` chunk 不再返回 null。
- [ ] `src/lib/chat.test.ts` 扩展：工具轮不算空响应。
- [ ] `src/lib/apiContracts.test.ts` 扩展：content 数组通过、`data:` 以外被拒。
- [ ] `src/lib/llm-route.test.ts` 扩展：4MB 上限的 413。
- [ ] `npm run build && npm run check:bundle` → 9/9 且 `/tutor` 不高于 254.1KB。
- [ ] 真实端点：`/settings` 保存 `ALP_E2E_LLM_*` 后，向 `/api/llm/chat` 发 content 数组消息 → 200 且正文非空。
- [ ] 真实端点：发带 `tools` 的请求 → 不再报「模型返回空内容」。

### A2 阶段 2｜Agent 服务端 + MCP 客户端

- [ ] `npm run typecheck` → exit 0。
- [ ] `npm test` → 全绿；新增 `agentLoop` / `mcpClient` / `agentProtocol` / `mcpServers` 用例。
- [ ] 用例覆盖并行工具、参数碎片拼接、`max_steps`、`loop_detected`、工具报错回灌、MCP 404 重协商一次。
- [ ] `BASE_URL=http://127.0.0.1:3211 npx tsx scripts/mcp-smoke.ts` → 18/18（ADR 写 16/16）。
- [ ] `npm run build && npm run check:bundle` → 9/9（客户端体积不变）。
- [ ] 手工（顺延到阶段 6）：`/tutor` 工具模式 → 轨迹至少 `list_subjects` + `plan_path`，最终文本引用路径指纹。
- [ ] 手工（顺延到阶段 6）：停掉 MCP 服务器 → notice「MCP 不可用」且本地工具仍可完成。
- [ ] 手工：未登录 → 401；local 模式 → 明确提示切服务端模式。

### A3 阶段 3｜向量存储与零 key 嵌入

- [ ] Neon 分支 `CREATE EXTENSION vector;` 成功（ADR 记录本轮未跑，硬前置）。
- [ ] `SELECT extversion FROM pg_extension WHERE extname='vector'` → 0.8.6。
- [ ] 写入一条 `$1::vector` 并执行 `SELECT 1 - (vec <=> $1::vector(512))` → 返回数值。
- [ ] 主库迁移后 `SELECT count(*) FROM kb_chunk_vectors` 与 `SELECT count(*) FROM kb_chunks WHERE embedding_dim=512` 相等。
- [ ] `npx tsx scripts/migrate-vector.ts --dry-run` → pending 0（当前 `kb_chunks` 0 行）。
- [ ] `npm run build && npm run check:bundle` → 9/9（worker 与模型在 `public/`，不进 bundle）。
- [ ] 浏览器断网 + `public/models` 存在 → 本地嵌入可用并写入 512 维。
- [ ] 删掉 `public/models` → 提示「本次未使用语义检索」并退回 BM25，主流程不受影响。

### A4 阶段 4｜RAG 评测

- [ ] `npm run eval:rag -- --data scripts/eval-data/rag-eval-hard-40.jsonl --mode bm25` → 输出表格与指标。
- [ ] `npm run eval:rag -- --data scripts/eval-data/rag-eval-hard-40.jsonl --mode vector` → 输出表格与指标。
- [ ] `npm run eval:rag -- --data scripts/eval-data/rag-eval-hard-40.jsonl --mode hybrid` → 输出表格与指标。
- [ ] 输出四臂表格（无检索 / BM25 / 纯向量 / RRF，可选启发式重排）、每臂 n、nDCG@10、recall@20、词面覆盖率。
- [ ] 输出配对 bootstrap 区间，并打印「区间是否排除 0」。
- [ ] 现有 50 条仍为 1.000（只作门槛）。
- [ ] 未配置嵌入时打印「混合检索：未测」且 exit 0。
- [ ] 结论照实：不预设向量一定赢；区间跨 0 时写「未证明有收益」。

### A5 阶段 5｜人格与可读性

- [ ] `npm run eval:tutor -- --judge rules` → 10 条全部产出逐条分数。
- [ ] 硬门 R1≥1、R5=2、R7=2 全过。
- [ ] `npm test` → 全绿；`tutor-logic` 新增：转写段里的 `[c09]` 不算引用、声明必须在结论前、段落与列表 token 正确、流式光标挂在最后一段。
- [ ] `npm run verify` → 通过（`eval:tutor` 已并入）。
- [ ] `npm run build && npm run check:bundle` → `/tutor` ≤254.1KB。
- [ ] 未配置 judge 时打印「judge 未测」并 exit 0。

### A6 阶段 6｜多模态与 Agent 前端

- [ ] `npm run typecheck` → exit 0。
- [ ] `npm test` → 全绿；新增 `speech.test.ts`，用假构造器驱动 `result` / `error` / `end`。
- [ ] `npm run build && npm run check:bundle` → `/tutor` ≤254.1KB；超了只能动态 import 拆包、不上调基线。
- [ ] 手工：只粘贴一张截图不输入文字也能发送（修复 `app/tutor/page.tsx:397` 的空文本早退）。
- [ ] 手工：回答严格分成【图中文字】/【解答】，引用只来自解答段。
- [ ] 手工：不支持图片的模型 → 提示「该模型不支持图片」并给「改为文字提问」按钮，不静默去图重发。
- [ ] 手工：Chrome 拒绝麦克风 → 提示如何授权。
- [ ] 手工：不支持的浏览器 → 按钮给出具体原因且不自动重试。
- [ ] 手工（阶段 2 顺延）：`/tutor` 工具轨迹、MCP 不可用 notice、401、local 模式提示。

### A7 阶段 7｜动效与视觉收敛

- [ ] `npm run build && npm run check:bundle` → `/` 约 68KB（39.7 + gsap gzip 27.7）≤180KB。
- [ ] `npm run build && npm run check:bundle` → `/tutor` 与 `/path` 体积不变。
- [ ] `npm test` → 全绿。
- [ ] 手工：系统开启「减少动态效果」→ 首页无入场动画、`/path` 不再平滑滚动、带 delay 的动画不空白。
- [ ] 手工：关闭「减少动态效果」→ 首页只播一次 stagger。
- [ ] 手工：控制台无 gsap 警告、切页不重复播放。

### 跨阶段总门禁（ADR acceptance 第 9 条）

- [ ] 每个阶段结束都 `npm run verify` + `npm run build && npm run check:bundle` 双绿（ADR 原文为 `npm run verify` + `npm run check:bundle`；build 为评审问题 8 的补充）。
- [ ] 每条 `CREATE` / `ALTER` / 数据写入前先 `--dry-run` 或 `COUNT` 对账。
- [ ] 任何「已实现」的结论都能指到本文件的命令或 ADR context 里的实跑记录。
- [ ] 未跑的项一律写「未验证」。
