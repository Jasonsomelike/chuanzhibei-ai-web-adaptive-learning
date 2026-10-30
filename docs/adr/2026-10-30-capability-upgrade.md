# ADR-0002：把确定性工作流升级为「可演示、可退路」的 Agent / 向量 / 多模态能力（E:\传智杯，单轮内落地）

## 背景与现状（Context）

【现状·已读代码】项目是 Next 16 + React 19 的自适应学习系统，模型调用统一走 src/lib/chat.ts（callChat / callChatStream），请求体由 src/lib/provider.ts:551-581 的 buildChatBody 构造，只发 {role:"user", content: string}，ChatBodyRequest（provider.ts:502-509）只有 system/user/maxTokens/temperature/jsonMode：发不出图片，也发不出工具。流式解析在 src/lib/reasoning.ts:289-311，只取 content/reasoning/finish_reason/usage，:300 用「四者全空即 null」判占位块——纯 tool_calls 的 chunk 恰好四者全空，会被静默丢弃；chat.ts:350、:490-492、:606-619 三处「空响应」判定也会把工具轮判成失败。服务端代发通道 app/api/llm/chat/route.ts:50 的 MAX_CHAT_BODY_BYTES=2MB，upstream.ts:106-148 从 messages 重建请求体（system 用 join，dialogue 原样）。

【现状·库】db.ts:896-913 的 kb_chunks 用 TEXT 存 JSON 向量，注释 876-878 明写「不引入 pgvector」；ensureSchema 在 DATABASE_URL 存在时对真实错误重抛（db.ts:945-947）；内存实现的 parseInsert 只认 EXCLUDED.col / $n（db.ts:91-152）。user_secrets 主键是 (user_id, kind)（db.ts:854-870），密钥 AAD 绑定 userId+kind（secretCrypto.ts:108-116），所以「多个 MCP 服务器各自的鉴权头」放不进现有表。

【现状·安全底座】ssrfGuard.ts:153 的 assertUpstreamAllowed（形状→DNS→钉 IP）+ :262 guardedRequest 是唯一出站传输，method 联合类型只有 GET|POST（:229）；ssrf.ts:139-150 默认只放行 https:443，本地 http 需进 ALP_ALLOW_HTTP_PROVIDER_HOSTS（.env.example:57-61）。routeAuth.ts 提供 requireApiUser / assertMutationOrigin / readJsonObject。

【本轮实测·库】只读查询（脚本读 .env.local 的 DATABASE_URL，未打印其值）：PostgreSQL 18.6 / server_version_num=180006 / db=neondb；pg_available_extensions 中 vector default_version=0.8.6、installed_version=NULL，pg_trgm 1.6 同样未装；pg_extension 0 行；kb_chunks 当前 0 行（chunks=0, with_emb=0）。即：扩展包可见但未安装，且没有历史向量需要回填。**未执行 CREATE EXTENSION**，因此「能否创建、vector 列能否写入、$1::vector 与 <=> 能否工作」本轮均未验证。

【本轮实测·上游】用 .env.local 的 ALP_E2E_LLM_*（base host=api.jasonsome.cn，path=/v1，model=deepseek-v4.1-flash，keyLen=36）直连 /v1/chat/completions：① 带 tools + tool_choice=auto → 200，finish_reason=tool_calls，1 个调用，name=get_weather，参数键 ["city"]；② content 数组（text+image_url data URI，1x1 PNG）→ 200，finish_reason=stop，答「绿色」；③ stream:true + tools → 200 text/event-stream，74 个 chunk，两个并行调用分别落在 index=0 / index=1，id 只在首块出现，arguments 按 2/4/1/3/2/1/1 字节碎片到达，finish=tool_calls；④ 两轮工具对话（assistant.content=""+tool_calls，再 role:tool + tool_call_id）→ 200 finish=stop，正文「北京现在天气晴朗，气温约 24°C…」。说明：该端点支持 vision 与 tool calling；本项目当前代码一条都发不出（见上）。

【本轮实测·驱动】node_modules/@neondatabase/serverless 的 prepareValue 对 JS 数组走 arrayString，生成 {1,2,3} 形式（index.mjs 内 us/arrayString 与 Tt 分支）；pgvector 的文本输入是 [1,2,3]，所以查询向量必须传字符串再 ::vector。

【本轮实测·体积】JSON.stringify 随机向量：512 维 10,123 B/段、1024 维 20,242 B、1536 维 30,400 B；按 knowledge.ts:26 的 800 段上限，一个方向分别是 7.72 / 15.44 / 23.19 MiB；kbServer.ts:623-664 的向量分页每页 ≤100（KB_VECTOR_PAGE_MAX），1536 维一页约 2.9MB。kbServer.ts:19 的 MAX_KB_PUT_BYTES=8MB，因此「整方向 800 段 + 1536 维」的 PUT 会被 413。

【本轮实测·零 key 嵌入】Xenova/bge-small-zh-v1.5 config.json：hidden_size=512、num_hidden_layers=4、max_position_embeddings=512、model_type=bert；onnx/model_int8.onnx Content-Length=23,903,394 B（22.8 MiB）；@huggingface/transformers 4.3.2 的浏览器包 dist/transformers.web.min.js=456,110 B（445KB），整包 unpacked 9.99MB。HF 模型卡未标 license（base BAAI 仓库为 MIT，分发需注明来源）。

【本轮实测·门禁】npm run verify → 通过（tsc exit 0；vitest 74 文件 / 1723 用例全绿；kg:validate 9 学科 360 点 / 540 边 / 1080 题 0 error；check:secrets 扫 252 文件无命中）。npm run check:bundle → 9/9 在预算内：/ 39.7/180KB、/tutor 243.1/254.1KB（余量 11.0）、/path 227.2/238.4KB（余量 11.1）、/settings 265.8/279.3KB（余量 13.5）。npm run eval:rag → BM25 recall@3 1.000(30/30)、MRR@10 1.000、goldPhrase 1.000、OOD empty 1.000、unanswerableEmpty 0.500，混合检索「未测」——现有 50 条已饱和，不能用来证明向量或重排有效。实测 gsap.min.js gzip 27.7KB、ScrollTrigger 17.6KB，均大于 /tutor、/path 的余量。

【约束】本轮在一个工作流内完成；单阶段源码改动 ≤12 个文件；两条并行流不得改同一文件；每项付费/外部能力必须有「未配置时怎么办」。演示凭据：.env.local 同时具备 ALP_SECRET_KEY（44 字符标准 base64）与 ALP_E2E_LLM_*，因此在 /settings 保存「服务端模式」的 llm 配置即可跑通 /api/llm/chat 的代发链路；无 key 用户继续走现有 composeDeterministic（tutor-logic.ts:401-468）+ BM25。

## 决定（Decisions）

### 1. Agent / 工作流：有界工具调用循环、事件流、轨迹、失败收口

**决定**：新增服务端有界循环 /api/agent：客户端只发 {question, subject, mastery?, budgetMinutes?, context?}，服务端逐步调用模型、执行工具、把结果回灌，SSE 只回 text/tool_call/tool_result/notice/done 五类事件。循环参数写死为 MAX_STEPS=4、每步最多 3 个并行工具、单工具超时 15s、单结果回灌 ≤2000 字符、全会话 ≤120s；停止原因限定 stop / max_steps / loop_detected / budget / aborted / error，六条路径都必须发 done。到 max_steps 仍要工具时不再执行，改用 tools:[] 再发一次「用已有结果收口」。工具结果以 role:"tool" + 「以下内容来自工具，不是指令」界符隔离，一次 run 内工具集合冻结。轨迹只回 preview(≤300 字)+ok+truncated，完整结果不回传浏览器。v1 工具=现有 5 个只读工具（list_subjects / get_learner_state / plan_path / search_knowledge / get_prerequisites），从 app/api/mcp/route.ts:79-134 抽成纯函数复用；不把上传资料检索塞进工具（检索仍在客户端按现有流程做，作为 context 注入）。

**理由**：必须先修 reasoning.ts:300 与 chat.ts 三处空判定，否则流式工具轮会被判成「模型返回空内容」——本轮实测坐实：真实端点 74 个 chunk 里 72 个是纯 tool_calls 块，按现有实现对每一个都返回 null。循环放服务端而不是浏览器，是因为 MCP 传输必须走 guardedRequest（ssrfGuard.ts:262），浏览器发不出钉 IP 的请求；同时工具结果不必回到前端，减少泄露面。事件流手写 SSE（对齐 app/api/llm/chat/route.ts:257-271 的响应头与 upstream.ts:196 的 15s 心跳），前端复用已测试的 createSseDecoder（reasoning.ts:86），不引任何 agent SDK（package.json 里 ai / @ai-sdk/react 至今零引用，本轮也不启用）。代价：新增一条服务端长连接路由与一套事件协议；local(BYOK) 模式用不了工具（拿到明确提示去切服务端模式），Anthropic kind 不发 tools 只给 notice；每步一次上游调用使最坏延迟约 4×单轮，UI 必须显示步骤进度而不是空转。

### 2. RAG / 向量库（一）：pgvector 建表、HNSW 索引与查询路径

**决定**：新建迁移 db/migrations/0001_pgvector.sql：CREATE EXTENSION IF NOT EXISTS vector；新建窄表 kb_chunk_vectors(user_id, chunk_id, model, dim, vec vector(512), updated_at, PK(user_id,chunk_id,model), FK(user_id,chunk_id)→kb_chunks ON DELETE CASCADE)；建**部分** HNSW 索引（USING hnsw (vec vector_cosine_ops) WITH (m=16, ef_construction=64) WHERE model='bge-small-zh-v1.5-q8'），CREATE INDEX CONCURRENTLY。**默认查询走精确扫描**：WHERE user_id=$1 AND direction_id=$2 AND model=$3 ORDER BY vec <=> $4::vector(512) LIMIT $5，由新路由 POST /api/kb/similar 承载（body 只带 512 个 float ≈10KB）。HNSW 只作为「公共语料 / 规模上去以后」的开关（ALP_PG_HNSW=1 时 SET LOCAL hnsw.iterative_scan=relaxed_order、ef_search=100），默认关闭。只承载 512 维本地模型；1024/1536 维外部嵌入继续走现有 TEXT 列 + 应用层余弦（vector.ts），不做迁移。

**理由**：规模决定索引无收益：方向上限 800 段（knowledge.ts:26），而查询必须带 user_id+direction_id 过滤，pgvector README 原文「If a condition matches 10% of rows, with HNSW and the default hnsw.ef_search of 40, only 4 rows will match on average」——过滤选择性一低，HNSW 会主动降召回。800 行 seq scan 远快于一次网络往返。窄表而不是给 kb_chunks 加列：不动热表、不重写 800 行、删表即回滚，且 TEXT 列仍是唯一真相（回滚不丢数据）。查询向量必须传字符串再 ::vector，因为驱动把 JS 数组序列化成 {1,2,3}（本轮读过 index.mjs 的 arrayString 分支）。代价：多一张表与一次 join；dim 固定 512 意味着只有本地模型享受 pgvector，外部端点用户没有收益（明写进 limits）；`<=>` 与 `$n::vector` 本轮**未验证**（未 CREATE EXTENSION），落地第一件事是在 Neon 分支上验证，失败则整体回退到「不建表，只做本地嵌入 + 更硬的评测」。

### 3. RAG / 向量库（二）：嵌入来源、迁移与回填

**决定**：零 key 主路径 = 浏览器本地模型 bge-small-zh-v1.5（int8/4 层/512 维/512 上下文，22.8MB），跑在 Web Worker 里；transformers.js 浏览器包（445KB）与模型都放 public/embed/ 与 public/models/，用 scripts/fetch-model.mjs 预取并校验 SHA-256，**不进 Next bundle、不进 git**，离线演示时 env.allowRemoteModels=false。查询侧加 BGE 中文指令，文档侧不加；导出与 vectorCache 同形的 embedLocal(texts, signal)。外部端点（现有 /api/llm/embeddings + embeddingModel 配置）保留为可选路径，任何维度都可用，但只有 512 维那批会双写进 kb_chunk_vectors。写入：putKbDocument 的 chunk upsert 循环（kbServer.ts:517-524）之后，若 dbBackend()==='postgres' 且 embeddingDim===512，每 50 条一条多行 INSERT..ON CONFLICT DO UPDATE 批量写（不在 parseInsert 里加表达式，内存实现直接跳过）。回填 scripts/migrate-vector.ts 按 1000 行一批，**从 TEXT 读出后在 JS 里按 $n::vector 参数写回**，不用 embedding::vector 这个未经验证的 text→vector 转换；跑完用 COUNT 对账。

**理由**：零 key 是硬要求，而服务端跑 transformers.js 不可行：onnxruntime-node 解包约 307MB，Vercel 函数未压缩上限 250MB。放 Worker + public/ 的好处是**完全绕开包体门禁**——check:bundle 只统计 /_next/static/chunks，/tutor 余量只有 11.0KB，任何打进 bundle 的做法都会直接失败。把本地模型限制在客户端也让「没有 key 也能语义检索」成立。代价：首次使用要下 22.8MB 模型（需预取与进度提示，否则首问卡住）；WASM 多线程需要跨源隔离，而 next.config.ts:7-17 只有 nosniff 与 Referrer-Policy、没有 COOP/COEP，实际会单线程（慢但可用，且不能随手加 COOP，那会破坏「允许被 iframe 嵌入」的演示设置）；Xenova 仓库卡未标 license，分发时要注明 base 模型与转换来源；目标库当前 kb_chunks 为 0 行，回填今天等于空跑，脚本价值在于别的部署与将来重放。

### 4. RAG / 向量库（三）：融合与是否 rerank

**决定**：融合层不动：继续用 hybrid.ts 的 RRF（K=60、每路候选 20、TOP_K=3、VECTOR_MIN_SCORE=0.25），`1 - (vec <=> $1)` 与现有余弦同尺度可直接入榜；相邻切块去重（dedupeAdjacentChunks，MIN_ADJACENT_OVERLAP=20）保留。**本轮不做交叉编码器 rerank**，也不做 query rewrite / 多轮检索。若评测出现明确缺口，只允许先加零成本启发式重排（标题/章节命中、查询 bigram 覆盖率、MMR 去冗余），且必须先在评测里证明收益再进生产。

**理由**：零 key 下重排器不可行：bge-reranker-base int8 约 266MB、bge-reranker-v2-m3 int8 约 544MB，浏览器与 250MB 的函数都不合适；服务端托管又是新的一笔付费/运维。RRF 只看名次不看原始分，正好躲开 BM25 与余弦的尺度差异，现有实现已有测试覆盖（hybrid.test.ts）。代价：语义相近但字面不同的长尾仍可能排在 top3 之外；没有重排意味着召回进来的噪声只能靠既有域外门控（rag.ts:138-162）与引用核对兜底，而非排序修正。

### 5. RAG / 向量库（四）：如何证明向量有效

**决定**：现有 50 条评测**只当回归门槛**（今天实跑 recall@3 1.000，已饱和），不当证据。新建 chunk 级 hard 集（约 40 条，语料用 500 字切块而不是整篇 kbDocuments），四臂对照：无检索（恒空，只作下界）/ BM25 / 纯向量 / RRF（+ 可选启发式重排），指标加 nDCG@10、recall@20、逐条词面覆盖率（证明 hard 集真的不靠字面），报告必须带 n 与配对 bootstrap 区间，并明确写「区间是否排除 0」。scripts/eval-rag.ts 增加 --data 与 --mode vector|hybrid|bm25，未配置嵌入时打印「未测」而不是编数字。

**理由**：评测口径与生产不一致是当前最大的伪证据来源：eval-rag.ts 用 40 篇整篇文档，而生产 RRF 用的是用户上传的 500 字片段，两者不可互证；且 n=50（answerable 30）时单条差异就是 3.3 个百分点。把「无检索」当实验臂会得到恒空结果，那是定义上的下界。代价：写 hard 集与配对检验要额外 1 个阶段；即便做完，也可能得到「向量没有显著收益」的结论——必须照实写，不能为了叙事改口径。

### 6. 多模态：vision content 数组 + 浏览器语音识别 + 现有 TTS

**决定**：① Vision：apiContracts 的 chatMessage.content 改为 union(string, parts[≤4])，图片只接受 data:image/(jpeg|png|webp|gif);base64（拒绝 http(s) URL，避免让上游替我们抓取）；单图压到长边 1568px、JPEG q0.82、≤400KB，一次 ≤3 张；MAX_CHAT_BODY_BYTES 2MB→4MB 并补 413 用例。Anthropic 分支在 upstream 里转成 {type:"image", source:{type:"base64", media_type, data}}（去 data: 前缀），OpenAI 分支原样透传。提示词用【图中文字】/【解答】两段，引用解析只喂解答段；转写段里的 [c09] 不算引用。图片只在当轮出现，后续多轮只带转写文本，不落库。② 语音输入：Web Speech API 运行时特性检测（window.SpeechRecognition ?? webkitSpeechRecognition），lang=zh-CN、continuous=false、interimResults=true，只填空不自动发送；错误码逐条映射成人话且**不重试**；不做服务端 ASR。③ TTS 沿用 tts.ts / read-aloud.tsx，不改。

**理由**：三处契约必须一起改才通：apiContracts.ts:167-170 只收字符串（本轮探针实测数组被拒）、provider.ts:502-509 的 user 是 string、upstream.ts:112-118 把 system join 成字符串。但 upstream 的 dialogue 其实是**原样透传**的（本轮探针确认：OpenAI 分支数组原样保留，Anthropic 分支也保留但形状是 OpenAI 的 image_url，会 400；system 传数组会 join 成 "[object Object]"）——所以改动比想象小：补 textOf 提取 + Anthropic 转换即可，边缘不用重写。语音只做浏览器端：MDN 明说 Chrome 的识别是服务端完成的（音频会发给浏览器厂商），自建 ASR 要音频上传、webm/opus 转码与付费识别或本地 whisper，本轮没有零 key 的稳妥路径。代价：服务端模式下图片会经过本项目转发（需在设置页隐私说明写清，且明确不落库）；Chrome 语音依赖厂商服务，中国大陆网络下可能 network 错误；HEIC 等浏览器解不了的格式只能拒绝；400 若是「模型不支持图片」必须显式失败并给「改为文字提问」按钮，**绝不静默去图重发**（否则用户拿到答非所问却看起来正常的回答）。

### 7. 人格与可读性：可配置语气、结构化回答、例子与下一步、回归

**决定**：新增 src/lib/tutorPersona.ts（纯函数）：固定助教身份 + 三套语气块（陪伴/学长/严格）+ 共用 ANSWER_SHAPE（声明（若需）→ 结论 ≤40 字 → 1–2 句解释 → 一个具体例子 → 可选易错点 → 可执行下一步）+ 禁语表与「反例→改写」+ 不确定协议三选一（资料没有/两说并存/我不确定+如何验证）。长度按题型给预算（概念 260–320、为什么排这步 150–220、订正 180–260、拒答 ≤80），替换 app/tutor/page.tsx:150-163 的 SYSTEM_PROMPT，删掉 :159 的「200 字以内」。**声明必须排在结论之前**，因为 tutor-logic.ts:207-221 要求通用知识声明落在开头 20 字内。可读性：mini-markdown 增加 paragraph 与 listItem 两类 token，答案列改 max-w-[36em]、leading 1.75，assistant 消息去掉 Card 改 border-t 阅读列；超预算 1.5 倍只加 note、不截断。回归：新增 scripts/eval-tutor.ts + src/lib/tutorEval.ts + 10 条 rubric（8 维 0/1/2，硬门 R1≥1、R5=2、R7=2），默认 --judge rules 零 key，--judge llm 时必须逐条给 quote 并由代码校验是答案子串；`eval:tutor --judge rules` 进 npm run verify。

**理由**：现在的人格只有一段 12 条规则的常量提示词，第 8 条「200 字以内」与「一个具体例子 + 一个可执行小步骤」在预算上直接打架。把人格拆成纯函数后可以单测（现有 tutor-logic.test.ts 30 条是安全基线，本轮实跑 30 passed），也能让无模型路径 composeDeterministic 说同一套话。可读性问题是实测的：tokenizer 只有 text/strong/code/pill/break（mini-markdown-tokenizer.ts:1-25），模型输出「1. 先看 push」会原样显示成字面量；回答容器是 <p className="text-sm leading-relaxed">（page.tsx:1045），行高 1.625 低于全局 1.75。代价：长度预算从 200 字提到 260–320，token 成本约 +30%–60%（纯算术，未实测）；规则评分只能覆盖结构，覆盖不了「说得好不好」，所以只报逐条分数、不报通过率；judge 用同模型判自己的输出会偏高，必须配人工校准 3 条以上。

### 8. MCP：客户端配置、工具发现与调用、安全边界

**决定**：新增表 mcp_servers(user_id, server_id, label, url, enabled, allowed_tools_json, auth_ct/auth_iv/auth_tag/auth_kid/auth_hint, created_at, updated_at, PK(user_id,server_id))，鉴权头用现有 sealSecret 加密、AAD 用 kind=`mcp:<server_id>`，公开响应只回 hint；CRUD 走新路由 /api/mcp/servers（requireApiUser + assertMutationOrigin）。客户端实现 MCP 2025-06-18 Streamable HTTP：单端点 POST、Accept: application/json, text/event-stream、双读 JSON/SSE、Mcp-Session-Id 透传、每请求带 MCP-Protocol-Version、404 重新 initialize 一次、notification 202、超时发 notifications/cancelled。工具名命名空间 mcp__<serverId>__<tool> 并校验 ^[A-Za-z0-9_-]{1,64}$。安全边界五条硬规则：① 服务器地址只能来自用户设置，绝不能由模型参数决定；② 一律 assertUpstreamAllowed + guardedRequest（本地 http 必须显式进 ALP_ALLOW_HTTP_PROVIDER_HOSTS）；③ 工具白名单三层（代码内只读集合 ∩ 用户勾选 ∩ tools/list），默认拒绝；④ 输出用 role:"tool" + 界符隔离，且不得修改 tools/system/白名单（一次 run 冻结）；⑤ v1 不暴露非只读工具，annotations 只当 hint、不据此判安全。同时修补本项目自己的 /api/mcp：非 initialized 的 notification 也返 202、校验协议版本头。

**理由**：现有 /api/mcp 是服务端、没有客户端；tools 定义写死在 route（app/api/mcp/route.ts:79-134），要复用得先抽纯函数。配置必须落库并加密：user_secrets 主键 (user_id,kind) 一行只能放一个服务器，装不下多个；而且 apiKey/extraHeaders 只允许进密文（userSecrets.ts:59-67），所以另起表是唯一不破坏现有白名单的做法。SSRF 是这里最硬的一条：ssrfGuard 已经做了形状→DNS→钉 IP，但 method 只有 GET|POST（ssrfGuard.ts:229），会话终止要么补 DELETE 要么放弃（v1 放弃，记入 limits）。代价：每请求一次 DNS + 一次 guardedRequest，MCP 调用延迟比本地工具高一个数量级；没有 DELETE 会让服务端会话挂到过期；仅支持 Streamable HTTP，不支持 stdio 与旧 HTTP+SSE；本项目 /api/mcp 仍无鉴权（公开只读），一旦加写工具必须先补鉴权与限流。

### 9. UI / 动效：GSAP 的范围与克制、视觉层级、不引新框架

**决定**：GSAP 只上 `/`（首页 hero + 3 张承诺卡，一条 timeline，0.35s、stagger 0.06，只播一次，gsap.matchMedia("(prefers-reduced-motion: no-preference)") + context.revert()），并把 settings 与 secret-config-form 里重复的 useIsoLayoutEffect / useMotionSafe / confirmPulse 抽到 src/components/motion.ts 复用。**/tutor 与 /path 不引 GSAP**：高亮与数字滚动用 CSS keyframes + requestAnimationFrame（300ms，reduced-motion 直接设终值）。/path 的 scrollIntoView 改为先读 prefers-reduced-motion 再选 auto/smooth；reduced-motion 块补 animation-delay:0.01ms。视觉层级：assistant 改无边框阅读列（border-t 分隔、36em 行宽），user 保留 accent 卡，引用/上传/网络/核对继续小卡片；只保留一套字号阶梯与 .tabular 数字。不引 framer-motion、不引 @gsap/react、不做滚动劫持/parallax/逐字打字机。

**理由**：预算是硬的：/tutor 余量 11.0KB、/path 余量 11.1KB，而 gsap.min.js gzip 27.7KB、ScrollTrigger 17.6KB（本轮 node zlib 实测；check:bundle 本轮 9/9）。任何把 GSAP 打进这两个路由的做法都会直接超门禁，且规则是「拆包或按实测下调基线」，不允许手工上调。首页余量 140.3KB，放 GSAP 绰绰有余。另有两个现有缺陷顺手修：tutor:344 与 path:257 的 scrollIntoView 显式写 behavior:"smooth"，不受 CSS scroll-behavior:auto 约束（规范行为），reduced-motion 下仍会平滑滚动；globals.css:226-235 只压 animation-duration、不压 animation-delay，带 delay 的入场会先空白一段。代价：/tutor 少了 GSAP 的编排能力；把消息入场做成 CSS 动画要避开每次流式 patch 重播的问题（因此本轮干脆不做逐条消息入场动画）；motion.ts 抽取会让 settings 与 secret-config-form 产生一次性改动。

## 实施顺序（Phases）

- 阶段 0｜基线冻结（0 文件，只跑命令）｜目标：把「改动前是什么样」变成可复现的数字。｜文件：无。｜完成判据：本轮已实跑，见 acceptance 第 1 条。
- 阶段 1｜契约与模型通道（10 文件，单一写入者，**本轮唯一允许改 apiContracts.ts 的阶段**）｜目标：让请求/响应通道同时支持「图片 parts」「工具调用」「多轮 transcript」，并冻结后续所有 HTTP 契约（vision parts、agent 请求与事件、MCP 服务器 CRUD、kb similar、CHAT_PURPOSES 增加 agent）。｜文件：src/lib/apiContracts.ts、src/lib/provider.ts、src/lib/upstream.ts、src/lib/chat.ts、src/lib/reasoning.ts、src/lib/toolCalls.ts（新）、src/lib/toolMessages.ts（新）、src/lib/vision.ts（新）、app/api/llm/chat/route.ts、scripts/mock-provider.ts（新增 /tools/v1 与 /vision/v1 档）。｜完成判据：acceptance 第 2 条；此阶段结束即冻结 apiContracts，后续阶段只能 import。
- 阶段 2｜Agent 服务端 + MCP 客户端（11 文件，与阶段 3 并行，文件不相交）｜目标：把 5 个只读工具抽成纯函数、实现有界循环与事件流、接入用户自建 MCP 服务器（鉴权头加密落库）、修补本项目 /api/mcp 的 notification 与协议版本。｜文件：src/lib/mcpTools.ts（新）、src/lib/mcpClient.ts（新）、src/lib/mcpServers.ts（新）、src/lib/agentLoop.ts（新）、src/lib/agentRunner.ts（新）、src/lib/agentProtocol.ts（新）、app/api/agent/route.ts（新）、app/api/mcp/servers/route.ts（新）、app/api/mcp/route.ts、src/lib/db.ts（新增 mcp_servers 的 SCHEMA 与内存分支）、src/lib/ssrfGuard.ts（method 增加 DELETE）。｜关键拆分：agentLoop 是纯状态机（注入 callModel / callTool / now / signal），agentRunner 才碰 DB、guardedRequest 与密钥；工具集合在 run 开始时冻结。
- 阶段 3｜向量存储与零 key 嵌入（10 个源码文件 + 2 个静态资产，与阶段 2 并行，文件不相交）｜目标：建 pgvector 窄表与部分 HNSW 索引、双写 512 维向量、新增 /api/kb/similar 让浏览器只发查询向量、本地 Worker 模型、回填脚本。｜文件：db/migrations/0001_pgvector.sql（新）、src/lib/kbVectors.ts（新）、src/lib/kbServer.ts、src/lib/embeddingLocal.ts（新）、public/embed/worker.js（新）、scripts/fetch-model.mjs（新）、scripts/migrate-vector.ts（新）、app/api/kb/similar/route.ts（新）、src/lib/hybridSearchClient.ts、.gitignore；资产（不计源码）：public/embed/transformers.web.min.js、public/models/bge-small-zh-v1.5/。｜硬前置：先在 Neon 分支验证 CREATE EXTENSION → 写一条 $1::vector → <=> 查询，任一步失败就整体回退到「不建表」。
- 阶段 4｜RAG 评测（4 文件，依赖阶段 3 的向量产出，可与阶段 5 并行）｜目标：把「向量有没有用」变成带区间与 n 的实验结论。｜文件：scripts/eval-rag.ts、src/lib/ragEval.ts、scripts/eval-data/rag-eval-hard-40.jsonl（新数据）、scripts/eval-data/vectors-hard.jsonl（生成物，不进 git）。｜产出：四臂表格 + nDCG@10 + recall@20 + 词面覆盖率 + 配对 bootstrap 区间 + 「CI 是否排除 0」的明文结论。
- 阶段 5｜人格与可读性（8 文件，与阶段 4 可并行；**第一次改 app/tutor/page.tsx**）｜目标：三套可切换语气、结构化回答形状、段落与列表渲染、36em 阅读列、10 条 rubric 回归并接入 verify。｜文件：src/lib/tutorPersona.ts（新）、src/components/tutor-logic.ts、src/components/mini-markdown-tokenizer.ts、src/components/mini-markdown.tsx、app/tutor/page.tsx、src/lib/tutorEval.ts（新）、scripts/eval-tutor.ts（新）、package.json（只加 eval:tutor 与 verify 一行）。｜约束：声明必须排在结论之前；assistant 去 Card 与 36em 行宽只在本阶段做一次，后续阶段不再改这块样式。
- 阶段 6｜多模态与 Agent 前端（6 文件，必须在阶段 5 之后，**第二次也是最后一次改 app/tutor/page.tsx**）｜目标：粘贴/选择/拍照 → 压缩 → 预览 → 带图提问；浏览器语音输入；/api/agent 的轨迹渲染与降级提示。｜文件：src/components/image-attachment.tsx（新）、src/components/speech-input.tsx（新）、src/lib/speech.ts（新）、src/lib/visionPrompt.ts（新）、src/components/agent-trace.tsx（新）、app/tutor/page.tsx。｜约束：只贴图不写字也必须能发送（现在 page.tsx:397 会直接丢弃）；图片绝不落库；工具轨迹只显示 preview。
- 阶段 7｜动效与视觉收敛（7 文件，最后做，不与任何阶段并行）｜目标：GSAP 只上首页、抽 motion.ts 复用、修 reduced-motion 两个漏洞、路径页高亮与滚动、数字滚动。｜文件：src/components/motion.ts（新）、src/components/hero-reveal.tsx（新）、app/page.tsx、app/globals.css、app/settings/page.tsx、src/components/secret-config-form.tsx、app/path/page.tsx。｜禁止：不改 app/tutor/page.tsx（避免第三次编辑同一文件）、不给 /tutor 与 /path 引入 gsap、不上调任何基线。

## 明确不做（Non-Goals）

- 不做自建 ASR：不新增音频上传路由、不做 webm/opus 转码、不接付费识别、不跑本地 whisper；语音只在浏览器 Web Speech 可用时启用，不可用就打字。
- 不做 Anthropic 的工具调用（tool_use / input_json_delta 只保证不被误判成正文）：kind=anthropic 时不发 tools，界面明确说「当前供应商未启用工具」。
- 不做交叉编码器 rerank、query rewrite、多轮检索；启发式重排必须先由评测证明收益才允许进生产。
- 不把 HNSW 作为默认检索路径：800 段/方向 + user_id/direction_id 过滤下它会降召回，默认精确扫描，索引只做将来公共语料的开关。
- 不做非只读 MCP 工具与二次确认审批回路；v1 只暴露只读工具。
- 不给 /api/mcp 加鉴权：它现在是公开只读端点，加鉴权会挡掉所有外部 MCP 客户端；一旦要加写工具，鉴权必须先于工具落地。
- 不做服务端 OCR / 图片落库 / tesseract.js：本轮只做 vision 输入，图片只在内存与消息对象里存活，刷新即失。
- 不做语音自动发送与连续识别（continuous=true 需要自己 restart，容易变成死循环）。
- 不做服务端自托管嵌入（onnxruntime-node 解包约 307MB，超过 Vercel 函数 250MB 上限）。
- 不引任何新动画/Agent 框架：不加 framer-motion、不加 @gsap/react、不启用 package.json 里已存在但零引用的 ai / @ai-sdk/react。
- 不把 agent 轨迹持久化到库或 localStorage：轨迹只在当前会话内，刷新即失（隐私与体积）。
- 不上调 scripts/check-bundle.ts:50 的 BASELINE_KB：超预算只能拆包或动态 import，不能改数字变绿。
- 不预设「向量一定有效」：如果 hard 集的配对区间跨 0，就写「未证明有收益」。
- 本轮不做后台索引队列/异步 worker：索引在请求内完成，超时即降级，不把失败藏进异步任务。

## 验收（Acceptance）

1. 阶段 0（本轮已实跑，作为回归基准）：`npm run verify` → tsc exit 0；74 test files / 1723 tests passed；kg:validate 9 学科 0 error；check:secrets 扫 252 文件无命中。`npm run check:bundle` → 9/9，/tutor 243.1/254.1KB、/path 227.2/238.4KB、/ 39.7/180KB。`npm run eval:rag` → recall@3 1.000(30/30)、MRR@10 1.000、OOD empty 1.000、unanswerableEmpty 0.500、「混合检索：未测」。只读库查询 → PostgreSQL 18.6、vector 0.8.6 未安装、kb_chunks 0 行。
2. 阶段 1：`npm run typecheck` exit 0；`npm test` 全绿且新增 src/lib/toolCalls.test.ts / toolMessages.test.ts / vision.test.ts，扩展 reasoning.test.ts（纯 tool_calls chunk 不再返回 null）、chat.test.ts（工具轮不算空响应）、apiContracts.test.ts（content 数组通过、data: 以外被拒）、llm-route.test.ts（4MB 上限的 413）；`npm run check:bundle` 仍 9/9 且 /tutor 不高于 254.1KB。真实端点手工验收（本轮已预跑 wire format，改动后需在应用内复跑）：/settings 保存 ALP_E2E_LLM_* 后，向 /api/llm/chat 发一条 content 数组消息 → 200 且正文非空；发一条带 tools 的请求 → 不再报「模型返回空内容」。
3. 阶段 2：`npm run typecheck`、`npm test` 全绿（新增 agentLoop/mcpClient/agentProtocol/mcpServers 用例，覆盖并行工具、参数碎片拼接、max_steps、loop_detected、工具报错回灌、MCP 404 重协商一次）；`BASE_URL=http://127.0.0.1:3211 npx tsx scripts/mcp-smoke.ts` → 16/16（重构 route 后协议不变）；`npm run check:bundle` 9/9（agent 代码全在服务端，客户端体积不变）。手工演示：/tutor 开工具模式问「给我排一条 90 分钟的路径」→ 轨迹至少 list_subjects + plan_path 两步，最终文本引用路径指纹；停掉 MCP 服务器后 → notice「MCP 不可用」且本地工具仍可完成；未登录 → 401、local 模式 → 明确提示切服务端模式。
4. 阶段 3：先在与主库隔离的 Neon 分支执行 `CREATE EXTENSION vector;` → `SELECT extversion FROM pg_extension WHERE extname='vector'` 期望 0.8.6；写入一条 `$1::vector` 并执行 `SELECT 1 - (vec <=> $1::vector(512))` 期望返回数值（这三步本轮**未跑**，是进入主库的硬前置）。主库迁移后：`SELECT count(*) FROM kb_chunk_vectors` 与 `SELECT count(*) FROM kb_chunks WHERE embedding_dim=512` 相等；`npx tsx scripts/migrate-vector.ts --dry-run` → pending 0（当前 kb_chunks 0 行）；`npm run check:bundle` 9/9（worker 与模型在 public/，不进 bundle）；浏览器断网 + public/models 存在 → 本地嵌入可用并写入 512 维；删掉 public/models → 提示「本次未使用语义检索」并退回 BM25，主流程不受影响。
5. 阶段 4：`npm run eval:rag -- --data scripts/eval-data/rag-eval-hard-40.jsonl --mode bm25|vector|hybrid` → 输出四臂表格、每臂 n、nDCG@10、recall@20、词面覆盖率与配对 bootstrap 区间，并打印「区间是否排除 0」；现有 50 条仍为 1.000（只作门槛）；未配置嵌入时打印「混合检索：未测」且 exit 0。验收只看「表是否完整、结论是否照实」，不预设向量一定赢。
6. 阶段 5：`npm run eval:tutor -- --judge rules` → 10 条全部产出逐条分数，硬门 R1≥1、R5=2、R7=2 全过；`npm test` 全绿（tutor-logic 新增：转写段里的 [c09] 不算引用、声明必须在结论前、段落与列表 token 正确、流式光标挂在最后一段）；`npm run verify` 通过（eval:tutor 已并入）；`npm run check:bundle` /tutor ≤254.1KB。未配置 judge 时打印「judge 未测」并 exit 0。
7. 阶段 6：`npm run typecheck`、`npm test` 全绿（新增 speech.test.ts，用假构造器驱动 result/error/end）；`npm run check:bundle` /tutor ≤254.1KB，超了只能动态 import 拆包、不上调基线。手工：只粘贴一张截图不输入文字也能发送（修复 page.tsx:397 的空文本早退）；回答严格分成【图中文字】/【解答】且引用只来自解答段；换成不支持图片的模型 → 明确提示「该模型不支持图片」并给「改为文字提问」按钮，不静默去图重发；Chrome 拒绝麦克风 → 提示如何授权；不支持的浏览器 → 按钮给出具体原因且不自动重试。
8. 阶段 7：`npm run check:bundle` → / 约 68KB（39.7 + gsap gzip 27.7）≤180KB，/tutor 与 /path 体积不变；`npm test` 全绿。手工：系统开启「减少动态效果」→ 首页无入场动画、/path 不再平滑滚动、带 delay 的动画不空白；关闭 → 首页只播一次 stagger；控制台无 gsap 警告、切页不重复播放。
9. 跨阶段总门禁：每个阶段结束都必须 `npm run verify` + `npm run check:bundle` 双绿；每条 CREATE/ALTER/数据写入前先 --dry-run 或 COUNT 对账；任何「已实现」的结论必须能指到上面的命令或 context 里的实跑记录，未跑的项一律写「未验证」。

## 独立评审

**评审结论：未通过（approved: false）。**

### 问题

1. [范围/工作量] 7 个阶段共约 56 个源文件（10+11+10+4+8+6+7），外加新表/迁移、22.8MB 浏览器模型、第三方 MCP 协议、vision/语音和 GSAP；关键路径 1→2/3→4/5→6→7 串行，且阶段 2/3、4/5 的并行仍受阶段 1 契约和阶段 3 向量产出约束。现有基线虽已实跑通过（`npm run verify` 74 文件/1723 用例、`npm run check:bundle` 9/9），但新增模块的测试、真实 Neon DDL、MCP 服务器和浏览器手工验收无法在一个工作流内可靠完成。ADR 的『单阶段 ≤12 文件』只限单阶段，不改变总量。
2. [阶段依赖/文件所有权] 阶段 2 的手工验收要求 `/tutor` 开工具模式、显示轨迹与 notice，但 `agent-trace.tsx` 和 `app/tutor/page.tsx` 的工具 UI 被排在阶段 6（阶段 2 文件列表没有 page.tsx/agent-trace），阶段 2 结束时这些验收无法执行。应改为阶段 2 的 curl/SSE 级验收，或把该手工验收移到阶段 6。
3. [一致性/pgvector 表与查询] 决策（RAG 一）定义 `kb_chunk_vectors(user_id, chunk_id, model, dim, vec vector(512), updated_at, ...)`，没有 `direction_id`；示例查询却写 `WHERE user_id=$1 AND direction_id=$2 AND model=$3`，按字面实现会报 column does not exist。并且 `/api/kb/similar` 的 body『只带 512 个 float』，没有 `$2`/`$3` 的来源。必须明确 JOIN `kb_chunks` 或增加 direction_id，并说明 direction/model 从哪里来、如何鉴权。
4. [阻断/迁移与 DDL] 仓库没有迁移执行器：`db.ts` 只在 `ensureSchema` 里执行 SCHEMA（src/lib/db.ts:896-913、:945-947），没有 `db/migrations` 的运行脚本或 `db:migrate` 命令，阶段 3 的『主库迁移后』没有可执行命令。`CREATE INDEX CONCURRENTLY` 不能在事务块内执行，新表为空时也无需 CONCURRENTLY；`SET LOCAL hnsw.iterative_scan/ef_search` 只在当前事务/会话有效，而 Neon HTTP 驱动每次 `sql.query` 是独立请求（src/lib/db.ts:39-50），不会保留。按题目能力探测，`CREATE EXTENSION vector` 本轮未执行、扩展未安装（0.8.6 可见但 installed_version=NULL），不能按默认可用处理。
5. [阻断/本地嵌入端到端] `putKbDocument` 在服务端用 `embedTextsForUser` 补齐向量（app/api/kb/route.ts:139；src/lib/kbServer.ts:330-370），该函数请求 `/embeddings`，而能力探测显示该上游返回 404。浏览器本地模型是唯一的 512 维来源，但阶段 3 文件列表没有 `kbStore.importDocument`、`kbRemote.putDoc` 或 `app/tutor/page.tsx`，没有把 `embedLocal` 的结果放进 `kbPut` 的 `chunks[].embedding`（契约支持该字段，见 src/lib/apiContracts.ts:289-291）。因此阶段 3 的『本地嵌入可用并写入 512 维』没有落地路径；检索侧 `embed` 注入还在 app/tutor/page.tsx:425-491（阶段 5/6 才改）。
6. [阻断/8MB PUT] `MAX_KB_PUT_BYTES=8MB`（src/lib/kbServer.ts:19），方向上限 800 段（src/lib/knowledge.ts:26）、每段 500 字（src/lib/knowledge.ts:32）。按 ADR 自己实测的 512 维向量 JSON 约 10,123 B/段，仅向量就 7.72MiB；再加 500 字正文（约 1.5KB/段）与元数据，满方向 PUT 已超过 8MiB，会 413。ADR 只警告了 1536 维，漏了 512 维 + 正文；需要分页、提高上限或只在相似路由存向量，并补满规模用例。
7. [阻断/阶段 4 向量生成与命令] 阶段 4 要求 `vectors-hard.jsonl` 与 `--mode vector`，但阶段 4 文件列表没有生成向量的脚本；`embeddingLocal.ts` 是浏览器/Worker，Node 侧 `eval-rag.ts` 没有本地模型，`@huggingface/transformers` 也不在 package.json（我查过 dependencies 24-38 行）。没有它，四臂表只能得到『未测』，而验收又要求表完整。另 `npm run eval:rag -- --data ... --mode bm25|vector|hybrid` 里的 `|` 在 shell 是管道，不是三选一；当前 `scripts/eval-rag.ts` 只接受 `--mode hybrid`（约 70-90 行），且 `EXPECTED_TOTAL=50` 硬编码（约 41-48 行），hard-40 需要同步改。
8. [阻断/check:bundle 验收] `scripts/check-bundle.ts:20-21` 明确用法是 `npm run build && npm run check:bundle`；它读取 `.next/server/app/...manifest`。所有阶段验收只写 `npm run check:bundle`，改完源码不重新 build 就会量到旧产物、假绿。必须把 `npm run build` 纳入每个阶段的 check:bundle 门禁，或让脚本自己 build。
9. [阻断/安全：MCP 只读白名单与提示词注入] 决策说白名单是『代码内只读集合 ∩ 用户勾选 ∩ tools/list』，又说『v1 不暴露非只读工具，annotations 只当 hint』。对第三方 MCP 服务器，代码无法从 annotations 判断只读；若『代码内只读集合』只含本地 5 个工具，远程 MCP 工具永远进不来；若允许远程工具，用户就能勾选有副作用的工具，与 non-goal 冲突。另：被隔离的是 tool result，tools/list 的 description/inputSchema 仍是不可信提示词，恶意服务器可在描述里注入；模型还可能把前一个工具的结果作为参数发给 MCP 服务器（只读不等于防外泄）。需要代码级 per-server/per-tool allowlist 或逐次人工确认，并明确描述/参数的信任边界。
10. [高/安全：鉴权和字段] `/api/agent` 与 `/api/kb/similar` 的鉴权没有写进决策（只在阶段 2 手工验收里出现 401）；`/api/kb/similar` 必须从会话取 user_id，不能从 body 取，且需要方向/模型来源与限流。`mcp_servers` 只有 auth_ct/iv/tag/kid/hint，没有 auth header 名/格式字段；若只存固定 `Authorization`，`X-API-Key` 类服务器无法配置，需明确密文里存的是 JSON 还是固定 Bearer。`src/lib/ssrfGuard.ts:229` 的 method 只有 GET|POST；阶段 2 文件列表写『method 增加 DELETE』，决策却说 v1 放弃 DELETE，二者矛盾。
11. [高/验收命令与计数] `scripts/mcp-smoke.ts` 顶层有 18 个 `check(`，不是 ADR 写的 16/16（我用 `grep -n '^check(' | wc -l` 得到 18，位置 51-250）；且它要求 3211 已有服务（文件头约第 8 行），验收没给启动命令。`scripts/migrate-vector.ts --dry-run` 若不像 `scripts/eval-rag.ts:37` 那样 `process.loadEnvFile('.env.local')`，会静默用内存库、pending 0 变成假通过。阶段 3 的 `CREATE EXTENSION`/`SELECT` 是裸 SQL，没有可执行命令（psql 或 tsx 脚本）。
12. [高/阶段 7 自相矛盾] 阶段 7 的 why 说顺手修 `app/tutor/page.tsx:344` 的 `scrollIntoView({behavior:'smooth'})`，但阶段 7 文件列表只有 `app/path/page.tsx`，且明确『禁止：不改 app/tutor/page.tsx』。这个 reduced-motion 漏洞按计划不会被修；应移到阶段 6 或允许一次编辑。
13. [中/零 key 与默认可用] 『零 key 主路径』依赖 `public/models` 22.8MB 与 `public/embed/transformers.web.min.js`，但仓库当前没有 `public/` 目录，且计划把它们 `.gitignore`、无 `predev`/`prebuild` 钩子；新克隆/部署不会自动有模型，只会静默退回 BM25，阶段 3 的『public/models 存在』验收需要先手工跑 fetch。`ALP_E2E_LLM_*` 只被 `scripts/probe-external.ts` 和文档引用，不是应用默认配置（我在 app/src 下 grep 无结果），所以『保存 ALP_E2E_LLM_*』只能是手工复制；`ALP_SECRET_KEY` 仍是服务端模式必需。
14. [中/vision 不支持模型验收] 阶段 6 要求『换成不支持图片的模型 → 明确提示该模型不支持图片』，但当前可用端点经探测是支持 vision 的，ADR 没给第二个已知不支持的模型或 mock 的 400 分支；不同供应商的 400 文案不一致，靠文案匹配很脆。需要 mock-provider 的 `/vision/v1` 400 档 + 明确错误码/映射测试，否则这条验收无法本机执行。
15. [中/人格重构可能丢安全规则] 阶段 5 用 `tutorPersona` 替换 `app/tutor/page.tsx:150-163` 的 SYSTEM_PROMPT，但 ADR 只列了身份/语气/ANSWER_SHAPE/禁语/不确定协议，没有说明保留现有 12 条规则（引用、上传资料 [资料n]、网络检索未核对、不得编造页码等）。`tutor-logic.test.ts` 只有 30 条；若 persona 改漏，现有安全口径会回退。需要把 12 条作为 BASE_RULES 并加回归。
16. [低/GSAP 描述不准确] `app/settings/page.tsx:4` 与 `src/components/secret-config-form.tsx:18` 已经 import gsap，『GSAP 只上 /』作为现状描述不准确；应改成『本轮新增动效只加在 /，settings 既有 GSAP 只做抽取』。
17. [低/bundle 余量风险] `/tutor` 只有 11.0KB 余量（实测 243.1/254.1），阶段 1/5/6 都要改 tutor 客户端代码；阶段 5+6 合计超预算的风险没有量化，建议每个阶段后单独 build+check，而不是只在阶段末。

### 建议

1. 把工作流拆成至少三段：A 契约/模型通道 + Agent；B 向量存储 + 本地嵌入 + RAG 评测；C 人格/多模态/动效。每段单独 verify + build + check:bundle，阶段 1 的契约先冻结。
2. 阶段 3 之前用一次性 Neon 分支和脚本实跑 `CREATE EXTENSION vector`、`CREATE TABLE/INDEX`、`$1::vector` 与 `<=>`，把命令和输出写进验收；任一步失败就删除 pgvector/HNSW 路径，保留应用层向量与 BM25，不要保留一个依赖外部 DDL 的默认路径。
3. 增加 `scripts/migrate-schema.ts`/`npm run db:migrate`，用非事务方式执行 `CREATE EXTENSION` 与空表上的普通 `CREATE INDEX`；HNSW 开关改用显式事务内的 `SET`，或本轮直接不启用 HNSW。`migrate-vector.ts` 开头加载 `.env.local`，并打印连接目标（host/db）与 pending 数，避免内存库假通过。
4. 本地嵌入必须在客户端上传前计算并放进 `kbPut.chunks[].embedding`（`apiContracts.ts:289-291` 已支持），或在服务端加一个可用的本地嵌入器；双写 `kb_chunk_vectors` 要 best-effort（表缺失/扩展失败只记 notice，不阻断上传），并补 800×512 满规模 PUT 用例与 8MB 上限处理。
5. 阶段 4 增加 Node 可执行的向量生成脚本（或明确用浏览器导出 vectors JSON），否则删除向量臂、只保留 BM25/无检索作为下界；验收命令分开写 `--mode bm25`、`--mode vector`、`--mode hybrid`，并同步调整 `EXPECTED_TOTAL`/分类计数。
6. MCP v1 先做代码级 per-server/per-tool allowlist（或每次调用人工确认），不要依赖 annotations 判断只读；tool description/inputSchema 按不可信数据处理（长度上限、去指令、明确告知模型），并在系统提示中声明工具参数不得携带其他工具返回的用户数据。
7. 为 `/api/agent`、`/api/kb/similar` 明确 `requireApiUser` + `assertMutationOrigin`、user_id 只取会话、方向/模型来自服务端或经校验的 query 参数，并加简单限流；`mcp_servers` 增加 auth header 名/格式字段，明确密文存 JSON。
8. 所有阶段验收改成 `npm run build && npm run check:bundle`；阶段 2 的手工 `/tutor` 轨迹验收移到阶段 6，阶段 2 用 curl/SSE 逐步事件测试；`mcp-smoke` 的 16/16 改成实际 18/18 并补 3211 启动命令。阶段 7 的 tutor smooth-scroll 修复移到阶段 6，或允许阶段 7 编辑一次 tutor 页。
9. 在 `predev`/`prebuild` 里加入 `scripts/fetch-model.mjs`（或把模型资产纳入部署流程），并给『模型未就绪』一个明确 UI 状态；`ALP_E2E_LLM_*` 的复制步骤写进验收，不要暗示应用会自动读取。
10. 阶段 6 用 `scripts/mock-provider.ts` 增加 `/vision/v1` 返回 400（模型不支持图片）档，配合现有 `/tools/v1`、`/vision/v1` 做可重复验收；`tutorPersona` 增加 BASE_RULES，把现有 12 条提示词规则逐条保留并加测试。
