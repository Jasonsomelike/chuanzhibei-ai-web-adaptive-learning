# 目标与范围

- 日期：2026-10-29
- 状态：本轮方案定稿（wave 3 书面记录）。本文写**已定的取舍**；与当前代码不一致的地方集中登记在「已知限制」，不把未实现写成已实现。
- 范围：账号级知识库/记忆卡同步、服务端密钥存储与代理、BM25 + 向量 + RRF 检索、50 条检索评测、DeepSeek 搜索与小米 mimo 语音。
- 契约源码：`src/lib/apiContracts.ts`（wave 1 已钉死）。wave 2/3 只能引用它，不得各自再写一份请求体；本文是该契约的最终书面记录，不新增字段、不改错误码字符串。
- 代码事实快照：2026-10-29。仓库在本轮被多个 wave 并行修改；行号只用于定位，行为以代码为准。
- 本轮实跑的检查见 §8.1；未跑的项目见 §8.2。没有跑过的命令不写成通过。

## 1.1 目标

1. **账号级知识库**：登录后上传的资料不再只属于一台浏览器。文档 + 片段整篇提交，换设备能拿回；向量按游标分页取，默认列表不带向量。
2. **账号级记忆卡**：错题卡/易混卡从 progress JSON 里分离出来，单独一张表；两台设备各改各的，结果必须能解释。
3. **密钥不进明文库**：模型/搜索/语音密钥用 AES-256-GCM 加密后存 `user_secrets`，任何响应只回掩码。
4. **服务端代发**：对话（含 SSE）、向量化、三家搜索、两种语音协议都由服务端代发；目标地址必须过 SSRF 判定。
5. **可解释检索**：BM25 负责字面召回，向量负责语义召回，RRF 融合；没配 embedding 时明确降级而不是报错。
6. **可复核评测**：50 条固定评测集，金句在**全文**判定，answer-absent / out-of-domain 各有独立指标。

## 1.2 八条复核 blocker 的落点

| # | blocker | 本文落点 | 代码证据 | 本轮状态 |
| --- | --- | --- | --- | --- |
| B1 | 所有知识库写入点统一到可同步的存储解析器 | §3.3 | `getKbStorageForUser`（`src/lib/kbRemote.ts:512`）；5 个读写点全部改用它 | 已收口 |
| B2 | 内存 DB 分页/删除形状补精确分支 | §3.2 | `src/lib/db.ts:418-527`（删除）、`:545-595`（分页） | 已收口，8 种删除形状逐条有测试 |
| B3 | KB 文档的可解释并发策略 | §3.4 | `src/lib/kbServer.ts:450-520`、`app/api/kb/route.ts:107-146` | 文档级 CAS 已落地；CAS 不是事务，见 §7.2 |
| B4 | 记忆卡的可解释并发策略 | §3.6 | `src/lib/memoryServer.ts:84-152`、`src/lib/memoryClient.ts`、`src/lib/useLearner.ts:200-380` | 逐卡 LWW 已落地；清空竞态与单卡删除未接线，见 §7.2 |
| B5 | server 模式在 provider 就绪、TTS 就绪上真正可用 | §2.3、§5.5、§5.6 | `src/lib/provider.ts:172-240`、`:383-421`；`src/lib/tts.ts:194-241`、`:645-730` | provider/TTS 两条链已接线；搜索运行时不透传，见 §7.4 |
| B6 | 搜索供应商穷尽分支 | §5.2 | `src/lib/searchClient.ts:248-285`、`:611-635`；`src/lib/websearch.ts:274-286` | 编译期穷尽已落地；无 `search_exhausted`，见 §5.3 |
| B7 | 金句判定改全文 + answer-absent 定义指标 | §4.6 | `src/lib/ragEval.ts:232-354`、`scripts/eval-rag.ts:165-167` | 已落地；评测无质量门槛，见 §4.7 |
| B8 | DeepSeek/mimo 真机探测脚本与验证记录 | §5.7 | `scripts/probe-external.ts`、`docs/verification/2026-10-29-external-endpoints.md` | 脚本已落地；三个端点均「未验证」 |

八条按复核原话分组：B1–B4 是同步与存储，B5–B6 是 server 模式，B7–B8 是评测与验证。

## 1.3 交付物

本轮必须同时保留的交付物：

- 密钥加密存库（AES-256-GCM + `ALP_SECRET_KEY`，缺密钥 fail-closed）。
- LLM / 搜索 / TTS 三类服务端代理；LLM 代理含 SSE。
- 四张新表：`user_secrets`、`kb_docs`、`kb_chunks`、`memories`；与既有 6 张表合计 10 张。
- 知识库与记忆卡的账号同步；知识库走文档级 LWW，记忆卡走逐卡 LWW。
- BM25 + 向量 + RRF 的混合检索；向量不可用时退回 BM25 并提示。
- 50 条评测集；金句全文判定；answer-absent / out-of-domain 指标。
- README 专节：检索与存储、数据表、RAG 评测、评分对照。
- 上一版遗留六项（本轮口径见 §7.5）。

## 1.4 非目标（本轮明确不做）

- **不做跨设备同时编辑同一文档的自动合并**：只做文档级 LWW + 409 `CONFLICT_STALE`，不实现字段级/片段级 merge；冲突时提示刷新后重试。
- **不做记忆卡容量淘汰的跨设备传播**：容量淘汰只在本地生效，服务端不按「不在列表」删除；硬删除必须显式 `DELETE`。
- **不做分布式限流与用户配额**：多实例下内存限流不可靠，本轮不实现；依赖供应商限流与登录态。
- **不做 pgvector / ANN / 服务端向量索引**：向量在进程内扫描（≤800 条），不引入扩展或外部向量库。
- **MCP 的 `search_knowledge` 不接混合检索**：仍走 BM25（`app/api/mcp/route.ts:285-287`），服务端没有内建文档向量缓存。
- **不做 Prompt 版本化、v1→v2 对照评测、prompt caching、TTFT/成本统计**。
- **不做 ReAct / ToolLoopAgent、自主多步工具调用与持久化 trace 表**：README 已公开承诺不做，本轮不改变口径。
- **不做 OCR 与图像/视频多模态**：本轮多模态只覆盖 TTS 语音；扫描件 PDF 仍整份拒绝。
- **不做代理链路的真实模型 E2E**：auth-smoke 只测鉴权/配置/KB/记忆卡接口；真实 DeepSeek/mimo/embedding 调用只通过 probe-external 记录，缺凭据时标未验证。
- **不移除客户端 800 段 / 40 万字 / 200 张记忆卡上限**：按「同步服务端不设配额」解释，客户端上限仍是导入与复习队列的产品规则。
- **不做邮箱验证、找回密码、OAuth 登录**：沿用现有邮箱密码会话体系。
- **不在 CI 中真实调用 DeepSeek 搜索、mimo TTS、embedding 端点**：测试一律用 fixture / 假 fetch，真实调用只在本机 probe-external。

## 1.5 依赖、签名与契约顺序

硬约束：设计文档在 wave 3；API 请求/响应 schema 提前到 wave 1 的 `src/lib/apiContracts.ts`；wave 2/3 只能引用它，wave 3 文档做最终书面记录。这样避免「契约代码写完后补文档」。

| 依赖 | 钉死的导出 | 当前代码签名 / 偏差 |
| --- | --- | --- |
| w2-config-routes → w2-llm-proxy | `assertUpstreamAllowed` | `async function assertUpstreamAllowed(raw: string): Promise<AllowedTarget>`（`src/lib/ssrfGuard.ts:153`），一致 |
| w2-kb-memories-api → w2-llm-proxy | `embedTextsForUser` | `embedTextsForUser(userId, texts, options?)`（`src/lib/serverEmbedding.ts`），一致 |
| w3-tutor-rag | `hydrateProviderFromServer(signal?): Promise<boolean>`、`ProviderConfig.mode/serverConfigured` | 实际有两份：`src/lib/provider.ts:383` 返回 `Promise<ProviderConfig \| null>`；`src/lib/serverConfig.ts:479` 返回 `Promise<HydrateResult>`。**签名与钉死值不一致**，见 §7.2 N1 |
| w3-kb-sync | `getKbStorageForUser(userId)`、`useKnowledgeBase(directionId, userId?)`、`ensureVectors()`、`clearKbDatabase(): Promise<void>` | `getKbStorageForUser(userId?: string \| null): KbStorage \| null`（`src/lib/kbRemote.ts:512`）；`useKnowledgeBase(directionId: string, userId?: string \| null)`（`src/lib/kbStore.ts:530`）；`ensureVectors(): void`（触发加载，结果进 `vectors` 状态，`src/lib/kbStore.ts:431`、`:539`）；`clearKbDatabase(): Promise<void>`（`src/lib/kbLocal.ts:175`） |
| w3-account-memory | 直接调用上述导出 | `planAccountTransition`（`src/lib/accountTransition.ts:53`）、`clearKbDatabase`（`src/lib/useAuth.ts:116`）、`hydrateProviderFromServer`（`src/lib/useAuth.ts:169/194/218`） |

wave 结束统一跑 `npm run typecheck`；本轮实跑结果见 §8.1。

## 1.6 体积、时限与请求约束

| 项 | 方案取值 | 当前代码 | 说明 |
| --- | --- | --- | --- |
| `/api/config` 请求体 | 64 KiB | `MAX_CONFIG_BODY_BYTES = 32 * 1024`（`app/api/config/route.ts:50`） | **未收口**：方案值 64 KiB，代码仍是 32 KiB；见 §7.1 |
| `/api/kb` PUT | 8 MiB | `MAX_KB_PUT_BYTES = 8 * 1024 * 1024`（`src/lib/kbServer.ts:19`） | 一致；`readLimitedText` 边读边计数 |
| `/api/memories` PUT | 1 MiB | `MAX_MEMORIES_PUT_BYTES = 1024 * 1024`（`src/lib/memoryServer.ts:17`） | 一致；`readLimitedText` |
| `/api/llm/chat` messages | ≤50 条 × 20000 字符 | 50 条 × `CHAT_MESSAGE_MAX_CHARS = 16_000`（`src/lib/apiContracts.ts:158`） | **未收口**：方案值 20000，代码 16000；见 §7.1 |
| `/api/tts` 文本 | ≤2000 字符 | `SPEECH_MAX_CHARS = 2000`（`src/lib/tts.ts`） | 一致 |
| `/api/search`、`/api/tts` 请求体 | 必须限量 | **没有** `readLimitedText`，直接 `request.json()`（`app/api/search/route.ts:118-124`、`app/api/tts/route.ts:92-97`） | 未收口；见 §7.1 |
| 有副作用的 mutation | 只接受 `application/json` + 校验 Origin/Host | config/kb/memories/llm/search/tts 已做；progress/auth/directions/directions/generate/directions/items/mcp 未统一 | 见 §7.2、§7.4 |
| 运行环境 | `runtime = "nodejs"`；chat `maxDuration = 300` | chat 已导出（`app/api/llm/chat/route.ts:46-47`）；`/api/kb` PUT 未导出 `maxDuration` | 见 §7.2 |
| npm 依赖 | 不新增 | `git diff -- package.json` 只有 scripts 三行 | 见 §8.3 |

# 密钥：加密、两种通道、SSRF 边界

## 2.1 威胁模型

| 资产 | 位置 | 谁能读 |
| --- | --- | --- |
| 供应商密钥（明文） | 请求内存、`ALP_SECRET_KEY` 环境变量 | 服务端进程 |
| 供应商密钥（密文） | `user_secrets.secret_ct / secret_iv / secret_tag` | 数据库读者（无主密钥不可解） |
| 密钥掩码 | `user_secrets.secret_hint`、`GET /api/config` 的 `hint` | 登录用户本人 |
| 知识库正文 | `kb_docs` / `kb_chunks`，以及 IndexedDB `alp-kb-v1` | 用户本人（SQL 恒带 `user_id`） |
| 记忆卡 | `memories.payload` | 用户本人 |
| 会话 | Cookie `alp_session`（httpOnly、sameSite=lax、14 天） | 浏览器与服务端 |

信任边界有两条：**浏览器 BYOK 直连**（local 模式，密钥在 localStorage）与**服务端代发**（server 模式，密钥在 `user_secrets` 密文）。两条并存，由设置页的调用模式切换；server 模式下密钥不再进浏览器，但服务端必须持有主密钥。

## 2.2 AES-256-GCM 与 fail-closed

| 项 | 定稿值 | 代码证据 |
| --- | --- | --- |
| 算法 | `aes-256-gcm` | `src/lib/secretCrypto.ts:18` |
| 主密钥 | 32 字节随机数的**标准 base64**（44 字符含 `=`） | `src/lib/secretCrypto.ts:24`、`:84-100` |
| 严格 base64 | 解码后长度必须是 32，且重新编码与输入逐字符相等；挡住 base64url、去填充、夹空白 | `src/lib/secretCrypto.ts:90-96` |
| 主密钥版本 | `ALP_SECRET_KEY_ID`，缺省 `v1`，落 `secret_kid` | `src/lib/secretCrypto.ts:98-106` |
| IV | 12 字节随机，每次加密新生成 | `src/lib/secretCrypto.ts:20`、`:137` |
| Tag | 16 字节 | `src/lib/secretCrypto.ts:22`、`:142` |
| AAD | UTF-8 字符串 `user_secrets:${userId}:${kind}` | `src/lib/secretCrypto.ts:108-116` |
| 明文下限 | 8 个码点；更短抛 `SECRET_TOO_SHORT` | `src/lib/secretCrypto.ts:26`、`:124-134` |
| 存储编码 | ct / iv / tag 均标准 base64；tag 与 ct 分开存 | `src/lib/db.ts` 的 `user_secrets` 表 |

**fail-closed 三条硬规则**：

1. 缺主密钥或格式不对 → 一律 `503 KEY_ENC_UNAVAILABLE`；绝不退化为明文落库，绝不在运行时随机生成一把密钥「先存进去」。
2. 内存后端（`dbBackend() === "memory"`）保存密钥 → `503 PERSISTENCE_UNAVAILABLE`；只有测试显式设 `ALP_ALLOW_MEMORY_SECRETS=1` 才放行（`src/lib/userSecrets.ts:341-349`）。
3. `db.ts` 在 `DATABASE_URL` 缺失时静默退化为进程内内存（`src/lib/db.ts:756-760`）的模式**不得复制到密钥路径**：密钥写不进去时必须报错，而不是「写成功、重启即丢」。

密钥生成（不要用口令）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

掩码：

- `maskSecret`：长度 ≤ 8 只回四个圆点；更长回前 4 + `••••` + 后 4（`src/lib/secretCrypto.ts:208-212`）。
- `secretHint`：落库的 hint 对 ≤8 位返回「••••」，更长只露末 4 位，连前缀都不给（`src/lib/secretCrypto.ts:218-222`）。
- 固定四个圆点，长度不随密钥变化，避免从掩码长度反推原文长度。

## 2.3 两种密钥通道与 provider 水合

`ProviderConfig` 增加 `mode: "local" | "server"` 与 `serverConfigured`（`src/lib/provider.ts:45-82`）：

- **local**：浏览器直连；`apiKey` 在 localStorage，`loadProvider` 要求 `baseUrl/apiKey/model` 三项齐全。
- **server**：服务端代发；浏览器 `apiKey` 恒为空，`loadProvider` 只认显式 `mode === "server"` 且 `serverConfigured === true`，**不把「apiKey 为空」当成未配置**（修复 `provider.ts:160-161` 返回 `null` 导致新设备永远走「未配置」的问题）。
- 旧存档有 `apiKey` 且没有 `mode` → 按 local 解释。
- 登录且非 local 默认 server；未登录强制 local。
- server 模式 `saveProvider` 不写 `apiKey`，并显式写空串覆盖 local 期残留的 key（`src/lib/provider.ts:240-262`）。

水合：`hydrateProviderFromServer()`（`src/lib/provider.ts:383`）在登录 / 刷新 / 页面挂载时 `GET /api/config`，把非密配置（label/api/baseUrl/model/thinking/verification/embedding*）写回 localStorage 并置 `serverConfigured`；有 llm 行时 `apiKey` 为空；无 llm 行时 `serverConfigured=false`，但不覆盖仍可用的 local 配置；401 / 网络错误 / 形状不对返回 `null`，不动本地。

就绪判定只有一个：`isProviderReady(config)`（`src/lib/provider.ts:289`）。server 模式只看 `serverConfigured`，local 模式看 baseUrl / apiKey / model。页面不得再用 `if (!provider)` 判就绪。

## 2.4 密钥种类与 embedding 解耦

`user_secrets.kind` 四选一：`llm` / `search-deepseek` / `search-tavily` / `tts`。

- `llm` 加密保存 `{ apiKey, extraHeaders?, embeddingApiKey? }`；公开 options 白名单含 `embeddingBaseUrl` / `embeddingModel` / `embeddingStatus` / `thinking` / `thinkingStatus` / `verification`（`src/lib/userSecrets.ts:42-55`）。注意 `embeddingStatus` 目前没有写入方：`configPut` 没有该字段，`/api/config` 不会保存它；客户端只在本地 provider 状态里记录，水合时从 options 读取（若行里有值）。
- 搜索行各自保存 `apiKey`；`search-deepseek` 允许可选 `baseUrl`，但代理固定官方端点（§5.1）。
- `tts` 行保存 `apiKey`（浏览器语音可为空），`options.protocol ∈ speech|chat-audio`。

embedding 的解析顺序（`src/lib/serverEmbedding.ts:42-76`）：

1. `ALP_EMBED_BASE_URL` + `ALP_EMBED_API_KEY` + `ALP_EMBED_MODEL` 三项齐全 → 用服务端级配置；
2. llm 行的独立 `embeddingBaseUrl` + `embeddingApiKey` + `embeddingModel`；
3. llm 行同源 `baseUrl` + `apiKey` + `embeddingModel`；
4. 都没有 → 返回 null，`/api/llm/embeddings` 回 `503 EMBEDDING_UNAVAILABLE`。

这条顺序解决两件事：DeepSeek chat 用户把 `baseUrl` 指向 `api.deepseek.com` 时，`/v1/embeddings` 必 404；阿里云 embedding 只有换 chat 端点才可达。把 embedding 的地址与密钥独立出来，chat 与 embedding 才能各自用对的供应商。

## 2.5 SSRF 判定链

服务端代发允许用户填 `baseUrl`，这是本项目唯一可能把请求打到内网的入口。判定分三层：

1. **形状**（`checkUrlShape`，`src/lib/ssrf.ts:119`）：默认只允许 https；http 只对 `ALP_ALLOW_HTTP_PROVIDER_HOSTS` 的 `host[:port]` 放行（条目不带端口补 `:80`，大小写不敏感，支持 `[v6]:port`）。这个白名单是**部署级逃生口**：命中它的 host:port 同时允许 http 与私网地址（含字面量与 DNS 解析结果），用于运维自己控制的自建/本地模型端点；它不是「关闭 SSRF」的开关，未命中的目标仍逐条检查。形状层还拒绝 userinfo、https 非 443、超过 2048 字符、`metadata.google.internal` / `metadata.amazonaws.com`（含末尾点写法），并对字面量内网 IP 直接判 `blocked-address`（命中白名单时除外）。
2. **DNS 逐条**（`assertUpstreamAllowed`，`src/lib/ssrfGuard.ts:153`）：`dns.lookup(host, { all: true, verbatim: true })` 解析全部 A/AAAA；**未命中白名单时**任一条落在环回/私网/链路本地/CGNAT/198.18/15/组播/未指定/保留段就整体拒绝。IPv4-mapped（`::ffff:0:0/96`）与 NAT64（`64:ff9b::/96`）先拆出内层 IPv4 再判定。
3. **连接钉 IP**（`guardedRequest`，`src/lib/ssrfGuard.ts:262`）：用 `node:https/http` + 自定义 `lookup` 把连接钉在已判定的 IP，SNI 与 `Host` 仍用原主机名；3xx 一律不跟随，返回给调用方处理。

调用点：

- 配置入口：`/api/config` PUT 对 `llm.baseUrl`、`llm.embeddingBaseUrl`、`tts.baseUrl`、`search-deepseek.baseUrl` 逐条调用 `assertUpstreamAllowed`（`app/api/config/route.ts:321-343`）。
- 每次代发：`/api/llm/chat`（`app/api/llm/chat/route.ts:171-179`）、`embedTextsForUser`（`src/lib/serverEmbedding.ts:94`）、`/api/tts` 的 `assertUpstreamAllowed` + `postAudio` 二次判定（`app/api/tts/route.ts:130`、`src/lib/serverTts.ts:170-175`）。
- 搜索端点写死在 `serverSearch.ts`，不接受调用方传 URL；DeepSeek 复用 llm 密钥时也只发官方域名，且要求 llm 的 `base_url` host 严格等于 `api.deepseek.com`（`isDeepSeekBaseUrl`，`src/lib/serverSearch.ts:353-362`）。

**边界说明**：`provider.ts` 的 `checkBaseUrl` / `isLocalAddress` 只是浏览器 UX 提示，不是 SSRF 防御；真正的拦截在服务端。

## 2.6 代理契约与错误码

### `/api/llm/chat`

- 方案契约只允许 `kind` / `system` / `user` / `messages` / `maxTokens` / `temperature` / `jsonMode` / `thinking` / `stream`；出现 `baseUrl` / `apiKey` / `model` 即 400。
- **当前实现比方案窄**：`apiContracts.llmChat` 只有 `messages` / `temperature` / `maxTokens` / `stream`（`src/lib/apiContracts.ts:165-178`），`/api/llm/chat` 局部追加可选 `kind`（`app/api/llm/chat/route.ts:62-64`）；`system` / `user` / `jsonMode` / `thinking` 尚未进入契约。`thinking` 实际由服务端配置 `options.thinking` 决定，`jsonMode` 见 §7.4 N28。
- 服务端从 `user_secrets` 读取配置，上游只能经 `guardedRequest(target)` 发起；禁止在路由里直接 `fetch` 用户配置的地址。
- SSE 响应头只设 `Content-Type` / `Cache-Control` / `X-Accel-Buffering`，不复制上游的 `content-encoding` / `content-length` / `transfer-encoding` / `connection`。
- headers 已发出后的中途错误：先写一帧 `data: {"error":{"message":"..."}}`（message 过 `redactSecrets`），再关闭；不能直接 close 让客户端把截断当正常结束。

### 错误码与状态

方案统一码（大写是本文的语义名；当前实现仍混用小写契约码与路由私有码，见 §7.1）：

| 状态 | 码 | 语义 |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | 未登录 |
| 403 | `CROSS_ORIGIN` | Origin/Host 不同源 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 非 `application/json` |
| 400 | `INVALID_BODY` / `SECRET_TOO_SHORT` / `SSRF_BLOCKED` | 请求体 / 密钥过短 / 地址被拒 |
| 404 | `CONFIG_MISSING` | 账号还没有对应配置 |
| 409 | `CONFIG_STALE` / `CONFLICT_STALE` | 配置版本 / KB 文档版本冲突 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求体超限 |
| 500 | `SECRET_UNREADABLE` / `KEY_KID_UNKNOWN` | 密文损坏 / 主密钥版本不符 |
| 502 | `UPSTREAM_ERROR` / `SSRF_REDIRECT` | 上游失败 / 上游重定向被拒 |
| 503 | `KEY_ENC_UNAVAILABLE` / `PERSISTENCE_UNAVAILABLE` / `EMBEDDING_UNAVAILABLE` | 缺主密钥 / 内存后端 / 无 embedding |

所有响应与日志不得出现 `apiKey` / `extraHeaders` / 密文；上游错误先过 `redactSecrets`（`src/lib/upstream.ts:162-181`），搜索与 TTS 各有 `sanitizeUpstreamText` / `sanitize`，只保留 200 字符。

## 2.7 密钥轮换与残余风险

**当前只支持一把主密钥。** `resolveSecretKey` 只读 `ALP_SECRET_KEY` / `ALP_SECRET_KEY_ID`；`openSecret` 要求行上的 kid 等于当前 kid（`src/lib/secretCrypto.ts:157-168`）。轮换后旧行统一报 `KEY_KID_UNKNOWN`，必须让用户重存一次；没有「新旧密钥并存、逐行迁移」的自动路径。

轮换 runbook：

1. 生成新密钥，记 kid（如 `v2`）。
2. 备份 `user_secrets` 的 `user_id, kind, secret_kid, updated_at`（不导出密文）。
3. 同时设置 `ALP_SECRET_KEY=<新值>` 与 `ALP_SECRET_KEY_ID=v2`，重启。
4. 预期：GET 仍回 `configured: true` 与 hint；PUT（不带新 apiKey）409 `SECRET_UNREADABLE` / `KEY_KID_UNKNOWN`；chat 500 同类码；search/tts 500 `secret_key_missing`。
5. 让每个用户在设置页重填一次；TTS 浏览器语音也保存一次，把 `secret_kid` 写成 v2。
6. 验收：`SELECT secret_kid, count(*) FROM user_secrets GROUP BY secret_kid` 只剩 `v2`；`/api/health` 带 token 时 `keyEncryption: "ok"`。
7. 回滚同样不是无损：已迁移到 v2 的行在 v1 下报 `KEY_KID_UNKNOWN`。

残余风险：数据库泄露（无主密钥不可解）、主密钥泄露（全部可解）、内存后端误上生产（密钥被拒、KB 看似成功实则丢失）、用户 baseUrl 指向内网（被 SSRF 拒绝，白名单见 §7.1）、客户端声明向量（服务端只校验维度与有限性，不校验语义）、没有限流（登录用户可无限调用代发与 8 MiB PUT）。

# 同步：知识库与记忆库的数据表与冲突策略

## 3.1 四张新表

与 `src/lib/db.ts` 的 `SCHEMA` 逐字一致（`src/lib/db.ts:781-936`）：

```sql
CREATE TABLE IF NOT EXISTS user_secrets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  api TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '{}',
  secret_ct TEXT NOT NULL DEFAULT '',
  secret_iv TEXT NOT NULL DEFAULT '',
  secret_tag TEXT NOT NULL DEFAULT '',
  secret_kid TEXT NOT NULL,
  secret_hint TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS kb_docs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  direction_id TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  size BIGINT NOT NULL,
  page_count INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  kc_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_kb_docs_direction ON kb_docs(user_id, direction_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  user_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  direction_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  page_from INTEGER,
  page_to INTEGER,
  text TEXT NOT NULL,
  embedding TEXT,
  embedding_model TEXT,
  embedding_dim INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, chunk_id),
  FOREIGN KEY (user_id, doc_id) REFERENCES kb_docs(user_id, doc_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_direction ON kb_chunks(user_id, direction_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_direction_chunk ON kb_chunks(user_id, direction_id, chunk_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(user_id, doc_id);

CREATE TABLE IF NOT EXISTS memories (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mem_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  kc_id TEXT NOT NULL,
  with_kc_id TEXT,
  question_id TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, mem_id)
);
CREATE INDEX IF NOT EXISTS idx_memories_subject ON memories(user_id, subject_id);
```

既有 6 张表（本轮不改）：`users`、`sessions`、`progress`、`directions`、`direction_picks`、`direction_items`；合计 10 张。建表在每次进程首次 `getDb()` 时幂等执行。

列语义与不变量：

| 表 / 列 | 不变量 |
| --- | --- |
| `user_secrets.kind` | 四选一，同时是 PUT 判别值 |
| `user_secrets.secret_ct` | 允许空串：TTS 浏览器语音没有密钥，不是加密失败 |
| `user_secrets.options_json` | 只存白名单字段；`apiKey` / `embeddingApiKey` / `extraHeaders` 一律进密文 |
| `kb_docs.page_count` | NOT NULL；非 PDF 存 0，读回折叠成「没有页码」 |
| `kb_docs.chunk_count` | 必须等于提交的 `chunks.length`，否则整单拒绝 |
| `kb_docs.updated_at` | TEXT 列写毫秒数；读回兼容历史 ISO 行 |
| `kb_chunks.embedding` | JSON 数组文本；`embedding_dim` 必须等于数组长度，非法向量读回 null |
| `kb_chunks` 外键 | 删文档级联删片段；内存实现手动模拟 |
| `memories.payload` | 整张卡 JSON；读回必须过 `parseMemories` 清洗，单行损坏只丢这一张 |
| `memories.mem_id` | 每用户全局唯一；同一张卡可以换学科（`subject_id` 会被覆盖） |
| `memories.updated_at` | 版本号，ISO = `max(lastSeenAt, createdAt)` |

## 3.2 内存 DB 的精确分支

内存实现靠「归一化后按子串匹配」分派；漏一个分支就是静默 `return 0` / `[]` / `null`。每条形状都必须有独立测试（`src/lib/db.test.ts`）。

### 写入

| SQL 形状 | 分支 | 返回值 |
| --- | --- | --- |
| `INSERT INTO user_secrets ... ON CONFLICT (user_id, kind) DO UPDATE` | `upsertRow`，键 `${user_id}|${kind}`；冲突列必须是 `(user_id, kind)` | 1 |
| `INSERT INTO kb_docs ... ON CONFLICT (user_id, doc_id) DO UPDATE` | `upsertRow`，键 `${user_id}|${doc_id}` | 1 |
| `INSERT INTO kb_chunks ... ON CONFLICT (user_id, chunk_id) DO UPDATE` | `upsertRow`，键 `${user_id}|${chunk_id}` | 1 |
| `INSERT INTO memories ... ON CONFLICT (user_id, mem_id) DO UPDATE` | `upsertRow`，键 `${user_id}|${mem_id}` | 1 |

`upsertRow` 的失败语义：没写 `ON CONFLICT` 的重复插入抛 `duplicate key`（对齐 Postgres 23505）；冲突列与主键不一致抛错；`DO NOTHING` 命中返回 0。`parseInsert` 只认「列名列表与 `$n` 一一对应」，遇到不认识的赋值表达式宁可抛错。

### 删除（顺序即正确性）

| SQL 形状 | 判定顺序 | 返回值 |
| --- | --- | --- |
| `DELETE FROM user_secrets WHERE user_id = $1 AND kind = $2` | 唯一形状 | 1 / 0 |
| `DELETE FROM kb_docs WHERE user_id = $1 AND doc_id = $2` | 先判 `doc_id =` | 删除文档数；级联删片段 |
| `DELETE FROM kb_docs WHERE user_id = $1 AND direction_id = $2` | 再判 `direction_id =` | 文档数；级联删该方向全部片段 |
| `DELETE FROM kb_chunks WHERE user_id = $1 AND chunk_id = $2` | **先判 `chunk_id =`** | 1 / 0 |
| `DELETE FROM kb_chunks WHERE user_id = $1 AND doc_id = $2` | 再判 `doc_id =` | 删除条数 |
| `DELETE FROM kb_chunks WHERE user_id = $1 AND direction_id = $2` | 最后判 `direction_id =` | 删除条数 |
| `DELETE FROM memories WHERE user_id = $1 AND mem_id = $2` | 先判 `mem_id =` | 1 / 0 |
| `DELETE FROM memories WHERE user_id = $1 AND subject_id = $2` | 再判 `subject_id =` | 删除条数 |

两个顺序是硬要求：`kb_docs` 先判 `doc_id` 再判 `direction_id`，否则「删一篇」会被当成「删整个方向」；`kb_chunks` 先判 `chunk_id` 再 `doc_id` 再 `direction_id`，三种键都含 `id =`，顺序错了会把「删一段」当成「删整篇」。

### 查询与分页

| SQL 形状 | 分支 | 结果 |
| --- | --- | --- |
| `SELECT * FROM user_secrets WHERE user_id = $1`（可带 `kind = $2`） | `all`：按 user_id 过滤，有 `kind =` 再按 kind，最后按 kind 排序 | 行数组 |
| `SELECT * FROM user_secrets WHERE user_id = $1 AND kind = $2` | `one`：必须排在 `from users` 之前 | 行 / null |
| `SELECT * FROM kb_docs WHERE user_id = $1 AND doc_id = $2` | `one` | 行 / null |
| `SELECT * FROM kb_docs WHERE user_id = $1 [AND direction_id = $2]` | `all`：可选方向过滤，按 `created_at` 排序 | 行数组 |
| `SELECT * FROM kb_chunks WHERE user_id = $1 AND direction_id = $2 ORDER BY doc_id, idx` | `all`：方向过滤；有 `doc_id =` 再过滤 | 行数组 |
| `SELECT chunk_id, doc_id FROM kb_chunks WHERE user_id = $1 AND doc_id = $2 ORDER BY chunk_id` | `all`：命中 `order by chunk_id` 分支 | 行数组 |
| `SELECT chunk_id, embedding, embedding_model, embedding_dim FROM kb_chunks WHERE user_id = $1 AND direction_id = $2 AND chunk_id > $3 ORDER BY chunk_id LIMIT $4` | **先判 `chunk_id >`**；参数顺序固定 `user_id, direction_id, after, limit` | 升序切片，`limit` 可为 `pageSize + 1` |
| `SELECT mem_id, updated_at FROM memories WHERE user_id = $1` | `all`：无 `subject_id` 过滤 | 该用户全部卡的行 |
| `SELECT * FROM memories WHERE user_id = $1 AND subject_id = $2` | `all`：有方向过滤 | 行数组 |
| `SELECT * FROM progress ...` | `all`：有 `user_id =` 按用户，否则全部 | 行数组 |

分页分支必须排在方向过滤之前：分页 SQL 同时含 `direction_id = $2` 与 `chunk_id > $3`，先命中方向过滤会把整个方向的向量一次返回，游标永远推不动（`src/lib/db.ts:555-573`）。

「静默成功」的四个出口：`run` 末尾 `return 0`、`all` 末尾 `return []`、`one` 末尾 `return null`、`ensureSchema` 吞掉「内存实现不认 CREATE TABLE」的错误。因此每条 DELETE 形状、分页游标、`write → read` 成对断言都必须有测试。

## 3.3 知识库写入点收敛

| # | 动作 | 调用点 | 走的函数 |
| --- | --- | --- | --- |
| 1 | 上传导入 | `src/components/knowledge-upload.tsx:349` | `getKbStorageForUser(userId)` → `importDocument` |
| 2 | 删除文档 | `src/components/knowledge-base-panel.tsx:111` | `getKbStorageForUser(userId)` → `deleteDocument` |
| 3 | 绑定知识点 | `src/components/knowledge-base-panel.tsx:129` | `getKbStorageForUser(userId)` → `updateDocKcIds` |
| 4 | 方向页读库 | `app/directions/page.tsx:659` | `getKbStorageForUser(userId)` → `loadDirectionKb` |
| 5 | 导师/诊断 hook | `src/lib/kbStore.ts:560`（文档）、`:609`（向量） | `getKbStorageForUser(userId)` → `loadDirectionKb` / `loadVectors` |

实现分三层，职责不重叠：

- `src/lib/kbLocal.ts`：IndexedDB 适配器。`getDefaultKbStorage` 只在本机模式使用；`clearKbDatabase` 先 `closeKbDb` 再 `deleteDatabase`；`onblocked` 最多等 2 秒后 resolve（`src/lib/kbLocal.ts:175-205`）。
- `src/lib/kbRemote.ts`：远端适配器 `createRemoteKbStorage` 与复合存储 `createSyncedKbStorage`。
- `src/lib/kbRemote.ts:512` 的 `getKbStorageForUser` 是**全部知识库写入点的唯一入口**：未登录返回本机存储；登录返回「本地 + 远端」复合存储；浏览器没有 IndexedDB 时退化为纯远端。同一账号复用同一实例（`syncedStorages`，`:504`）。

`src/lib/kbStore.ts:39-58` 重新导出这些函数，页面的 import 不需要知道文件拆分。`useKnowledgeBase(directionId, userId?)` 在方向/账号变化时先 `reset` 清空 docs/chunks/vectors，再进入 loading（`src/lib/kbStore.ts:543-547`）；消费方（诊断页、知识点面板）再按 `directionId` 过滤一次。

## 3.4 KB 文档级 LWW 与 409

`baseUpdatedAt` 是客户端**最后读到的** `doc.updatedAt`，新建传 `null`。服务端规则（`src/lib/kbServer.ts:450-489`）：

| 服务端 | `baseUpdatedAt` | 结果 |
| --- | --- | --- |
| 无此文档 | `null` | 写入 |
| 无此文档 | 非 null | 409：客户端以为存在，其实已被别的设备删除 |
| 有此文档 | `null` | 409：客户端以为不存在，其实已被别的设备导入 |
| 有此文档 | 等于库中版本 | 写入；新版本 = `max(Date.now(), 旧版本 + 1)` |
| 有此文档 | 不等于 | 409，且**不写任何行** |

CAS 检查在任何写之前，因此 409 时不会留下半份文档。片段不做独立版本号：它们属于文档，随文档一起被替换。上传文档的 chunks 在导入后不可变；改绑定只重写同一 chunk 集（`src/lib/kbStore.ts:355-390`），因此不会出现「旧快照删新片段」。

写顺序：CAS → upsert doc → 补齐向量 → upsert chunks → 删除本次列表外的旧片段（`src/lib/kbServer.ts:443-557`）。中途失败最多留下「文档已更新、旧片段还没删」的多余行，不会出现「文档存在而片段全丢」。客户端重试会因版本已变拿到 409，必须先 `GET` 再重放。

**这不是线性化**：CAS 是「先 `SELECT` 再 `INSERT`」，两条语句不在一个事务里。两个并发 PUT 且 `baseUpdatedAt` 相同，可能都通过检查，最终后写者覆盖，双方都收到 200。要消除窗口，需要把条件写进 `UPDATE ... WHERE updated_at = $base` 并检查受影响行数（或 `SELECT ... FOR UPDATE` 包事务）；当前未实现（§7.2 N3）。

删除与在途 PUT：`DELETE` 没有版本前置条件，永远生效。A 删除后，B 的在途 PUT（`baseUpdatedAt` 非 null）→ 409；B 的 PUT（`baseUpdatedAt: null`）在删除后落地 → 文档复活。这是 LWW 的必然后果；要禁止复活需要 tombstone，本轮不做。

客户端解释 409：`createRemoteKbStorage` 把 `res.status === 409` 统一翻译成 `KbConflictError`（`src/lib/kbRemote.ts:201-204`），文案固定为「文档已在其他设备更新，请刷新后重试。」；上层只做两件事：刷新 `GET ?docId=`，或用户显式「以本机覆盖」（用最新 `updatedAt` 再发一次 PUT，不是自动重试）。

## 3.5 KB 读路径、首同步与删除

1. **模式判定**：`getKbStorageForUser` 以「有没有 userId」判定；空串/null 走本机，其余走复合存储。
2. **写穿顺序**：本地 `putDocWithChunks` 先写（原子事务）；成功后 `PUT /api/kb`。本地失败必须让调用方看到；远端非 409 失败只记 `syncWarning`，不抛（`src/lib/kbRemote.ts:449-467`）。「本地成功、远端失败」仍算保存成功，但界面必须显示未同步。
3. **读合并**：本地与远端按 id 求并集，**远端同名条目覆盖本地**（`mergeDocs`，`src/lib/kbRemote.ts:313-322`）。远端失败时只用本地，并留下 `KB_UNAUTHORIZED_WARNING` 或网络告警（`:104-110`）。
4. **首次回传**：某方向第一次读到远端时，把「本地有、远端无」的文档推一次（`pushLocalOnly`，`:357-389`）；409 视为别的标签页已推过，跳过。这保证匿名期的上传在登录后不会丢。
5. **删除**：先删本地，再 `DELETE /api/kb?docId=`；远端失败只告警（`:469-478`）。换设备仍会看到这份文档，界面必须显示。
6. **向量**：只有远端有向量。`useKnowledgeBase(...).ensureVectors()`（`src/lib/kbStore.ts:539`）首次调用才拉 `?vectors=1` 分页（`loadVectors`，`src/lib/kbRemote.ts:286-307`）；未登录或本地存储没有向量时返回空表，检索退化为 BM25。
7. **账号切换**：`planAccountTransition` 决定清理；`clearKb` 为真时调用 `kbLocal` 的 `clearKbDatabase`（`src/lib/useAuth.ts:116`）。登出无条件全清并删调用模式键。

写入协议与失败语义：

| 场景 | 本地 | 远端 | 用户看到 |
| --- | --- | --- | --- |
| 未登录 | 写 IndexedDB | 不请求 | 「已存本机」 |
| 登录 + 首次导入 | 写 IndexedDB | `PUT`，`baseUpdatedAt: null` | 「已同步」 |
| 登录 + 覆盖已有文档 | 写 IndexedDB | `PUT`，`baseUpdatedAt` 由 `doc.updatedAt` 推导 | 「已同步」 |
| 远端不可达 / 5xx | 写 IndexedDB | 失败，记录 `syncWarning` | 「已存本机，尚未同步到账号」 |
| 远端 409 | **已经写入本地** | 抛 `KbConflictError`，不重试 | 「文档已在其他设备更新，请刷新后重试。」 |
| 远端 400 | 已经写入本地 | 抛 `KbRemoteError`；复合存储捕获后只告警 | 告警文案；本次本地内容保留 |
| 删除 | 先删本地，再删远端 | `DELETE`；失败只告警 | 「已删除」+「换设备仍会看到」的告警 |

两个必须说清的点：

1. **没有回滚**。本地写入成功后远端失败，本地不会撤销。这是「本地是主副本」的取舍：断网时上传仍然可用，代价是对账号的副本可能落后。
2. **409 的返回值自相矛盾**。`importDocument` 的 409 分支走 `failure()`，其 `written: 0` 是写死的（`src/lib/kbStore.ts:210-212`），但界面只展示 `result.error`（冲突文案），并不展示 `written`；`written` 目前没有 UI 消费方。不是用户可见的「已导入 0/N」，但类型语义仍不一致（§7.2 N10）。

## 3.6 记忆卡逐卡 LWW

- 版本 = `max(lastSeenAt, createdAt)` 的毫秒数（`src/lib/memoryServer.ts:70-76`）。这两个时间都由客户端在作答/复习时写入，比服务器接收时间更能代表「这张卡实际更新的时刻」。
- 写入规则：只为提交里出现的卡写行；`existing.updated_at > incoming` 才跳过，相等时写入（同一张卡重复提交，结果应一致）。
- `skippedStale` 是信息性计数：客户端应显示「N 张旧卡未写入，已保留服务端较新版本」，而不是报错。
- `PUT /api/memories` 是 **upsert**，不是快照替换：不在列表里的 `mem_id` 原样保留；删除只有 `DELETE ?memId=` 或 `DELETE ?subjectId=` 两种。
- 理由：两台设备各删各的却都以为成功，是同步里最难解释的状态。显式删除让「删」成为一个可确认的动作。
- 客户端现状：`clearMemories` 已接在「清空学科」上（`src/lib/useLearner.ts:415`）；单卡删除 `deleteMemory`（`src/lib/memoryClient.ts:91-104`）还没有 UI 调用方，界面移除一张卡后只靠快照 PUT 同步，而 PUT 不删行，下一次拉取会把它复活（§7.2 N15）。

这与 KB 的「整篇替换」不同：KB 的 PUT 会删掉本次列表外的旧片段，因为片段是文档的一部分；记忆卡之间没有从属关系。

## 3.7 记忆卡合并、离线与删除

`src/lib/memorySync.ts` 是纯函数层，接线在 `useLearner` 与 `memoryClient`：

- `stripMemories`：落库前把 `memories` 从 progress 里摘掉，返回值里不出现这个键（不是空数组）。
- `withMemories`：读回时把服务端返回的卡装回某学科；学科不存在就补一份空进度。
- `mergeMemories`：按 id 求并集；两侧都有的比较 `lastSeenAt`，较新者整张胜出（不做字段级拼接）；时间相同保留本机；最后按 `lastSeenAt` 截到 200。
- `memoriesEqual`：逐字段指纹比较（字段排序后序列化），与顺序无关，用于判断是否需要写回。

读写路径（`src/lib/useLearner.ts:200-320`、`:336-348`）：

1. 登录后先等进度落地，再 `pullMemories(subjectId)`（`src/lib/memoryClient.ts:25-43`）。返回 `null` 表示 401/网络/形状错误，**不等于服务端为空**；此时只回填登录时摘下来的卡，不覆盖本地。
2. 拿到数组才与本地 `mergeMemories`；有变化才写回 learner。
3. 升级迁移：只在该学科「登录时进度里有卡 + 服务端为空」时推一次 `pushMemories`；切换学科时 seed 为空，不会拿本机缓存复活另一台设备明确删掉的卡。
4. 每次 `setLearner` 把进度与记忆卡拆成两条防抖队列，分别写 `/api/progress` 与 `/api/memories`。
5. 清空学科时显式 `clearMemories`（`:407`）。`deleteMemory` 是唯一不会被下次快照复活的删除方式，但目前还没有 UI 调用。

「读取仍做并集，离线创建的内容可见」只对记忆卡成立：本地新建的卡会与远端按 id 合并，断网时仍显示。**进度不是并集**：`mergeServerProgress` 对服务端存在的学科整科覆盖本地 mastery/attempts（`src/lib/learner.ts:317-326`），同学科的匿名作答会丢；README 已把这写成「服务端单权威」的取舍，但 `accountTransition.ts` 的注释「并入账号」与实现不完全一致（§7.2 N14）。

## 3.8 账号切换与跨标签页

`planAccountTransition(prevOwner, nextEmail)`（`src/lib/accountTransition.ts:53-69`）是纯函数，返回 5 个字段：

| 场景 | clearLearner | clearKb | clearSecrets | clearMaterials | nextOwner |
| --- | --- | --- | --- | --- | --- |
| A→B | true | true | true | true | B |
| A→null | true | true | true | true | null |
| null→B | false | false | false | false | B |
| B→B / null→null | false | false | false | false | 不变 / null |

- 邮箱比较去空白且不区分大小写；`A→B` 只按邮箱判断，`user.id` 变化但邮箱相同由 `useAuth` 的 `idChanged` 兜底补一次全清。
- 登录/注册/refresh 成功后调用 `hydrateProviderFromServer()`；refresh 只在收到 200 时执行切换，5xx/断网不动本机数据。
- 登出无条件全清（含 `alp.subject`），网络失败也照清（`src/lib/useAuth.ts:224-242`）。
- 换号的 KB 清理是 `void clearKbDatabase()`，不等待完成；`clearKbDatabase` 在 `onblocked` 时最多 2 秒就 resolve（§7.2 N12）。

**认证状态不是全局单例**：每个 `useAuth()` 调用方各持一份 `useState`，只在挂载时 `refresh` 一次；没有 `storage` / `visibilitychange` / `BroadcastChannel` 监听（全仓唯一的 `storage` 监听在 `materialStore.ts:122`，只关教材）。后果见 §7.2 N15。

## 3.9 已知不可解释的边界

| 情况 | 结果 | 为什么接受 |
| --- | --- | --- |
| 设备 A 时钟快 10 分钟 | A 的旧卡永远赢 | `lastSeenAt` 是唯一双方都能比较的顺序；服务端接收时间同样不公平，且更隐蔽 |
| 两台设备同时改同一张卡 | 后提交者可能被跳过，也可能覆盖；取决于到达顺序与版本比较 | 无向量时钟；`skippedStale` 让用户至少能看到「有卡没写进去」 |
| 并发 PUT | 先读全量 `updated_at` 再逐条写，两个请求可能交错 | 单卡 LWW 是幂等的；最终状态是某一次写入的完整卡片，不会字段级混合 |
| 卡片换学科 | `subject_id` 被覆盖，卡从旧学科消失 | `PRIMARY KEY (user_id, mem_id)` 决定「一张卡只属于一个学科」 |
| 删除后另一台旧快照 PUT | 卡复活 | 与 KB 删除同理；要禁止需要 tombstone（未实现） |

# 检索：BM25 + 向量 + RRF 的融合与降级

## 4.1 BM25

- 中文 bigram + 单字：`tokenize` 把「时间复杂度」切成 bigram 与单字；纯 ASCII 词整体作为一个 token（`src/lib/rag.ts:33-52`）。
- 单字权重 0.35（`SINGLE_CHAR_WEIGHT`）：单字区分度低，不加权会淹没 bigram。
- 参数 `K1 = 1.5`、`B = 0.75`；IDF 用 `log(1 + (N - df + 0.5) / (df + 0.5))`，加 1 防止负值（`src/lib/rag.ts:64-68`、`:125-139`）。
- 阈值 `MIN_SCORE = 0.5`：低于它不返回——宁可不给依据，也不给无关依据。
- 标题加权：`titleBoost > 1` 时，每条命中的标题词额外追加 `(titleBoost - 1) * idf * tf / (tf + K1)`；默认 1 表示整段分支不执行，分数与未加权实现逐位一致（`src/lib/rag.ts:94-103`、`:141-148`）。导师页的知识点检索用默认 1；评测用 2。
- 检索范围：内置/自定义方向的知识点用 `target.graph.concepts` 现建索引、纯 BM25（`app/tutor/page.tsx:347`）；上传片段走混合检索。两条不是同一份语料，§4.6 的评测只覆盖前者。
- `search()` 返回的 `snippet` 是 `text.slice(0, 160)`（`src/lib/rag.ts:160`），只用于展示；评测金句不得用它。

## 4.2 向量来源与存储

- 生成端点：`POST /api/llm/embeddings`，请求体 `{texts}` 1–64 条、每条 ≤8000 字符；成功 `{model, dim, vectors}`；无可用配置回 `503 EMBEDDING_UNAVAILABLE`。
- **产品只承诺两个已验证预设**：OpenAI `text-embedding-3-small`（1536）、阿里云百炼 `text-embedding-v3`（1024）。`src/lib/embedding.ts:27-46` 的 `EMBEDDING_PRESETS` 只列这两个。
- 但生产链路**没有强制白名单**：`serverEmbedding.parseEmbeddingResponse` 直接采用上游返回的 `model` 与首条向量长度作为 `dim`，只校验条数、维度一致、有限数（`src/lib/serverEmbedding.ts:127-163`）；`embeddingModelFor` 在全仓只被测试调用。也就是说，用户填 `BAAI/bge-m3` 也能通过，维度在检索时按数组长度匹配；跨模型/跨维度片段由 `vector.ts` 跳过。承诺范围与实际校验的差距见 §7.3 N19。
- 存储：`kb_chunks.embedding` 是 TEXT JSON 数组，另存 `embedding_model` 与 `embedding_dim`；不装 pgvector、不在 SQL 里算相似度。
- 方案原定把内建 40 篇知识点文档的向量也缓存在 IndexedDB `alp-vectors-v1`；**当前代码只缓存上传片段**（`src/lib/vectorCache.ts`，缓存键带模型与维度），内建 40 篇没有预计算向量，仍走纯 BM25（`app/tutor/page.tsx:347`，见 §7.3 N21）。不要把它读成「40 篇已缓存」。
- 检索用预归一化点积：`normalizeVector` 写入前归一，`topKNormalized` 直接点积；无效/维度不符/零范数返回 null，调用方显式跳过，不当 0 分。
- 向量分页索引：`(user_id, direction_id, chunk_id)`；`after` 是上一页最后一条 `chunk_id` 字符串，`limit` 夹在 1..100；多取一条判断 `next`。

## 4.3 融合与参数

`src/lib/hybrid.ts` 集中全部常量：

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `RRF_K` | 60 | RRF 平滑常数，来自原论文默认值；rank1 与 rank3 相对差约 3.2% |
| `RRF_CANDIDATES` | 20 | 每路参与融合的最大名次；避免长尾噪声占榜 |
| `HYBRID_TOP_K` | 3 | 注入条数；3 条依据足够回答，再多稀释提示词 |
| `VECTOR_MIN_SCORE` | 0.25 | 余弦低于它视为不相关，不参与融合 |
| `MIN_ADJACENT_OVERLAP` | 20 | 相邻切块共享 ≥20 码点才算重复 |
| 权重 | 默认 1 | `weights` 缺省为 1；非正数或非有限值按 0 计（该路整体不参与） |

公式：`score(id) = Σ_i weight_i / (k + rank_i)`，`rank` 从 1 起，只按名次不看原始分数，因此 BM25 与余弦的尺度差异无关；同一路里重复 id 只计第一次；同分按 id 升序（`src/lib/hybrid.ts:74-114`）。`fuseTopK` 是纯函数层便捷封装；生产适配层用 `reciprocalRankFusion` 再切片（`src/lib/hybridSearchClient.ts:140-161`）。

适配层常量：`HYBRID_BM25_CANDIDATES = 20`、`HYBRID_VECTOR_CANDIDATES = 20`、`HYBRID_DEFAULT_TOP_K = 3`（`src/lib/hybridSearchClient.ts:30-36`），与纯函数层同值但分开命名。

两路皆空才拒答：`createRetriever` 在 BM25 与向量都为空时返回 `hits: []`；只有一路有结果就返回融合结果。向量不可用（没有 model / `/api/embeddings` 503）只退回 BM25，并返回 `retrievalNotice(false)`：「本次未使用语义检索（未配置 embedding 模型）」，不静默假装混合生效。

`usedVector` 的语义是「语义检索真的参与了排序」：查询向量拿到了且索引里有向量就为真，不以「向量路有命中」为准（`src/lib/hybridSearchClient.ts:11-12`）。因此向量路全部低于阈值时，`usedVector` 仍为 true、notice 为 null，界面仍显示模型名；这是设计接受的降级体验，不是「语义路有命中」的承诺。

## 4.4 相邻去重与引用校验

- 设计意图：上传资料按 50 码点重叠切块（`CHUNK_OVERLAP`），检索同时命中 chunk i 与 i+1 时，保留输入顺序靠前（排名更高）的一条；支持先命中 i+1 再命中 i 的逆序。
- **当前实现的缺陷**：`sharesOverlap` 只比较 before 的末 20 个码点与 after 的头 20 个码点（`src/lib/hybrid.ts:161-169`），而生产切块是 `next start = end - 50`，after 的头 20 对应 before 的倒数第 50–31 位，不等于末 20。真实 50 码点重叠时去重不生效，top3 仍可能同时注入同一文档的相邻两块。现有测试用同质文本 `"重".repeat(50)`，掩盖了对齐错误。修复方向是把比较改成「任意 ≥50 的后缀/前缀」或直接按 `CHUNK_OVERLAP` 对齐；本轮登记为 §7.3 N26。
- 引用校验：`extractCitedKcIds` 只返回「回复里真的出现、且确实在本次检索结果里」的 id（`src/components/tutor-logic.ts:48`，调用在 `app/tutor/page.tsx:597`）。检索到 3 条但模型一个都没引用时，界面显示「本次回复未包含可核对的引用」。
- claim 核对：`extractClaims` 只认已知 kcId，每条引用标记前的那句话；核对使用本次实际注入的完整上下文，不用单条摘录。

## 4.5 降级矩阵

| 条件 | 检索行为 | 界面/响应 |
| --- | --- | --- |
| 未配置 embedding（llm 配置无 `embeddingModel`） | 只走 BM25 | `retrievalNotice(false)`：「本次未使用语义检索（未配置 embedding 模型）」 |
| `/api/llm/embeddings` 返回 503 | 本次只用 BM25 | 同上，不弹错误 |
| `embeddingStatus === "unsupported"`（服务端 404/503 明确拒绝过） | 不再请求向量 | 只用 BM25；不把一次网络抖动写成 unsupported |
| 向量维度与查询不一致 | 该片段跳过 | 无提示（避免每条都提示） |
| 所有向量分数 < 0.25 | 向量路为空，RRF 只剩 BM25 一路 | 同上 |
| BM25 分数 < 0.5 | 该文档不返回 | 可能 0 条依据，按「未找到依据」渲染 |
| `/api/kb` 未登录 / 远端不可用 | 只用本机片段；向量表为空 | 上传依据照常来自 BM25；`syncWarning` 说明未同步 |
| 片段无向量（补嵌入失败） | 向量路跳过它，BM25 仍可命中 | 无提示 |
| 检索 0 条 | 不注入依据块 | 「没有检索到可引用的知识点」 |
| 引用校验失败（模型引了不存在的 id） | 引用列表为空 | 「本次回复未包含可核对的引用」 |

## 4.6 评测方法与实测

### 50 条构成与校验

`scripts/eval-data/rag-eval-50.jsonl`：50 行，每行一个 JSON 对象。

| 类别 | 条数 | `goldKcIds` | `relatedKcIds` | `goldPhrase` |
| --- | --- | --- | --- | --- |
| `literal` | 15 | 非空 | 任意 | 必填，逐字摘自语料 |
| `paraphrase` | 15 | 非空 | 任意 | 必填 |
| `answer-absent` | 10 | **必须为空** | **必须非空** | 可选 |
| `out-of-domain` | 10 | 必须为空 | 必须为空 | 可选 |

校验：`parseEvalItems` 检查 id 唯一、类别合法、字段类型、每类字段约束；任何一条坏行带行号报错，不静默少测。脚本另加四类检查：总数 50、分类 15/15/10/10、语料恰好 40 篇、`goldKcIds`/`relatedKcIds` 都在 `kbDocuments` 里、`goldPhrase` 必须逐字出现在某个 gold 文档正文中（`scripts/eval-rag.ts:128-163`）。

### 指标定义

设 answerable = `literal ∪ paraphrase`（30 条）。

| 指标 | 定义 | 分母 |
| --- | --- | --- |
| `recallAt3` | 每条 `|gold ∩ top3| / |gold|`，再取平均 | 30 |
| `recallAt3Literal` / `recallAt3Paraphrase` | 同上，按类别 | 15 / 15 |
| `mrrAt10` | 每条 `1 / 第一个 gold 在 top10 中的名次`；未命中记 0 | 30 |
| `goldPhraseInFullText` | top3 中至少一篇的**全文**（title + text）包含 `goldPhrase` 的条目比例 | 有 `goldPhrase` 的条目 |
| `answerAbsentRelatedHit` | top3 中至少命中一个 `relatedKcIds` 的 answer-absent 条目比例 | 10 |
| `answerAbsentEmpty` | 检索结果完全为空的 answer-absent 条目比例 | 10 |
| `outOfDomainEmpty` | 检索结果完全为空的 out-of-domain 条目比例 | 10 |
| `outOfDomainFalseContext` | `1 - outOfDomainEmpty`，即「把无关内容当成依据」的比例 | 10 |
| `unanswerableEmpty` | answer-absent ∪ out-of-domain 的空检索率 | 20 |

**金句判定为什么必须用全文**：`search()` 返回的 `snippet` 是 `text.slice(0, 160)`，而 40 篇知识库正文有 230–322 个码点，例题解析大多落在 160 字之后。用 snippet 判「金句是否被检索到」会把大量真实命中记成未命中——这是上一版的 blocker。现在 `evaluateRetrieval` 在调用方传入的 `corpus`（kcId → 完整正文）里做 `includes`（`src/lib/ragEval.ts:290-306`），语料由 `buildCorpus` 用 `title + "\n" + text` 构造（`scripts/eval-rag.ts:165-167`）。top3 里出现 corpus 之外的 id 直接抛 `EvalDataError`，不静默记未命中。

**answer-absent 为什么是 relatedHitRate 而不是「必须为空」**：这类问题的答案不在任何知识点里，但存在一个「相关、可提供背景」的知识点。检索命中它是有用的（导师可以据此说明「这属于 X 的范畴，但教材没有展开」），因此主指标是 `answerAbsentRelatedHit`（越高越好）；`answerAbsentEmpty` 是另一种可接受形态的观察值，两者都不单独构成通过条件。

**向量来源的诚实性**：脚本顶部 `try { process.loadEnvFile(".env.local") } catch {}`（`scripts/eval-rag.ts:37-41`），否则 tsx 不会自动读取 `ALP_EMBED_*`。混合列只接受两种真实来源：`--vectors` 文件，或 `ALP_EMBED_BASE_URL/API_KEY/MODEL` 指向的 `/embeddings`。两者都没有时打印「混合检索：未测」并 exit 0，**绝不用随机向量或词法哈希向量冒充语义向量**；`fnv1a` 只用于缓存键，不是向量。

### 2026-10-29 实跑

命令（本轮实际执行）：

```bash
npm run eval:rag
```

输出（exit 0）：

```text
RAG 检索评测
════════════════════════════════════════════════════════════════════════
评测集：scripts/eval-data/rag-eval-50.jsonl（50 条）
分类：literal 15 / paraphrase 15 / answer-absent 10 / out-of-domain 10
语料：kbDocuments 40 篇完整正文（title+text）；金句在 top3 全文判定
模式：auto；title 加权 ×2

[BM25 基线]
  recall@3                 1.000（30/30）   字面 1.000（15/15） / 同义 1.000（15/15）
  MRR@10                   1.000（30/30）
  goldPhraseInFullText     1.000（30/30）
  answer-absent relatedHitRate   1.000（10/10）
  out-of-domain emptyRate        0.000（0/10）   falseContextRate 1.000（10/10）
  unanswerableEmptyRate    0.000（0/20）   （answer-absent ∪ out-of-domain）

[BM25 + title×2]
  recall@3                 1.000（30/30）   字面 1.000（15/15） / 同义 1.000（15/15）
  MRR@10                   1.000（30/30）
  goldPhraseInFullText     1.000（30/30）
  answer-absent relatedHitRate   1.000（10/10）
  out-of-domain emptyRate        0.000（0/10）   falseContextRate 1.000（10/10）
  unanswerableEmptyRate    0.000（0/20）   （answer-absent ∪ out-of-domain）

混合检索：未测（未提供 --vectors，且未配置 ALP_EMBED_BASE_URL / ALP_EMBED_API_KEY / ALP_EMBED_MODEL）
```

## 4.7 评测诚实性与已知缺口

1. **金句 blocker 已关闭**：判定改在全文，30/30 命中；上一版用 160 字 snippet 的误判不再存在。
2. **评测集已饱和**：BM25 基线在 answerable 上全部 1.000，`title×2` 与基线逐项相同。因此这份 50 条**不能**用来证明「标题加权有效」或「向量/RRF 提升」——它只能证明「基础检索没有坏」。
3. **out-of-domain emptyRate = 0.000**：10 条域外问题全部返回了文档。检索层没有拒答能力（`MIN_SCORE = 0.5` 挡不住 OOD 查询里的高频 bigram）。这是**缺陷信号，不是通过**；要改善需在注入层加相似度门槛或让模型显式说「未找到依据」，本轮未做（§7.3 N25）。
4. **混合检索未测**：没有 `--vectors` 文件，也没有 `ALP_EMBED_*`。脚本如实打印「未测」并以 0 退出——没测就是没测。
5. **没有质量门槛**：脚本只打印指标并 `return 0`（`scripts/eval-rag.ts:468-503`）；`npm run verify` 不包含 `eval:rag`。`--mode hybrid` 在没有向量来源时也 exit 0。质量回归或没测混合都会是绿色。发布门槛（recall@3 ≥0.90 / goldPhrase ≥0.95 / answerAbsentRelatedHit ≥0.90）目前只是文档口径，不是代码断言（§7.3 N22）。
6. **评测口径与生产不完全一致**：`evaluateRetrieval` 固定 `retrieve(query, 10)`，脚本的 hybrid 用 `candidates: k`（10）再 `slice(0, k)`（`scripts/eval-rag.ts:381-386`）；生产 `createRetriever` 是两路各 20、`candidates: 20`、输出 top3（`src/lib/hybridSearchClient.ts:30-36`、`:140-144`）。评测的 hybrid 数字不能直接外推到生产。
7. **评测对象不是上传资料**：50 条跑的是 `kbDocuments` 40 篇知识点；生产里接 RRF 的是用户上传片段。上传资料的混合检索没有评测集，只有单测覆盖排序与降级。
8. **数据集没有 provenance**：文件只有 `id/category/query/goldKcIds/relatedKcIds/goldPhrase` 六个字段，没有标注人、日期、生成方式；literal 查询主要是题干复制/改写（不是标题改写）。它不能证明「人工标注」，也不能证明标题加权有收益。

# 搜索与语音：DeepSeek 搜索、mimo TTS

## 5.1 搜索供应商与端点

`WebProvider = "tavily" | "wikipedia" | "deepseek"`（`src/lib/websearch.ts:11`）。

| 供应商 | 端点 | 鉴权 | 备注 |
| --- | --- | --- | --- |
| DeepSeek | 固定 `POST https://api.deepseek.com/v1/tools/search` | Bearer | body `{query, count, need_content:true}`；代理不接受调用方传 URL |
| Tavily | 固定 `POST https://api.tavily.com/search` | Bearer | `include_raw_content:false`，只取摘要 |
| 维基百科 | 中文 Wikipedia Action API | 免密钥 | 允许匿名；不读不写库；浏览器直连带 `origin=*`，服务端代理不带 |

DeepSeek 搜索密钥优先级：`search-deepseek` 行；缺失时回退 `llm` 行，且仅当 `llm.base_url` 的 host 严格等于 `api.deepseek.com`（`isDeepSeekBaseUrl`，`src/lib/serverSearch.ts:353-362`）。这样中转地址的 llm 密钥不会被当成 DeepSeek 官方搜索密钥。

`normalizeDeepSeek` 支持 `{results:[...]}`：摘要按 `summary → snippet → content` 取第一个非空，按 `rerank_score` 降序（缺失排最后且稳定），clamp 300 码点，http(s) 过滤，排序后按 url 去重保留最高分，最多 4 条。

## 5.2 搜索密钥、穷尽分支与标签

`resolveSearchProvider` 与 `searchWeb` 用穷尽 switch + `assertNeverProvider`（`src/lib/searchClient.ts:248-285`、`:611-635`）：

- `wikipedia`：永远直连，允许匿名。
- `deepseek`：未登录 → 明确提示「DeepSeek 搜索需要登录后由服务端代发，当前未登录，已改用维基百科」并回退维基；登录 → 走 `/api/search`。
- `tavily`：server 模式且登录 → 走 `/api/search`；local 模式 → 直连；未填本机 key 或未登录 → 明确提示并回退维基。
- 不静默改源：回退必须带 `notice`；响应的 `provider` 永远等于实际使用的供应商。

所有标签统一用 `webProviderLabel`（`src/lib/websearch.ts:274-286`）：「维基百科 / Tavily 摘要 / DeepSeek 搜索摘要」。`src/components/web-evidence.tsx:77-78` 与 `app/tutor/page.tsx:1078` 已改用该函数，不再用「非 wikipedia 即 Tavily」的三元判断。

服务端 `/api/search` 的 provider 分支也是穷尽 switch，末尾 `assertNeverProvider(provider)`；这是**编译期穷尽**，不是运行期自动回退：服务端没有「挨个试供应商」的循环，也不会产出 `search_exhausted`。

## 5.3 搜索代理的已知缺陷

1. **3xx 不跟随的声明与实现不一致**：`serverSearch.requestText` 调 `fetchImpl(url, {...init, signal})`，没有传 `redirect: "manual"`（`src/lib/serverSearch.ts:151-159`）；undici 默认 follow，带 `Location` 的 301/302/303/307/308 会被跟随，`src/lib/serverSearch.ts:170-178` 的拒绝分支对这类响应不可达。跨源重定向时 undici 会剥离 `Authorization`，同源重定向会保留；实际泄露面小，但代码声明的不变量不成立，且与 `guardedRequest` / TTS 路径（明确不跟随）不一致。修复：传 `redirect: "manual"` 或改用 `guardedRequest`。
2. **没有请求体上限**：`/api/search` 直接 `request.json()`（`app/api/search/route.ts:118-124`），chunked 大包可绕过前端限制。
3. **没有成功响应字节上限**：`serverSearch` 只读 `res.text()`，错误正文截 200 字符，成功响应不受限（`src/lib/serverSearch.ts:180-204`）。
4. **没有自建限流**：`rate_limited` 只透传上游 429。
5. **`search_exhausted` 永远不会出现**：契约里有码，但没有候选链，也没有路由产出。
6. **导师页没有把运行时传给搜索**：`app/tutor/page.tsx:489` 调 `searchWeb(query, config, signal)`、`:788` 调 `resolveSearchProvider(searchConfig)`，都没传 `{mode, loggedIn}`，于是使用默认 `{mode:"local", loggedIn:false}`（`src/lib/searchClient.ts:65-68`）。后果：server 模式下导师页的 Tavily 会按本机直连处理（无本机 key 时回退维基并提示），DeepSeek 一律回退维基。设置页的搜索表单已存在，但导师页这条链没有真正走 server 搜索（§7.4 N27）。

## 5.4 TTS 协议

两套协议不能混用：

| 协议 | 端点 | 请求体 | 音频位置 |
| --- | --- | --- | --- |
| `speech` | `{baseUrl}/audio/speech` | `{model, voice, input, response_format:"mp3", speed}` | 直接返回音频字节 |
| `chat-audio`（mimo） | `{baseUrl}/chat/completions` | `{model, messages:[{role:"assistant",content:text}], modalities:["audio"], audio:{voice:"茉莉",format:"mp3"}}` | `choices[0].message.audio.data`（base64） |

- `mimoEndpoint` 只在根地址后拼 `/chat/completions`（已带该路径则不重复），空地址返回空串；mimo **绝不请求 `/audio/speech`**（`src/lib/mimo.ts`）。
- `buildMimoTtsBody` 严格产出上述形状，`format` 类型锁死为 `"mp3"`；`parseMimoTtsResponse` 从 `choices[0].message.audio.data` 取 base64，形状不对返回 null；`decodeBase64Audio` 容忍 data URI/换行/缺补位，非法输入返回 null。
- `ttsEndpoint(baseUrl, protocol)` 对 `chat-audio` 用 `mimoEndpoint`，对 `speech` 拼 `/audio/speech`（`src/lib/tts.ts:235-243`）。
- 服务端 `/api/tts` 的 `resolveTtsApi` 先看行里的 `api`（mimo/chat-audio/speech），再看 `options.protocol`，最后按 base_url 是否含 mimo 推断（`src/lib/serverTts.ts:213-224`）。`/api/config` 把 tts 的 `api` 列存成引擎（browser/openai-compatible），真实协议在 `options.protocol`；映射必须按 protocol 优先，否则 MiMo 会被送去它明确返回 404 的 `/audio/speech`。
- 对外统一 `audio/mpeg`；两条协议客户端只需一套播放逻辑。

## 5.5 TTS 就绪与客户端

- `ttsConfigIssues(config, mode)`（`src/lib/tts.ts:194-201`）：server 模式只要求 `engine === "openai-compatible"`，**不要求本机 apiKey/model/voice**；否则「账号里有 key、本机没有」会永远回退浏览器语音。local 模式仍检查 baseUrl/apiKey/model/voice。
- `requestRemoteSpeech`（`src/lib/tts.ts:645`）：server 模式 `POST /api/tts`，body 只有 `{text}`；local 模式按 `protocol` 直连：`speech` 发 `/audio/speech`，`chat-audio` 发 `/chat/completions` 并解析 base64 音频。
- 服务端 `/api/tts`：登录 + 同源 + `Content-Type: application/json`；`text` 1–2000 字；缺 tts 行 / baseUrl / apiKey → 404 `provider_not_configured`；上游失败 502/504；成功 200 `audio/mpeg`。
- 浏览器语音（`engine === "browser"`）不是「未配置」；请求 `/api/tts` 会得到 404，客户端应直接走浏览器语音，不要请求。
- 设置页新增小米 mimo 预设（`protocol: "chat-audio"`、`voice: "茉莉"`、`format: "mp3"`），`clearTtsConfig` 先 `stopSpeaking` 再删 `alp.tts.v1`（`src/lib/tts.ts:182-191`）；`read-aloud.tsx:113` 把 `mode` 传给 `speakRemote`。

## 5.6 server 模式四层就绪

「真正可用」拆四层：配置就绪、路由就绪、降级就绪、客户端接线。

| 能力 | 1 配置 | 2 路由 | 3 降级 | 4 客户端 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 模型对话 | 是（`/api/config` PUT/GET） | 是（`/api/llm/chat`，含 SSE） | 是（404 `CONFIG_MISSING` → 设置页；409 `CONFIG_STALE` → 刷新） | 是（`src/lib/chat.ts:166-231`；`isProviderReady`） | 可用 |
| 向量化 | 是（llm 行 `embedding*`） | 是（`/api/llm/embeddings`） | 是（503 → 只用 BM25） | 是（`embeddingClient.embedTexts`，上传混合检索已用） | 可用 |
| 搜索 | 是（两行密钥） | 是（三家） | 部分（404/429/502/504；`search_exhausted` 未产出） | **部分**：设置页/搜索客户端已接；导师页未传 runtime，DeepSeek/Tavily server 分支不生效 | 部分可用（§7.4 N27） |
| 语音 | 是（tts 行 + protocol） | 是（mimo / speech） | 是（404/409 → 回退浏览器语音） | 是（`requestRemoteSpeech`，`read-aloud.tsx:113` 传 mode） | 可用 |
| KB 同步 | 是 | 是（`/api/kb` 四个形状） | 是（409 → `KbConflictError`） | 是（`getKbStorageForUser`） | 可用（有 §7.2 的读/删缺口） |
| 记忆卡同步 | 是 | 是（`/api/memories`） | 是（`skippedStale` + `pullMemories` 返回 null 不覆盖本地） | 是（`memoryClient`，接在 `useLearner`） | 可用（单卡删除未接线） |

服务端模式与浏览器直连模式的开关在设置页：`DEFAULT_CALL_MODE = "server"`（`src/lib/serverConfig.ts:21-23`），键 `alp.callmode.v1`；未登录时界面强制 local（`app/settings/page.tsx:210`），避免请求一个必然 401 的代理。

**provider 就绪** = `GET /api/config` 的 `llm.configured === true` 且 `api/baseUrl/model` 非空；客户端用 `isProviderReady` 判定：server 模式只看 `serverConfigured`，local 模式看 baseUrl/apiKey/model。缺一项时 `/api/llm/chat` 回 404 `CONFIG_MISSING`，客户端应跳设置页而不是重试。`kind` 不一致回 409 `CONFIG_STALE`，用于「页面读到的配置已被别的设备改掉」。

**TTS 就绪** = `tts.configured === true` 且 `engine !== "browser"` 且 `baseUrl/apiKey/model` 非空；server 模式下 `ttsConfigIssues(config, "server")` 返回空数组，不要求本机 key。

**搜索穷尽** = 编译期 `never` 检查 + 运行期「不静默换供应商」；服务端不会替你试第二家。`search_exhausted` 没有实现，因为当前请求只带一个 provider。

## 5.7 外部端点验证

`scripts/probe-external.ts`，入口 `npm run probe:external`；单端点开关 `--deepseek-search` / `--mimo` / `--embedding`。

- 输出纪律：只打印 status、content-type、顶层 keys、结果数、音频字节数、首 4 字节与 ID3 头；不打印密钥、Authorization、base64、完整响应正文。
- 退出码：0 = 跑完（含「未验证」）；1 = 有凭据但探测失败；2 = 参数错误。没凭据时不伪装成失败，也不伪装成通过。
- DeepSeek 凭据判定：`DEEPSEEK_API_KEY`，或 `ALP_E2E_LLM_API_KEY` 且 `ALP_E2E_LLM_BASE_URL` 的主机严格等于 `api.deepseek.com`。
- MiMo 只请求 `{baseUrl}/chat/completions`，输出写明「不是 /audio/speech」；成功判定 = 能解出 `choices[0].message.audio.data`、base64 可解码、字节数 >0。
- Embedding 判定 = 返回非空 `data` 且首条向量维度 >0。

2026-10-29 记录（`docs/verification/2026-10-29-external-endpoints.md`）：

| 端点 | 结论 | 依据 |
| --- | --- | --- |
| DeepSeek 搜索 | **未验证**：缺官方凭据 | 现有 `ALP_E2E_LLM_BASE_URL` 主机是 `api.jasonsome.cn`，不是 `api.deepseek.com` |
| MiMo TTS | **未验证**：缺 `MIMO_BASE_URL` / `MIMO_API_KEY` / `MIMO_MODEL` | 脚本输出「未验证：缺少 …」 |
| Embedding | **未验证**：缺 `ALP_EMBED_*` | 同上 |
| Tavily | **未验证**：无密钥 | 401（无凭据 curl，只证明端点可达且要求鉴权） |
| 维基百科 | **未验证**：本机无法完成 TLS 握手 | `curl (35) schannel: failed to receive handshake` |

同一份记录里的补充事实：DeepSeek 与 Tavily 的无凭据 curl 都返回 401，说明域名、路径与 TLS 可达；**这不等于功能已验证**。用假凭据跑 MiMo 失败路径得到 exit 1，输出中没有假密钥命中——只证明失败路径不打印密钥，不构成端点验证。

复验步骤：补 `DEEPSEEK_API_KEY`（或指向官方域的 `ALP_E2E_LLM_*`）、`MIMO_BASE_URL/API_KEY/MODEL`、`ALP_EMBED_*`；`npm run probe:external`；只有看到 `status: 2xx`、`results ≥ 1` 或 `audio 字节数 > 0`，才把对应行改成「已实测」并附输出。README 不得写「已实测」。

# 未登录的边界

## 6.1 服务端 401 清单

未登录访问以下接口一律 401，且不写任何数据：

- `GET/PUT/DELETE /api/config`（`app/api/config/route.ts:143-164`、`:234-252`）
- `GET/PUT/DELETE /api/kb`（`app/api/kb/route.ts:46-49`、`:107-110`、`:157-159`）
- `GET/PUT/DELETE /api/memories`（`app/api/memories/route.ts:43-46`、`:57-60`、`:105-107`）
- `GET/POST/DELETE /api/progress`（`app/api/progress/route.ts:26-27`、`:49-50`、`:87-89`）
- `POST /api/llm/chat`、`POST /api/llm/embeddings`
- `POST /api/tts`

例外：

- `POST /api/search` 的 `wikipedia` 允许匿名；`deepseek` / `tavily` 未登录 401。
- `GET /api/health` 公开；详细分支需要 `Authorization: Bearer <HEALTH_TOKEN>`。

## 6.2 本机能力

未登录仍可完整使用：

- 诊断、路径、章节目标、手动改写、记忆卡、预测校准、知识库检索。
- 导师回答在无 provider 时退化为知识库检索拼装（`app/tutor/page.tsx:518-533`）。
- 本地 BYOK 配置：provider/search/tts 密钥在 localStorage；上传知识库在 IndexedDB `alp-kb-v1`；进度在 localStorage。
- 本地 BYOK 配置可在未登录时保存（设计如此）；服务端配置不能。

设置页在未登录时 `effectiveMode = "local"`，服务端模式按钮 `disabled`（`app/settings/page.tsx:210`、`:428`），`chooseMode("server")` 早退（`:257`）。

## 6.3 调用模式

| | server（默认） | local |
| --- | --- | --- |
| 谁发请求 | 本项目 `/api/llm/chat`、`/api/search`、`/api/tts`、`/api/llm/embeddings` | 浏览器直连用户填的地址 |
| 密钥存哪 | `user_secrets` 密文列 | `alp.provider.v1` / `alp.search.v1` / `alp.tts.v1` |
| 前提 | 登录 + `ALP_SECRET_KEY` + 可持久化 `DATABASE_URL` | 浏览器允许 CORS / 无混合内容拦截 |
| 未登录时 | 界面强制 local | 同左 |

## 6.4 CSRF 与跨站

- 会话 Cookie `sameSite: "lax"`，跨站 POST 本来就不带 Cookie；同源校验是第二道。
- 有副作用的请求走 `assertMutationOrigin`（`src/lib/routeAuth.ts:63-66`）或等价的 `sameOriginFromRequest`（`src/lib/origin.ts:54-56`）：只相信浏览器写的 `Origin` / `Sec-Fetch-Site`，比较 host:port，不比较协议（反代后协议可能与外部不一致）。
- 拒绝形状：config/kb/memories/llm 回 403 `forbidden`；search/tts 也回 403，但错误体形状不同（§7.1）。
- 后果：不带 Origin 的 curl 写请求一律 403；手工验证要显式加 `-H "Origin: http://localhost:3000"`。

**未统一的 mutation**：`/api/progress` 的 POST/DELETE 没有 `assertMutationOrigin`，`request.json()` 也没有 `readLimitedText` 的前置体积上限（512KB 检查在解析之后）；`/api/auth`、`/api/directions`、`/api/directions/generate`、`/api/directions/items`、`/api/mcp` 同样没有 origin guard。`sameSite=lax` 目前挡住跨站 POST，但防线不统一（§7.1 S15）。

## 6.5 跨组件/跨标签页的认证状态

`useAuth()` 是普通 hook，每个调用方各持一份 `useState/useRef`，没有 context、没有模块级单例；只在挂载时 `refresh`，没有 `storage` / `visibilitychange` / `BroadcastChannel` 监听。后果：

- 导航栏登出后，当前页面的 `useLearner` 仍认为已登录，继续显示「进度已同步」并向 401 端点推送。
- 另一个标签页登录 B 后共享 `alp_session` 已变成 B，A 的页面仍按内存里的 A 通过 `userRef` 校验，`postProgress` / `pushMemories` 会把 A 的进度/记忆卡写进 B 的账号（服务端按 cookie 归属）。

这是真实的账号隔离缺口，见 §7.2 N15。修复需要把认证状态提升为 context/单例，并监听 `storage` 与 `visibilitychange`；本轮未做。

# 已知限制

以下每条都给出代码位置或实跑证据。与前面「定稿」冲突时，以这里为准：**未修的就是未修**。

## 7.1 安全、协议与体积

| # | 限制 | 证据 / 影响 |
| --- | --- | --- |
| S1 | `ALP_ALLOW_HTTP_PROVIDER_HOSTS` 是部署级逃生口：命中的 host 同时放行 http 与私网，不只是 http | 这是有意设计（`src/lib/ssrfGuard.ts:9-11` 文件头写明「命中它的目标允许 http，且允许解析到私网地址」）。证据：`:161`（只有 `blocked-address` 才走白名单兜底）、`:172`（`allowPrivate = isAllowlisted`，不区分 scheme）、`:176-188`（字面量内网直接返回 pinned）、`:202-211`（DNS 逐条判定被 `if (!allowPrivate)` 跳过）。复核记录中的实测：白名单内 `https://10.1.2.3`、`https://127.0.0.1`、`https://169.254.169.254/latest/meta-data/...` 均 ACCEPTED；空名单下 169.254.169.254 仍拒。**运维后果**：登录用户可把 llm/embedding/tts 的 baseUrl 指向白名单主机的任意路径（固定后缀仍会追加），由服务端代发并读回 2xx JSON/音频；因此名单只能填运维自己控制的端点，不能填元数据地址。**文案缺陷**：README 第 849 行「内网网段即使列出也不放行」与 `.env.example:41` 同句均为假，且与同句建议的 `localhost,127.0.0.1` 自相矛盾；应改为「命中白名单的 host 允许 http 与私网，仅用于自建端点」。默认空名单仍安全。 |
| S2 | 搜索代理声明「3xx 不跟随」，实际使用默认 fetch（follow） | 复核记录：`src/lib/serverSearch.ts:151-159` 没有 `redirect:"manual"`；带 `Location` 的 301/302/303/307/308 会被跟随，`:170-178` 的拒绝分支不可达。跨源重定向 undici 会剥离 Authorization，同源保留；实际泄露面小，但与 `guardedRequest`/TTS 路径不一致。 |
| S3 | SSE 心跳可能拼进未完成的 data 行 | `src/lib/upstream.ts:192` 的 `HEARTBEAT_FRAME` 由 `setInterval` 无条件 enqueue（`:218-227`），pump 按 chunk 原样转发（`:285-299`）；复核记录：上游在一条 data 行中途停顿超过 15s 时，心跳会落在行中间，客户端解出非法 JSON 并静默丢一拍。低概率，但存在。 |
| S4 | 错误码与错误体未统一 | 契约 `apiErrorCodes` 是小写（`bad_request`/`unauthorized`/`forbidden`/`conflict`…，`src/lib/apiContracts.ts:433-484`）；路由私有码是大写（`CONFIG_MISSING`/`CONFLICT_STALE`/`KEY_ENC_UNAVAILABLE`…）；search/tts 回 `{error:string, code}`，其余回 `{error:{code,message}}`。方案的大写码表（§2.6）只是目标口径，不是当前响应。 |
| S5 | `apiErrorStatus` 不是实际映射 | `provider_not_configured` 契约写 409，search 回 404、tts 回 404/409；`conflict` 契约有、无人产出；`SECRET_UNREADABLE` 在 config 是 409、在 chat 是 500；`search_exhausted` / `tts_unavailable` 永不产出。 |
| S6 | config 体量 32 KiB、chat 单条 16k，均低于本轮方案值 | `app/api/config/route.ts:50`、`src/lib/apiContracts.ts:158`；方案值是 64 KiB 与 20000。 |
| S7 | `/api/search`、`/api/tts` 没有请求体上限，搜索成功响应没有字节上限 | `app/api/search/route.ts:118-124`、`app/api/tts/route.ts:92-97`、`src/lib/serverSearch.ts:180-204`。 |
| S8 | 没有自建限流 | `rate_limited` 只透传上游 429；登录用户可无限调用代发与 8 MiB PUT。 |
| S9 | `/api/kb` PUT 没有 `maxDuration` | `src/lib/kbServer.ts` 向量预算 25s；路由只导出 `runtime`，未导出 `maxDuration`；默认函数时限短的平台可能截断大文档。 |
| S10 | 主密钥只能有一把 | 轮换/回滚都不是无损；旧行报 `KEY_KID_UNKNOWN`，必须用户重存。 |
| S11 | 内存后端 KB/记忆卡不拒绝写，但每实例各存各的 | 密钥路径已拒绝（503 `PERSISTENCE_UNAVAILABLE`）；KB/记忆卡只是「写成功、换实例读到空」。线上必须配 `DATABASE_URL`。 |
| S12 | 客户端声明向量，服务端只校验维度/有限性 | 不校验语义；检索错了不会报错，只会排序错。 |
| S13 | `llmChat` 契约比方案窄 | 方案允许 `kind/system/user/messages/maxTokens/temperature/jsonMode/thinking/stream`；实际 `apiContracts.llmChat` 只有 `messages/temperature/maxTokens/stream`（`src/lib/apiContracts.ts:165-178`），路由局部追加 `kind`。`system/user/jsonMode/thinking` 未进入契约；`thinking` 由服务端 `options.thinking` 决定。 |
| S14 | `embeddingStatus` 没有写入方 | 白名单有该键（`src/lib/userSecrets.ts:45`），但 `configPut` 没有字段，`/api/config` 不会保存；客户端只在本地 provider 状态记录。 |
| S15 | mutation 的 Origin/体积校验不统一 | `/api/progress` 的 POST/DELETE 没有 `assertMutationOrigin`，`request.json()` 也没有 `readLimitedText` 的前置上限；`/api/auth`、`/api/directions`、`/api/directions/generate`、`/api/directions/items`、`/api/mcp` 同样没有 origin guard。`sameSite=lax` 挡住跨站 POST，但防线不统一。 |

## 7.2 同步、账号与并发

| # | 限制 | 证据 / 影响 |
| --- | --- | --- |
| N1 | `hydrateProviderFromServer` 签名与钉死值不一致 | 钉死 `Promise<boolean>`；`provider.ts:383` 返回 `Promise<ProviderConfig \| null>`，`serverConfig.ts:479` 返回 `Promise<HydrateResult>`。调用方按实际签名写，文档记录偏差。 |
| N2 | KB 的 CAS 不是事务 | `src/lib/kbServer.ts:461-512` 先 `SELECT` 再 `INSERT`，无条件 `ON CONFLICT DO UPDATE`；两个并发 PUT 使用同一 `baseUpdatedAt` 可都通过，后写覆盖，双方 200。要消除需条件 `UPDATE ... WHERE updated_at = $base` 并检查受影响行数，或 `SELECT ... FOR UPDATE` 包事务。 |
| N3 | 删除没有 tombstone | KB DELETE 无版本前置条件；A 删除后 B 的在途 PUT（`baseUpdatedAt: null`）会让文档复活；记忆卡旧快照 PUT 也会让卡复活。要禁止需要 tombstone。 |
| N4 | KB 读路径总是远端覆盖本地 | `mergeDocs` 先 local 后 remote，同 id 后者胜，不比较 `updatedAt`（`src/lib/kbRemote.ts:313-322`）；本地未成功上传的修改（如 KC 绑定）会被远端旧副本遮住。这是本轮唯一会丢用户可见修改的读路径。 |
| N5 | KB 删除失败后文档复活 | `removeDoc` 先删本地，远端 DELETE 失败只 `markWarning`（`src/lib/kbRemote.ts:469-478`）；下一次成功 `loadDirection` 会把远端副本合并回来，且 `clearWarning` 清掉告警。用户看到「删掉的文档又出现」，且没有提示。 |
| N6 | KB 远端文档只进内存，不写回 IndexedDB | `loadDirectionInner` 只 `mergeDocs/mergeChunks` 返回，没有 `local.putDocWithChunks`（`src/lib/kbRemote.ts:391-418`）。新设备在线能读；断网刷新后账号资料不在本地库，只剩本机上传的资料。 |
| N7 | `kbRemote` / `memoryClient` 没有超时或 AbortSignal | `createRemoteKbStorage.request` 只透传 init（`src/lib/kbRemote.ts:186-210`）；`memoryClient` 的 `fetch` 也没有 signal/超时（`src/lib/memoryClient.ts:31-43`）。网络悬挂时本机 KB/记忆卡要等浏览器默认超时（可能无限），本地数据迟迟不显示。 |
| N8 | `syncedStorages` 永不回收，`firstSynced` 跨登出/重登复用 | `src/lib/kbRemote.ts:340`、`:504-524`；同一账号重新登录但不刷新页面时，`pushLocalOnly` 直接 return，登出期间新增的本地文档不会补推，也没有 `syncWarning`；整页刷新后新实例才会补推。 |
| N9 | 换号时 IndexedDB 删除是 fire-and-forget | `src/lib/useAuth.ts:116` `void clearKbDatabase()`；`kbLocal.ts:175-205` 在 `onblocked` 时最多 2s 就 resolve。复核浏览器实测：删除后的 `open` 会排在 pending delete 之后（新账号读 KB 会一直 loading 挂起），不是读到上一位用户的文档；另一个仍持旧存储实例的标签页/在途请求才可能把本地残留推进新账号。`syncedStorages` 不清，旧实例仍在缓存。 |
| N10 | 409 分支的 `written: 0` 语义不一致 | `importDocument` 的 `failure()` 写死 `written:0`（`src/lib/kbStore.ts:210-212`），409 分支注释说「本地已经落库」；界面只展示冲突文案，不展示 `written`（`src/components/knowledge-upload.tsx:357-363`），所以不是用户可见的「已导入 0/N」，但类型语义仍矛盾。 |
| N11 | 远端 400 被当成可重试告警 | 复合存储只把 409 当冲突抛出，其余非 2xx（含 400 契约失败）只记 `syncWarning`（`src/lib/kbRemote.ts:463-466`）。一个永不合法的一次写入会在每次写入时重复失败，本地却一直显示「已保存、同步失败」。 |
| N12 | 记忆卡单卡删除没有 UI 调用方 | `deleteMemory` 已实现（`src/lib/memoryClient.ts:91-104`），但四个文件里没有卡片级删除按钮调用；界面移除一张卡只靠快照 PUT，而 PUT 不删行，下次拉取会复活。 |
| N13 | 清空学科与在途 pushMemories 有竞态 | `resetSubject` 删除 `pendingMemories` 后 `void clearMemories(subjectId)`（`src/lib/useLearner.ts:407-418`），不取消在途的 800ms 防抖 PUT；服务端 PUT 是 upsert、DELETE 是行删除，PUT 在 DELETE 之后落库会让卡复活。无 AbortController/序列号。 |
| N14 | 匿名→账号的进度不是并集 | `mergeServerProgress` 对服务端存在的学科整科覆盖本地 mastery/attempts（`src/lib/learner.ts:317-326`）；同学科的匿名作答会丢。记忆卡按 id 求并集，但进度不是。README 已把「同学科单权威」写成取舍，`accountTransition.ts` 的「并入账号」注释与实现不完全一致。 |
| N15 | 认证状态不是全局单例，无跨标签页同步 | 每个 `useAuth()` 各持一份状态，只在挂载时 `refresh`；无 `storage`/`visibilitychange`/`BroadcastChannel`。导航栏登出后页面 hook 仍认为已登录；另一标签页换 B 后 A 页面会把 A 的进度/记忆卡写进 B 的账号（服务端按 cookie 归属）。 |
| N16 | 方向删除不清理 KB/进度 | `DELETE /api/directions` 只删 `directions` 表（`app/api/directions/route.ts:360-379`），不调用 `deleteKbDirection`，也不清本地 KB；README 第 11 条自认。 |
| N17 | 跨方向读/列表/计数已隔离 | `loadDirectionKb` 与面板按 `directionId` 过滤；服务端 SQL 带 `direction_id`；IndexedDB 有 `directionId` 索引；方向/账号变化先 `reset`。这条不是缺口，记录以免误判。 |

## 7.3 检索与评测

| # | 限制 | 证据 / 影响 |
| --- | --- | --- |
| N18 | 相邻去重对真实 50 码点重叠不生效 | `sharesOverlap` 只比 before 末 20 与 after 头 20（`src/lib/hybrid.ts:161-169`）；生产 `next start = end - 50`（`src/lib/knowledge.ts:176-180`），after 头 20 对应 before 倒数第 50–31 位，不等于末 20。真实文本去重 3/3 保留；测试用 `"重".repeat(50)` 掩盖。top3 可能同时注入同一文档的相邻两块。 |
| N19 | `embeddingModelFor` 只被测试调用，生产不强制预设 | 全仓 grep 只命中 `src/lib/embedding.ts` 与 `embedding.test.ts`；`serverEmbedding.parseEmbeddingResponse` 直接采用上游 model/dim（`src/lib/serverEmbedding.ts:127-163`），只校验条数/维度/有限数。产品只承诺两个预设，但代码允许任意模型名；跨维度片段在检索时由 `vector.ts:120` 跳过。 |
| N20 | `usedVector` 不以「向量路有命中」为准 | 查询向量拿到且索引非空即为 true（`src/lib/hybridSearchClient.ts:122-127`）；向量路全部低于阈值时 notice 仍为 null，界面仍显示「语义检索: <model>」。这是设计接受的降级体验，不是「本次向量命中」。 |
| N21 | 内置知识点仍只走纯 BM25 | `app/tutor/page.tsx:347` 用 `search(index, question, 3)`；只有上传片段走 `createRetriever` + RRF。50 条评测针对 `kbDocuments`，不能证明上传资料的混合检索。 |
| N22 | 评测无质量门槛 | `scripts/eval-rag.ts` 只打印并 `return 0`（`:468-503`）；`npm run verify` 不含 `eval:rag`；`--mode hybrid` 无向量时也 exit 0。recall@3 ≥0.90 / goldPhrase ≥0.95 / answerAbsentRelatedHit ≥0.90 不是代码断言。 |
| N23 | 评测口径与生产不一致 | 评测 `retrieve(query,10)`、`candidates:k`、输出 10（`src/lib/ragEval.ts:261`、`scripts/eval-rag.ts:381-386`）；生产两路各 20、`candidates:20`、输出 top3（`src/lib/hybridSearchClient.ts:30-36`、`:140-144`）。hybrid 评测数字不能直接外推。 |
| N24 | 评测集饱和、无 provenance | BM25 在 30 条 answerable 上 recall@3/MRR@10/金句全 1.000；`title×2` 逐项相同；50 行只有 6 个字段，无标注人/日期/生成方式；literal 查询主要是题干复制/改写。只能证明基础检索没坏，不能证明标题加权或 RRF 有收益。 |
| N25 | 域外问题没有拒答 | 本轮 `npm run eval:rag` 实跑 `outOfDomainEmpty = 0.000`（0/10）、`falseContextRate = 1.000`（10/10）；复核记录直接调 `search()` 得到 top1 分数 1.5–9.8，全部高于 `MIN_SCORE = 0.5`，说明阈值挡不住 OOD 里的高频 bigram。这是缺陷信号，不是通过。 |
| N26 | 金句判定已改全文 | `evaluateRetrieval` 在 `corpus` 全文做 `includes`（`src/lib/ragEval.ts:290-306`），`buildCorpus` 用 `title+"\n"+text`（`scripts/eval-rag.ts:165-167`）；这是已关闭的 blocker，不是缺口。 |

## 7.4 搜索、语音与 server 模式

| # | 限制 | 证据 / 影响 |
| --- | --- | --- |
| N27 | 导师页未把 `{mode, loggedIn}` 传给搜索 | `app/tutor/page.tsx:489`、`:788` 使用默认 runtime `{mode:"local", loggedIn:false}`（`src/lib/searchClient.ts:65-68`）。server 模式下 Tavily 被当成本机直连；DeepSeek 一律回退维基。设置页的搜索表单存在，但导师页这条链没有真正走 server 搜索。 |
| N28 | server 模式没有 `jsonMode` | `llmChat` strict 没有 `response_format`；出题/核对的 JSON 只能靠提示词 + `extractJson` 兜底（`src/lib/chat.ts:189-196`）。 |
| N29 | server 模式无法在客户端降级思考 | 代理把上游 400 映射成 502，`probeThinking` 只能得到 unknown + 错误体，而不是 unsupported；思考档由服务端 `options.thinking` 决定。 |
| N30 | `search_exhausted` / `tts_unavailable` 永不产出 | 契约里有码，路由没有候选链/对应分支。客户端不能按它们分支。 |
| N31 | 搜索 3xx 跟随、无体积上限 | 见 §5.3；`serverSearch` 未用 `guardedRequest`，与 TTS 路径不一致。 |
| N32 | 外部端点未验证 | DeepSeek 搜索 / MiMo / Embedding 均缺凭据；Tavily 无 key；维基本机 TLS 失败。`probe:external` 本轮输出「通过 0 / 失败 0 / 未验证 3」。不得写「已实测」。 |
| N33 | TTS 浏览器语音行请求 `/api/tts` 会 404 | 这是设计：浏览器语音不是「未配置」，客户端应直接走浏览器语音；不要把它当故障重试。 |

## 7.5 遗留六项口径

上一版遗留 16 条；本轮按复核要求固定为以下六条。每条给出今天的代码证据。

| # | 遗留 | 本轮口径 | 证据 |
| --- | --- | --- | --- |
| L1 | 思考 400 归因 | 仅当 HTTP 400 且错误体命中 `thinking` / `reasoning` / `budget` 关键字才写 `unsupported`；其余 400 写 `unknown` 并展示错误体；200 且正文与 reasoning 双空写 `unknown`。模型名/未知模型错误优先排除 | `classifyThinkingRejection`（`src/lib/thinking.ts:40-49`）；`chat.ts:530-585`、`:641`。server 模式代理把 400 映射 502，见 N29 |
| L2 | 方向切换 | 方向切换先清空 docs/chunks/vectors，消费方按 `directionId` 过滤，`kbLoading` 时禁止出题 | `src/lib/kbStore.ts:543-547`；`app/diagnose/page.tsx:195-202`、`:440`、`:518`；`knowledge-base-panel.tsx:73-92` |
| L3 | 清除按钮 | 新增 `clearSearchConfig` / `clearTtsConfig` 与按钮；服务端配置在 `SecretConfigForm` 有删除 | `src/lib/searchClient.ts:216-236`；`src/lib/tts.ts:182-191`；`src/components/secret-config-form.tsx:295-313`；`search-settings.tsx:243-249`；`tts-settings.tsx:383-389` |
| L4 | owner + accountTransition | `planAccountTransition` 纯函数决定清理；登录/注册/refresh/登出同路径；登出无条件全清 | `src/lib/accountTransition.ts:53-69`；`src/lib/useAuth.ts:99-139`、`:239` |
| L5 | Anthropic 缺 type | 非流式：`type` 缺失但 `text` 是字符串的块按正文；流式：`delta.type` 为空且 `text` 是字符串按 `text_delta`；推理只认 `type === "thinking"` | `src/lib/reasoning.ts:259-273`、`:317-330`；测试 `src/lib/reasoning.test.ts:533`、`:406` |
| L6 | 校准小样本 | `n<30` 时在 O/E 与 Brier 行之前标注「n=…<30，样本少，不作解读；以下仅为计算口径」；分箱 n<20 标「样本仅供参考」 | `src/lib/calibration.ts:286-291`、`:300-310`；`calibration-card.tsx:28-29`、`:116`；测试 `calibration.test.ts:355-389` |

## 7.6 本轮新增未完成

| # | 未完成 | 影响 | 入口 |
| --- | --- | --- | --- |
| X1 | 内置知识点接向量 | 只有上传资料走 RRF；知识点与评测语料仍是纯 BM25 | `app/tutor/page.tsx:347`、`scripts/eval-rag.ts` |
| X2 | `search_exhausted` / `tts_unavailable` | 契约码无法分支 | §5.3、§7.4 N30 |
| X3 | CAS 事务化 | 并发 PUT 可双写成功 | `src/lib/kbServer.ts:461-512` |
| X4 | tombstone | 删除后旧设备 PUT 可复活 | §3.4、§3.9 |
| X5 | 多密钥并存 | 轮换必须让所有用户重存 | §2.7 |
| X6 | 自建限流 | 登录用户可无限调用代发与 8MB PUT | §7.1 S8 |
| X7 | search/tts 请求体与响应字节上限 | DoS 面 | §7.1 S7 |
| X8 | `/api/kb` PUT `maxDuration` | 大文档可能被平台超时 | §7.1 S9 |
| X9 | OOD 拒答 | 域外问题仍会拿到依据 | §4.7、§7.3 N25 |
| X10 | README / `.env.example` 文案同步 | README:849 与 `.env.example:41` 的 SSRF 描述与实现相反 | §7.7 |
| X11 | 409 的 `written: 0` | 类型语义与本地真实状态不符 | §7.2 N10 |
| X12 | 换号 IndexedDB 删除等待完成 | 新账号读 KB 可能挂起；旧实例可能推残留 | §7.2 N9 |
| X13 | `syncedStorages` 失效机制 | 旧实例的告警/首同步状态被复用 | §7.2 N8 |
| X14 | KB 读路径远端覆盖本地 | 未同步的本地修改被旧副本遮住 | §7.2 N4 |
| X15 | 记忆卡单卡删除接线 | 本地删掉的卡下一次拉取复活 | §7.2 N12 |
| X16 | 远端 400 当告警 | 永不合法的一次写入会一直重试失败 | §7.2 N11 |
| X17 | 导师页搜索 runtime | server 搜索在导师页不生效 | §7.4 N27 |
| X18 | 认证跨组件/跨标签页 | 登出/换号后旧页面继续写 | §7.2 N15 |
| X19 | KB/记忆客户端超时 | 弱网下本地数据迟迟不显示 | §7.2 N7 |
| X20 | 相邻去重对齐 50 码点 | top3 重复注入相邻块 | §7.3 N18 |
| X21 | 评测质量门槛 | 回归/未测混合都会绿 | §7.3 N22 |
| X22 | 评测集 provenance 与难度 | 饱和、不能证明收益 | §7.3 N24 |
| X23 | 搜索 3xx `redirect:"manual"` | 声明不跟随但实际跟随 | §7.1 S2 |
| X24 | SSE 心跳对齐行边界 | 极端停顿会破坏一帧 | §7.1 S3 |
| X25 | 错误码/错误体统一 | 客户端要按路由选解析器 | §7.1 S4-S5 |
| X26 | config 64 KiB / chat 20000 收口 | 与方案值不一致 | §7.1 S6 |
| X27 | progress 等路由 origin/体积 | 防线不统一 | §6.4 |
| X28 | `hydrateProviderFromServer` 签名 | 与钉死值不一致 | §7.2 N1 |

## 7.7 README / `.env.example` 的已知文案偏差

- `README.md` 的环境变量表（`ALP_ALLOW_HTTP_PROVIDER_HOSTS` 行）写「内网网段即使列出也不放行」，与 `src/lib/ssrfGuard.ts:161-211` 的实际行为相反；同一行又建议填 `localhost,127.0.0.1`，自相矛盾。实际行为见 §7.1 S1。
- `.env.example:41` 同样写「127/8、10/8、192.168/16、169.254/16 等即使在这里列出也不放行」，同样与实现不符。
- README 的「本轮实测」表与 §8.1 的数字以本文为准；README 中未跑的项目（build、eval、probe、E2E）不得读成已通过。
- README 已承认的缺口（CAS 非事务、无 tombstone、mergeDocs 远端覆盖、单卡删除未接线、无 OOD 拒答、无条件搜索链等）与本 §7 一致；本文件不重复修改 README，只登记偏差。

# 验收方式

## 8.1 本轮实跑

**方案启动基线（上一轮记录）**：`npx tsc --noEmit` exit 0；`node node_modules/vitest/vitest.mjs run` → 33 files / 756 tests passed；`npm run check:secrets` → 152 files 未发现疑似密钥。当时 `npm run build`、`npm run eval:rag`（脚本尚不存在）、真实 DeepSeek/mimo/embedding 调用与 Playwright 均未跑。下面的表是**本轮收口后的复跑**，规模已随新增模块变大，不能与启动基线混读。

以下命令均在 `E:\传智杯` 本机执行，时间为 2026-10-29；输出为本轮实际结果，不是引用上一轮。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| 全量单测 | `npm test` | exit 0；64 个测试文件 / 1570 个测试全部通过 |
| 知识图谱 | `npm run kg:validate` | exit 0；9 学科 / 360 知识点 / 540 先修边 / 1080 题；0 error |
| 密钥扫描 | `npm run check:secrets` | exit 0；检查 224 个文件，未发现疑似密钥 |
| 完整 verify 链 | `npm run verify` | exit 0；typecheck → test → kg:validate → check:secrets 串跑通过 |
| 生产构建 | `npm run build` | exit 0；24 个路由（14 个动态 API + 10 个静态页面/内置页） |
| RAG 评测 | `npm run eval:rag` | exit 0；指标见 §4.6；混合检索「未测」 |
| 路径指纹 | `npm run path:hash` | exit 0；`algoVersion=plan-v2`、`kgVersion=kg-v1`、`totalMinutes=120` |
| 外部探测 | `npm run probe:external` | exit 0；通过 0 / 失败 0 / 未验证 3 |
| plan.ts 未改 | `git diff -- src/lib/plan.ts` | 空 |
| package.json 依赖未改 | `git diff -- package.json` | 只有 `smoke:auth` / `probe:external` / `eval:rag` 三行 scripts；无 dependencies/devDependencies 行 |

`npm test` 的 64 个文件中与本文直接相关的包括：`ssrf.test.ts`（119）、`ssrfGuard.test.ts`（23）、`origin.test.ts`（18）、`secretCrypto.test.ts`（18）、`userSecrets.test.ts`（16）、`apiContracts.test.ts`（55）、`config-route.test.ts`（19）、`llm-route.test.ts`（19）、`kbServer.test.ts`（27）、`kb-route.test.ts`（23）、`kbRemote.test.ts`（19）、`kbStore.test.ts`（27）、`memoryServer.test.ts`（16）、`memoryClient.test.ts`（14）、`memorySync.test.ts`（19）、`hybrid.test.ts`（25）、`hybridSearchClient.test.ts`（11）、`vector.test.ts`（24）、`embedding.test.ts`（25）、`serverEmbedding.test.ts`（12）、`ragEval.test.ts`（30）、`thinking.test.ts`（34）、`reasoning.test.ts`（52）、`calibration.test.ts`（30）、`accountTransition.test.ts`（8）、`serverSearch.test.ts`（13）、`serverTts.test.ts`（14）、`search-tts-route.test.ts`（20）、`mimo.test.ts`（16）、`websearch.test.ts`（42）、`searchClient.test.ts`（48）、`tts.test.ts`（42）、`provider.test.ts`（45）、`serverConfig.test.ts`（26）。

## 8.2 未跑 / 不可跑

| 检查 | 状态 | 原因 |
| --- | --- | --- |
| `BASE_URL=... npx tsx scripts/auth-smoke.ts` | **本轮未跑** | 本机已有一个 Next dev 进程占用 `E:\传智杯\.next\dev\lock`（端口 4000，连着 `.env.local` 的远端 Postgres）。再起一个 4310 实例被 Next 拒绝；不杀别人的进程、也不拿真实库跑测试账号。脚本本身覆盖 401/配置/KB/记忆卡接口（`scripts/auth-smoke.ts:336-620`），需在隔离环境按 §8.4 执行。 |
| 真实 DeepSeek / MiMo / Embedding 调用 | **未验证** | 缺官方凭据；`probe:external` 输出 0 通过 / 0 失败 / 3 未验证。见 §5.7。 |
| 真实 Postgres 路径 | **未跑** | 本轮测试全部走内存 DB 或路由级假 DB；不写用户库。 |
| 浏览器 E2E / Playwright | **未跑** | 未有隔离的 dev server 与浏览器分发；跨账号 IndexedDB、多标签页认证、上传→GET→改绑定→删除全链路没有浏览器级记录。 |
| 50 条评测集人工标注来源 | **无法证明** | 文件只有 6 个字段，无 provenance；不写「人工标注」。 |
| `npm run smoke` / `npm run smoke:mcp` / `npm run bench` | **未跑** | 需要运行中服务或 Playwright；本轮不重跑。 |

## 8.3 最终门禁

方案要求（本轮能执行的部分已在 §8.1 记录）：

```bash
npm run typecheck
npm run test
npm run kg:validate
npm run check:secrets
npm run build
npm run eval:rag
npm run path:hash
git diff -- src/lib/plan.ts          # 必须为空
git diff -- package.json             # 只能出现 scripts，不能出现 dependencies/devDependencies
BASE_URL=http://127.0.0.1:<port> npx tsx scripts/auth-smoke.ts
```

- 前 7 条本轮均 exit 0（§8.1），另跑 `npm run verify` 串跑也 exit 0；`plan.ts` 无 diff；`package.json` 只有三行 scripts。
- auth-smoke 需在隔离环境执行：`DATABASE_URL= ALP_SECRET_KEY= npx next dev -H 127.0.0.1 -p <port>`（内存 DB、无主密钥），再 `BASE_URL=http://127.0.0.1:<port> npx tsx scripts/auth-smoke.ts`；它覆盖未登录 4 个 401、配置 200/503、KB 往返、记忆卡 LWW。本轮因共享 dev server 锁未执行，不写成通过。
- `npm run eval:rag` 的质量门槛尚未代码化（§7.3 N22）；即使 exit 0，也不能读成「质量达标」。

## 8.4 人工验收脚本

在隔离环境按以下顺序跑一遍，记录实际输出：

1. `DATABASE_URL=`（内存）+ 不配 `ALP_SECRET_KEY`：注册 A，访问 `/api/config` PUT → 503 `PERSISTENCE_UNAVAILABLE`；`/api/kb` PUT → 201/200 写入；`GET /api/kb?directionId=` 读回；`PUT /api/memories` 旧卡→新卡，`GET` 读回新卡；`DELETE` 清空。
2. 配 `ALP_SECRET_KEY`（32 字节标准 base64）+ 内存后端 + `ALP_ALLOW_MEMORY_SECRETS=1`（仅测试）：PUT `/api/config` → 200 + GET 只回 `hint`；响应 grep 不到明文；DELETE 后 `configured:false`。
3. 两个账号 A/B：A 上传文档，B 登录后 `GET /api/kb` 读不到；A→B 换号清本机 KB/密钥/learner；null→B 保留匿名 learner 并把记忆卡并入。
4. `PUT /api/kb` 用旧 `baseUpdatedAt` → 409 `CONFLICT_STALE`，且库中行未变；用新值重试成功。
5. `/api/search` 未登录 deepseek → 401；未登录 wikipedia → 200；`/api/tts` 未登录 → 401。
6. 配好 embedding 后上传缺向量片段，`GET ?vectors=1` 按 `next` 翻页；不配时 `/api/llm/embeddings` → 503，导师页显示「未使用语义检索」。

## 8.5 结论

- 八条 blocker 的**代码落点**都已存在：KB 写入点收口、内存 DB 分支、KB/记忆卡并发策略、provider/TTS 就绪、搜索穷尽、评测全文金句、探测脚本。
- 但「真正可用」要按 §5.6 的四层看：provider 与 TTS 可用；搜索在导师页仍缺 runtime 透传；外部端点全部未验证；KB/记忆卡同步有 §7.2 的读/删/竞态缺口；评测无质量门槛且混合检索未测。
- 因此本文件的准确结论是：**方案已定稿、主链路已接线、已知缺口已逐条登记**；不得把「已接线」写成「已实测」，也不得把「评测 exit 0」写成「质量达标」。
