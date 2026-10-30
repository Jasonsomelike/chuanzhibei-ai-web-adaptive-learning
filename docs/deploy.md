# 快速开始与部署

环境要求：Node.js ≥ 22.13（推荐 22 或 24）、npm 10+。**Node 20 不支持**：PDF 解析用的 `pdfjs-dist@6.4.299` 的 `engines` 要求 ≥22.13，强行在 Node 20 上装会报 engine 警告、构建也可能失败；若必须保留 Node 20，需要改用 `pdfjs-dist` 5.x 并重新验证 worker，不在本轮已验证范围。它的 `@napi-rs/canvas` 只是 optionalDependency（Node 侧才可能用到），浏览器 bundle 不会引入。Vercel 项目需把 Node 版本设为 22.x。

```bash
npm install
npm run dev          # http://localhost:3000
npm run build && npm start
```

**不配任何 API key 也能完整使用诊断、路径、章节目标、手动改写、记忆卡、预测校准与知识库检索。** 导师回答退化为知识库检索拼装（含教材 / 上传 / 网络摘录），自定义方向退化为从现有学科挑选知识点；知识口径的教材 / 讲义选择与冲突裁定、上传资料的切块 / BM25 / 混合检索、浏览器内置朗读也不依赖模型。联网搜索即使没有 Tavily key，也还能用零密钥的维基百科。

**调用模式与密钥存放**（设置页顶部切换，键 `alp.callmode.v1`）。**默认是 `server`**（`DEFAULT_CALL_MODE`，`src/lib/serverConfig.ts:23`）；未登录时界面强制按 local 运行（`app/settings/page.tsx:210` 的 `effectiveMode`），避免请求一个必然 401 的代理：

| | server（默认） | local |
| --- | --- | --- |
| 谁发请求 | 本项目 `POST /api/llm/chat`、`/api/agent`、`/api/search`、`/api/tts`、`/api/llm/embeddings`、`/api/kb/similar`、`/api/kb/vectors` | 浏览器直连用户填的地址；Agent / MCP / 服务端向量接口不可用 |
| 密钥存哪 | `user_secrets` 密文列（AES-256-GCM），浏览器只拿到掩码 `hint` | `alp.provider.v1` / `alp.search.v1` / `alp.tts.v1`（localStorage） |
| 前提 | 登录 + 部署方配置 `ALP_SECRET_KEY` + 可持久化的 `DATABASE_URL` | 浏览器允许 CORS / 无混合内容拦截 |
| 未登录时 | 界面强制按 local 运行，不请求必然 401 的代理 | 同左 |

教材 / 讲义仍在 `alp.materials.v1`（localStorage）；上传知识库本机在 IndexedDB `alp-kb-v1`，登录后额外写账号的 `kb_docs` / `kb_chunks`。**server 模式下密钥仍不会出现在响应里**：`GET /api/config` 只回 `configured` / `hint` / 白名单 options，`hint` 固定为 `••••` + 末 4 位。

进度：未登录时存本浏览器 `localStorage`；登录后以服务端为准，之后每次变更防抖写回（`src/lib/useLearner.ts`）。记忆卡从 progress 剥离后单独写 `memories` 表（LWW，`max(lastSeenAt, createdAt)`）；上传知识库登录后同步到 `kb_docs` / `kb_chunks`，换设备登录同一账号能拿回；远端失败时界面显示「仅显示本机资料 / 尚未同步」，不静默假装成功。

登录时的合并规则是 `{...local.subjects, ...server}`（`src/lib/useLearner.ts` 的 `merged`）：
**服务端已有的学科覆盖本地同名学科；本地独有的学科保留**。所以准确说法是「服务端优先，本地独有的不丢」，
而不是「拉取覆盖本地」。记忆卡按 id 求并集、`lastSeenAt` 较新者整张胜出；同一张卡不做字段级拼接。

供应商预设：DeepSeek、OpenAI、Anthropic Claude、通义千问、Kimi、智谱 GLM、自定义（OpenAI 兼容）、自定义（Anthropic 兼容）。刻意不放 Ollama 预设——公开 Web 服务的大多数用户没有本地模型；需要的话用自定义端点填 `http://localhost:11434/v1`（`src/lib/provider.ts:104` 的 `PRESETS`）。

## 环境变量

| 变量 | 必需性 | 作用 |
| --- | --- | --- |
| `DATABASE_URL` | 线上必需 | Postgres 连接串；承载 12 张表。缺失时 `getDb()` 退化为进程内内存（`src/lib/db.ts:996`），重启即丢；pgvector 不可用时只跳过 `kb_chunk_vectors` |
| `ALP_SECRET_KEY` | server 模式必需 | 32 字节随机数的**标准 base64**（44 字符含 `=`）；缺失或格式不对时 `/api/config` 拒绝保存（503 `KEY_ENC_UNAVAILABLE`），绝不退化为明文。生成：`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `ALP_SECRET_KEY_ID` | 可选 | 密钥版本号，缺省 `v1`；轮换时修改。当前只支持一把主密钥，轮换后旧行报 `KEY_KID_UNKNOWN`，需要用户重存 |
| `ALP_EMBED_BASE_URL` / `ALP_EMBED_API_KEY` / `ALP_EMBED_MODEL` | 可选 | 服务端级 embedding 兜底（三项齐全才生效），供 `/api/llm/embeddings` 与 `eval:rag --mode hybrid`；不写进 512 维 `kb_chunk_vectors` |
| `ALP_AGENT_MAX_STEPS` / `_MAX_PARALLEL_TOOLS` / `_TOOL_TIMEOUT_MS` / `_MAX_RESULT_CHARS` / `_BUDGET_MS` / `_MODEL_TIMEOUT_MS` | 可选 | Agent 循环上限，缺省 8 步 / 5 并行 / 20s / 4000 字符 / 180s / 60s |
| `ALP_MAX_KB_FILE_BYTES` / `_FILE_CHARS` / `_PDF_PAGES` / `_DIRECTION_CHUNKS` / `_DIRECTION_CHARS` / `ALP_MAX_KB_BYTES` | 可选 | 上传与知识库上限，缺省 64MB / 100 万字 / 2000 页 / 50,000 段 / 1000 万字 / 32MiB |
| `ALP_ALLOW_HTTP_PROVIDER_HOSTS` | 可选 | 允许服务端代理访问 `http://` 的主机名单（逗号分隔 `host[:port]`）。**命中名单即整体信任该主机**：环回与内网地址都会被放行，这是为了让本地 Ollama 可用；默认空名单，未列出的内网地址一律拦截，`metadata.google.internal` 这类元数据主机即使列出也只按名字拦截。本地联调 Ollama 写 `127.0.0.1:11434`（http 条目必须带端口） |
| `ALP_ALLOW_MEMORY_SECRETS` | 仅本地测试 | 设 `1` / `true` 才允许内存后端写密钥；线上不要打开 |
| `HEALTH_TOKEN` | 可选 | 配了之后，`GET /api/health` 带 `Authorization: Bearer <token>` 才额外返回 `keyEncryption` 与 `db`；不配时永远只回 `{ok:true}` |

`.env.example` 只放键名与说明，可提交；真实值写 `.env.local`（已在 `.gitignore`）。

## 部署到 Vercel

```bash
npm i -g vercel
vercel login
vercel --prod
```

**需要配置 `DATABASE_URL`**（Postgres 连接串，Vercel 上可用 Neon 集成一键注入）。它承载 12 张表：`users`、`sessions`、`progress`、`directions`、`direction_picks`、`direction_items`、`user_secrets`、`kb_docs`、`kb_chunks`、`kb_chunk_vectors`、`mcp_servers`、`memories`（建表语句在 `src/lib/db.ts:1014` 的 `SCHEMA` 常量，每次进程首次 `getDb()` 幂等执行；`db/migrations/0001_capability.sql` 是同一套 DDL 的显式迁移版本）。教材 / 讲义选择与冲突裁定仍只属于浏览器（`alp.materials.v1`）；上传知识库登录后同步到账号，但**不随方向公开 / 复制**。

**不配 `DATABASE_URL` 会发生什么**：`getDb()` 会退化为**进程内内存存储**（`src/lib/db.ts:996-1000`）。本地开发与测试没问题，但部署环境里重启即丢，账号、跨设备进度、方向市场与知识库同步都不可用；`/api/config` 还会拒绝写密钥（503 `PERSISTENCE_UNAVAILABLE`）。所以「不需要数据库」只对匿名本地试用成立，对线上服务不成立。

**模型供应商不需要预置环境变量**：密钥由用户在设置页填。server 模式需要 `ALP_SECRET_KEY` 才能加密保存；local 模式不需要任何服务端密钥。两种模式都没有项目自有的模型 / 搜索 key。

## 自托管与反向代理

```bash
npm ci
node scripts/fetch-model.mjs             # 可选：本地 512 维嵌入资产（约 22.8MB）
npx tsx scripts/db-migrate.ts --dry-run  # 可选：先看待执行迁移
npx tsx scripts/db-migrate.ts            # 需要 pgvector 窄表时执行
npm run build && npm start               # 默认 3000 端口
```

需要 Node ≥ 22.13（`pdfjs-dist@6.4.299` 的 engines 要求，Node 20 不支持）；要账号、跨设备进度、知识库/记忆卡同步与 server 模式密钥，需要可达的 Postgres（`DATABASE_URL`）与 `ALP_SECRET_KEY`。PDF 解析在浏览器里完成，不需要服务端文件存储。

**SSE 必须关闭代理缓冲**，否则流式回答会整段卡住到结束：

```nginx
location /api/llm/chat {
  proxy_pass http://127.0.0.1:3000;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;          # 必须
  proxy_read_timeout 300s;      # 与 maxDuration / STREAM_TIMEOUT_MS 对齐
  client_max_body_size 2m;      # /api/llm/chat 请求体上限
}
location /api/kb { client_max_body_size 32m; proxy_read_timeout 60s; }
location /api/agent { client_max_body_size 4m; proxy_read_timeout 300s; }
```

服务端自己也会写 `X-Accel-Buffering: no`（`app/api/llm/chat/route.ts`），但 nginx 的 `proxy_buffering off` 仍建议显式配置。`/api/search` 与 `/api/tts` 目前没有请求体上限，放在公网时应在代理层限流 / 限体积（见 [§11](limits.md)）。
