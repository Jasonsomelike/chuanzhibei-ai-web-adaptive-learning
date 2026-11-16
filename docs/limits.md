# 已知限制与边界

## 当前状态（2026-11-16 更新）

- **知识库一致性**：文档与全部片段的写入 / 删除已是单一数据库事务；`db/migrations/0005_kb_tombstones.sql` 增加删除墓碑，跨设备删除不会被旧设备的在途上传复活。下方 2026-11-04 记录里的「文档与全部片段仍不是同一事务」已过时。
- **服务端 OCR**：登录后的文档解析已包含 PDF / 扫描件 OCR（tesseract 中英模型随部署打包，见 [文档与时长编排](document-and-time-orchestration.md)）；匿名路径与浏览器侧仍不 OCR。
- **限流**：search / tts / llm-chat / agent / kb 写入 / kb-vectors / kb-similar / documents 已有进程内按 IP 的固定窗口限流（429 + Retry-After）；多实例或 serverless 部署仍需平台 / 反向代理层做分布式限流。
- **规模与静态检查**：11 个页面 + 25 个 API 路由；`npm run lint` 0 告警（原 43 条清零）。

## 当前状态（2026-11-04）

最新实现与验收以 [改进记录](improvements-2026-11-04.md) 为准。原始记录中的以下缺口已经变化：

- 第 12 / 19 条：当前 verify、密钥扫描、生产构建均通过；CI 工作流已增加浏览器流程，远端执行尚待推送验证。
- 第 20 条：KB 文档写入增加原子版本条件，同版本并发只能一位成功；文档与全部片段仍不是同一事务（2026-11-16 已改为同一事务并加删除墓碑，见上方更新）。
- 第 22 条：待同步标记持久化，本地修改不会被远端旧版遮住；读取按文档选择完整片段。
- 第 24 条：账号清理等待完成后再开放新账号读取，阻塞时保留隔离标记，旧账号存储实例失效。
- 第 25 条：搜索与语音已有体积限制，本轮又补齐方向、题目与进度的解析前限制；全站分布式限流仍未实现（已有进程内按 IP 限流，见上方更新）。
- hard 集已增加片段级查询、nDCG@10、recall@20 与配对 bootstrap；集规模较小，向量 / RRF 臂及真实学习收益未验证。

仍然保留的主要边界：跨设备删除无 tombstone、KB 整单缺少事务、纯本机资料未进入服务端 Agent、真实第三方 MCP / TTS / Neon 向量链路未重测。教师管理与真实学生效果验证属于后续扩展。

**以下是 2026-10-30 的历史缺口审计，不能直接作为当前缺陷清单。**

> 本文的「本轮」指 2026-10-30 这一轮实跑；更早一轮的结果会明确标注「上一轮」或「2026-10-29」。

## 现状与缺口

先列能证明的能力，再列 30 条上一轮边界、7 条本轮新增缺口（已修复的条目在文内标注）与各自的原因、修法；「不可宣称」的部分也写在这里。

## 已验证能力

- 9 学科图谱与题库规模一致：`npm run kg:validate` → 0 error（360 点 / 540 边 / 1080 题）。
- 掌握度、排序、装包、指纹、检索、混合检索、题目校验、知识口径、数据库双实现、方向题目接口语义、记忆、校准、切块、引用核对、SSE 解析、搜索、TTS、密钥加密、SSRF、同源校验、KB / 记忆卡同步语义、手动路径存档，以及本轮的 Agent 状态机、工具调用、MCP 客户端 / 配置、512 维向量读写、本地嵌入降级、图片压缩与语音输入：`npm run test` → **1996 passed / 94 files**（本轮实测）。
- 主流程、认证与市场、MCP 协议：`auth-smoke` **34/34**、`mcp-smoke` **18/18** 本轮在内存库上实跑；`smoke.ts` 53/53 为上一轮结果，本轮未重跑。新增能力仍未进 `smoke.ts`。
- 生产构建：`npm run build` exit 0（28 个路由 = 9 页面 + 18 API + `_not-found`）；`npm run typecheck` exit 0；`npm run lint` 0 error / 29 warning。
- 5 套配色 210 对对比度：0 失败（上一轮实测；本轮未重跑）。
- 密钥扫描：`npm run check:secrets` 扫 309 个文件，发现 3 处疑似密钥，exit 1（本轮实测）。三处都是新增测试里的 `fake-*` 占位符，不是真实凭据；但扫描器按仓库规则一视同仁，`npm run verify` 因此当前为红（见第 19 条）。
- 导师回答规则评测：`npx tsx scripts/eval-tutor.ts --judge rules` → 10 条全部产出 8 维分数，硬门 R1≥1 / R5=2 / R7=2 全过，exit 0（本轮实测）。
- 检索评测：`npm run eval:rag` → recall@3 1.000、MRR@10 1.000、goldPhrase 1.000、OOD empty 1.000、unanswerableEmpty 0.500；混合检索打印「未测」（本轮实测）。

## 一轮独立审读发现并已修复的问题

这些是代码层面的真实缺陷，不是文案问题。**覆盖情况按行标注**：标「单测」的有纯函数用例，
标「E2E」的由 `scripts/smoke.ts` 实测，标「脚本」的由独立脚本实跑（`scripts/mock-gen-check.ts`），
标「手测」的没有自动化用例、按界面操作核对，标「仅改文案」的没有测试（文案改动无法用测试表达）。

| 问题 | 根因 | 修复 |
| --- | --- | --- |
| 路径页点一次「上移」，回诊断页显示「没有可出的题」 | `recordPathEdit` 没传 graph，`progressOf` 回落到内置学科，给方向写出 c01–c40 掌握度 | `recordPathEdit` / `attemptedQuestionIds` / `attemptCount` 加可选 graph 参数；路径页传 `target.graph`；`learner.test.ts` 有回归用例，smoke 检查 localStorage 里不出现 `cNN` 式 id |
| 无 key 时「跳过这个知识点」点了没反应，页面永远到不了「诊断完成」 | `current?.kcId ?? gen.kind === "failed" ? ... : ""` 被解析成 `(a ?? b) ? c : d`，no-model 时取到空串 | 重写 `skipCurrentKc` 的取值与 `done` 判定；no-model 时一次性跳过所有缺题 KC（逐个跳过是把系统问题变成用户劳动） |
| 自定义方向第一个被测点是 depth 7 | `kcNeedingItems` 按 `graph.concepts` 数组顺序取，而关键词拼装按得分排序、LLM 提示词也不要求拓扑序 | 三处一起改：`kcNeedingItems` 按深度排序、`composeFromExisting` 用 `topologicalOrder`、提示词加第 7 条要求 concepts 按先修顺序 |
| 答案对不上的题仍展示，学生选对却被判错 | L3 失败降级成 practice，`answerIndex` 兜底 0，诊断按选项 A 判分 | L3 失败改为 `rejected`（答案不可知就不展示）；practice 只由 L4 产生，此时答案文本是确定的 |
| Postgres 上 `run()` 恒返回 0，插入成功却报失败 | neon 驱动默认只返回行数组，INSERT 无 RETURNING 时是 `[]` | 改用 `fullResults: true` 取 `rowCount`；新增 `items-route.test.ts` 用「run 恒返回 0」的假 Db 锁住调用方语义 |
| 手动题被打了 0.8 折，README 却写 1.0 | 用 `id.startsWith("di-")` 判断生成题，而 manual 题的 id 也是 `di-` | 改按落库的 `source` 字段判断 |
| 手动改写后改预算不重算，指纹不反映显示顺序 | `displayed = manualSteps ?? plan.steps`，预算只重算 plan | 只存 kcId 顺序，用 `applyManualOrder` 把顺序重放到新 plan 上；面板并列「算法路径指纹」与「当前显示顺序指纹」 |
| `CONFIDENCE_SD_THRESHOLD` 全仓库无引用，README 却说 sd 是内部判据 | `hasEnoughEvidence` 只看 evidenceN | 判据改为 `evidenceN >= target && sd <= 0.20`；并写清「停测只看条数、标注才看 sd」两个不同用途 |
| 无 key 的 fallback 把无关知识点说成相关 | 命中不足 5 个时补基础点，描述仍写「与 X 相关的 N 个知识点」 | 补点时描述改为「其中 N 个直接相关，其余是基础知识点」 |
| 首页「全部达到 WCAG AAA」夸大 | 实算最低 3.26:1（分隔线，非文本元素） | 改为「正文与次要文字 AAA，非文本元素 AA」 |
| 仓库里硬编码了真实手机号与邮箱 | smoke 用它做隐私比对 | 改为正则匹配「像手机号/像邮箱」的串，仓库不再存真实值 |
| 「强制带 [kcId] 引用」只是提示词要求 | 界面把检索到的 docs 全部列为引用 | 新增 `extractCitedKcIds`：只列回复里真的出现、且确实在检索结果里的 id |
| 「拖动步骤」文案与实现不符 | 实现是 ↑ / ↓ / × 按钮 | 改文案，首页/路径页/关于页三处一并修（仅改文案） |
| 「移除」是空操作，被删的步骤又回到末尾 | `applyManualOrder` 只从 order 里删 kcId，第二个循环又把 plan 里「不在 order」的它追加回来 | 手写状态改为 `ManualEdit{order, removed}`；`removed` 里的点重放时排除。单测 3 条 + smoke「移除真的减少一步且不再回来」 |
| 点一次「上移」，整条路径都标「已手动调整」 | `applyManualOrder` 给 order 里每个点都写 `source: "manual"` | 不再改写 source；新增 `movedKcIds` 比较相对次序，只标真的换了位置的点。单测 4 条 + smoke「只标记真的挪动过的步骤」 |
| 有题但不够门槛时空白死锁 | `pickNext` 无题可出、`kcNeedingItems` 只认 `accepted === 0`、`canPickMore` 说还有工作 → 三张卡都不渲染 | `kcNeedingItems` 改判 `accepted < 门槛`；新增「题目不够」卡，给「再生成一批 / 手动补题 / 跳过 / 只规划路径」四个出口；跳过改为批量。smoke「题不够门槛时给出明确出口」 |
| 无 key 降级丢掉真正命中的知识点 | 补基础点时用 `scored.slice(0, N)` 按图谱顺序取，命中的 c34 被挤出前 5 | 先放 `picked` 再补基础点；单测 2 条锁「命中的点必须保留」「声称的相关数不多于实际」 |
| 「证据不足」提示与判据矛盾（n=3 却写「未达 3 题门槛」） | 文案只提条数，而判据是「条数 ∧ sd」 | `MasteryBar` 的 `evidenceShortfall` 拆成 `count` / `precision` 两种文案；后者说明「题数够了但对错分裂」 |
| 服务端信任客户端的 `source` | `source` 决定折扣（generated 0.8、manual 1.0），却完全由客户端声明 | manual 必须不带 `difficultyReason`（那是生成流程的字段）；borrowed 必须能被服务端用 `borrowItems` 复算出同一题干；其余按 generated。单测 2 条 |
| `borrowed` 是不可达的 source | 类型里有、README 折扣表里有，但没有任何代码会产生它 | 实现 `src/lib/borrow.ts` 的 `borrowItems`：按 KC 名称从内置题库借用同名知识点的题；单测 6 条 |
| L5 的 notes 从未落库 | `checkItem` 算了 notes，但 payload 没带 | notes 并入 `checks`（前缀「提示：」）落库；「已通过 N 项校验」不计提示项 |
| **真实缺口 4（上一版）：路径页只能按整科规划，不能按章 / 按目标点收窄** | `/path` 没有把章节选择传给 `planPath`，`targets` 只在 MCP 与库函数里可用；`inputHash` 也没有体现章节范围 | 路径页新增 `ChapterGoals`（`src/components/chapter-goals.tsx:14`）：`chaptersOf` 按章号聚合、支持多选，`chapterScope` 把选中章节展开成 targets + 跨章先修点（`src/lib/chapters.ts:103`），**图谱始终完整**；`targets` 同时传给 `planPath` 与 `computeInputHash`（`src/lib/plan.ts:283`），换章节会改变输入指纹。覆盖：单测 `chapters.test.ts` 13 条 + `planDiff.test.ts` 6 条；路径页多选 / 全选 / 清空为手测 |
| **反事实只显示「因时间不足被推迟」，对照预算下的 blocked 点不出现** | 页面直接读 `PlanResult.deferred`，没有 `blocked` 汇总；阻塞点既不在推迟数里，也没有逐条原因 | 新增 `summarizeCounterfactual`（`src/lib/planDiff.ts:31`），把 `deferred` / `blocked` / `blockedNotInPath` 分开，`blockedByOf` 给每个点列出阻塞者；步骤卡按当前显示路径判断「是否已在路径上」。覆盖：单测 `planDiff.test.ts` 6 条；路径页对照预算为手测 |
| **「重新诊断」把掌握度一起清空，用户只想重测却丢了进度** | 重新诊断与清空进度共用一个 `reset`，都调用 `resetSubject`；`gen` 状态也没归零，失败卡会立刻重现 | 拆成 `restartSession`（清会话状态、保留 learner 与掌握度）与 `clearAll`（二次确认后 `resetSubject`，再重置会话）；`resetSubject` 的注释写明只供清空使用（`src/lib/useLearner.ts:405-412`）。覆盖：手测诊断页两个按钮（状态在页面组件里，没有单测） |
| **L4 双解按数组顺序取答案，模型换个返回顺序就整批降级 practice** | `solveBatch` 直接 `parsed.answers.map(...)`；两次批解是 `Promise.all` 并发的，数组顺序与题号没有约定 | 新增 `parseSolverAnswers`（`src/lib/itemgen.ts:365`）按 1-based `index` 落槽：缺失留空、重复取最后一条、越界丢弃并记 issue；`solveBatch` 返回 `{ordered, missing, issues}`（`src/lib/directionItems.ts:290`、`:313`）。覆盖：单测 `itemgen.test.ts` 5 条 + `scripts/mock-gen-check.ts` 的 shuffle 档与「按数组顺序取必全错」哨兵 |
| **内存库 DELETE 不看 WHERE，一律按 (user_id, subject_id) 删并返回 1** | 两种删除形状（清空某用户全部 / 只删一个学科）共用一条路径；按 user_id 清空时行还在、返回值却是 1，界面表现为「点了清空，刷新又回来」 | `src/lib/db.ts:383` 按 WHERE 是否含 `subject_id` 分两种形状，返回真实删除行数；不存在的键返回 0。覆盖：单测 `src/lib/db.test.ts:162-206` 3 条 |
| **plan 的「与 LLM 无关」用例是恒真断言** | 同一份输入跑两次再比较，永远相等；没有换掉外部状态 | 把 `fetch` / `Math.random` / `Date.now` 全换成「一调用就抛」，要求输出逐位不变（`src/lib/plan.test.ts:137-168`）。**关于模型版本只能说结构上到不了**：`PlanInput` 没有 `modelVersion` 字段，`canonicalPlanJson` 也只序列化 `steps + algoVersion + kgVersion`，多传的模型字段会被丢弃——所以「两个 modelVersion 同 hash」不可能失败，它不是证据。覆盖：单测 |
| **推理模型第一次测连通性必红** | 探活请求只给 `max_tokens: 16`，而推理模型的思考 token 也计入这个预算：实测 deepseek-v4.1-flash 把 16 token 全用在 reasoning_content 上，`content` 为空、`finish_reason=length`，于是被判定为「响应异常」。用户会以为地址或密钥填错 | 探活预算提到 64；并把「200 + 合法响应体 + `finish_reason=length` + 正文为空」判为**连通**（端点、密钥、模型名都已验证），只对 `stop` 且正文为空才报响应异常（`src/lib/provider.ts` 的 `buildRequest` 与 `testConnection`）。覆盖：单测 `provider.test.ts` 2 条 + ego 真实模型实测（一次点击即绿） |
| **自定义方向生成被截断后静默退化成规则拼装** | `useDirectionDraft` 只给 2000 token，推理模型把预算吃光 → `ChatError(truncated)` → catch 里直接走 `generateFallback`：用户要「图论」，拿到的是「从数据结构里挑了 18 个树/图知识点」，来源标注还是「从现有学科挑选」 | 首次给 4096，遇截断再加倍到 8192 重试一次（截断可恢复，直接降级才是浪费）；方向页的失败提示也从「N 个知识点生成失败：名字」改成带上去重后的真实原因（实测里 46 次调用全 200、落了 52 题，失败其实是没到 4 题门槛）。覆盖：ego 真实模型实测（同一句描述，修复后 `模型生成`、14 个知识点） |
| **生成链路只有单测，没有跨模块集成检查** | `ensureItems`、L1–L5、落库回显、依据标注各自有单测，但没人把「真实 ensureItems + 模型响应 + 服务端回显」串起来跑 | 新增可控 Mock 供应商 `scripts/mock-provider.ts` 与集成脚本 `scripts/mock-gen-check.ts`：正常 / 数组倒序 / 双解不一致降级 / 截断 / 坏 JSON / 同批重复题干六种场景，共 19 项检查；上一轮又加了 `/stream` 与 `/think400` 两档供手测。覆盖：脚本 19 项全 PASS（上一轮实跑，exit 0；本轮未重跑） |

## 真实缺口与已修复项

1. **教师班级视图未实现。** 现在只有「一个学生一份进度」，没有班级聚合、没有「谁卡在哪」的视图。这是产品叙事里最大的一块空白。
2. **4 个新学科未经学科专家复核。** 离散数学、机器学习基础、概率论与数理统计、学术英语写作的题目由模型生成后经脚本校验（题数、无环、难度分布、解析长度），但没有任课教师逐题核对。9 个学科共 1080 题的难度标注都需要教师确认。
3. **没有真实学生数据。** 所有掌握度数字来自自测与构造的快照，不是教学现场采集。
4. **手动改写已持久化（上一轮修复）。** 顺序与被移除集合按目标存进 `localStorage`（键 `alp.path.manual.v1`，`src/lib/manualPath.ts:16`）；路径页挂载时读回（`app/path/page.tsx:191`），每次改动经 `applyManualEdit` 写回（`:316`）。存档是不可信输入：JSON 坏、版本不符或字段形状不对一律返回 `null`，界面回落算法顺序。`recordPathEdit` 仍单独记录 `pathEdits` 审计（`src/lib/learner.ts:233`）。
5. **未做 Lighthouse / Core Web Vitals 实测。** 没有 LCP / INP / CLS 数字。
6. **浏览器直连供应商仍受 CORS / 混合内容约束，但只在 local 模式。** server 模式由 `/api/llm/chat`、`/api/search`、`/api/tts` 代发，不受浏览器 CORS 限制；local 模式仍可能出现跨域失败，设置页会就地提示。服务端代发要求部署方持有 `ALP_SECRET_KEY`，否则只能保存失败（不会明文落库）。
7. **自定义方向的题目依赖模型，但不是完全不可诊断。** 无 key 时不会自动生成新题；仍可**手动录题**后诊断（`/directions` 的「手动录题」，E2E 覆盖），或只规划路径。生成题的成本数字（¥0.0009–0.0066/题）是调研值，本机没有可用 key，未复测。
8. **L4 双解与 L6 依据核对都只在浏览器侧做。** 服务端落库时重跑 L2/L3，不重跑 L4/L6（要再调模型，成本高且结论不可缓存）。恶意客户端可以把未过 L4 的题标成 accepted、把未过的 L6 结论改写成通过——在「用户自己的方向」场景下可接受，做教师共享题库时必须搬到服务端。
9. **`P(已掌握)` 只展示，不做停测准则。** 3 题全对后 P 最高 0.848，达不到 0.90；拿它当阈值会迫使题库扩到 4–5 题/KC。
10. **学科规模固定为 40 点 / 60 边 / 120 题。** 这是由「3 题可达证据充分」反推的约束，新增学科必须遵守；规模不同的学科需要重新校准参数。
11. **方向删除后遗留的进度行、账号知识库行与本机知识库不清理。** 进度按方向 UUID 存在 `progress.subject_id`，方向删了行还在；`kb_docs` / `kb_chunks` 与 IndexedDB 里的 `docs` / `chunks` 同样按旧 `directionId` 留存。不影响功能（UUID 不复用），只占空间；要做清理需要级联删除或 tombstone，上一轮没做。
12. **CI 已配置，但当前为红。** 仓库已有 `.github/workflows/ci.yml`（typecheck → lint → test → kg:validate → check:secrets → build），不再靠纯手工串跑；但 `check:secrets` 本轮在新测试文件里报 3 处 `fake-*` 占位符（第 19 条），CI 会在该步失败。修法是把这些占位符改成非凭据形状（例如 `placeholder-…` 且长度 < 16），不是放宽扫描器。
13. **界面文案与实现不符的六处已在上一轮全部修正**（不再是缺口，列在此处便于核对改了什么）：
    - `app/page.tsx` 的「CI 会红」→「`npm test` 里的 golden 字面量会失败」；
    - `app/page.tsx` 的 `src/lib/llm.ts` → `app/tutor/page.tsx · 引用从回复里解析`；
    - `app/page.tsx` 的「Ollama 预设」→「DeepSeek / OpenAI / Claude / 通义 / Kimi / 智谱 预设」；
    - `app/path/page.tsx` 与 `app/about/page.tsx` 的「拖动步骤」→「↑ / ↓ 调整顺序」；
    - 首页「全部达到 WCAG AAA」→「正文与次要文字 AAA、非文本元素 AA」；
    - 首页「正文对比度最低 15.5:1」→「15.50:1」（实测 forest/light）。

    修正后 `grep -rn "CI 会红\|llm\.ts\|Ollama 预设\|拖动" app/` 无命中。
14. **`.env.example` 列出的 `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` 不被应用代码读取（模板里已就地标注）。** `DEEPSEEK_API_KEY` 只被 `scripts/probe-external.ts` 用来做真机探测（且要求 base_url 是官方域）；应用侧供应商配置走 `/settings` → `/api/config`（server）或浏览器 `localStorage`（local）。应用实际读取的变量是 `DATABASE_URL`、`ALP_SECRET_KEY`、`ALP_SECRET_KEY_ID`、`ALP_EMBED_*`、`ALP_AGENT_*`、`ALP_MAX_KB_*`、`ALP_ALLOW_HTTP_PROVIDER_HOSTS`、`ALP_ALLOW_MEMORY_SECRETS`、`HEALTH_TOKEN`；`DATABASE_URL` 与 `HEALTH_TOKEN` 已写进 `.env.example`。
15. **方向页的「生成全部题目」已带资料上下文（不再是缺口）。** `ensureAllItems` 现在接收 `material` 与 `uploadedPack`，两个入口都走 `materialForConcept`；L6 开关会透传到每个 `ensureItems`。此前「只有诊断页懒生成会传」的描述已删除。
16. **「依据：」与「依据核对」都是客户端声明，服务端无法复算。** `app/api/directions/items/route.ts` 不加载资料包（笔记只在 localStorage，上传资料虽同步到 `kb_chunks`，但 items 路由不读），所以只按白名单前缀放行并原样落库；公开方向的题目对匿名访问者可读，等于「作者声明的出处与核对结论」。它们不参与判分与证据计数（`status` 仍由客户端显式 `practice` 保留），但做教师共享题库前必须搬到服务端。
17. **教材 / 讲义存储不分账号。** 存的是浏览器级键，登录时比对 `alp.materials.owner` 来清空上一位用户的存档；同一浏览器多账号快速切换仍可能在一次渲染内看到旧值（已挂载面板靠事件重读）。
18. **`restartSession` 没有自动化回归。** 拆成「重开会话」与「清空进度」这件事只做了手测：状态在页面组件里，仓库没有组件测试环境（`vitest.config.ts` 只跑 `src/**/*.test.ts`，环境为 node）。上一轮新增的组件测试也只测纯函数与文案（`calibration-card`、`knowledge-upload`、`memory-review`、`tutor-logic`），不做 DOM 渲染。
19. **`npm run check:secrets` 本轮为红（3 处测试占位符）。** 命中的是 `src/lib/agent-route.test.ts:85`、`src/lib/mcpServers-route.test.ts:28`、`src/lib/mcpStore.test.ts:33` 里的赋值常量（`fake-*` 形状）。它们不是真实凭据，但扫描器按规则报错并以退出码 1 结束，`npm run verify` 因此失败。修法是把值改成不带 `KEY` / `TOKEN` 变量名的非凭据形状，断言不变；不要为了变绿降低扫描规则。
20. **KB 的 CAS 不是事务。** `putKbDocument` 先 `SELECT` 再 `INSERT`（`src/lib/kbServer.ts:417`），两个并发 PUT 使用同一个 `baseUpdatedAt` 时可能都通过检查，双方都收到 200，后写者覆盖。要消除窗口需要条件 `UPDATE ... WHERE updated_at = $base` 或 `SELECT ... FOR UPDATE`，当前未实现。承诺只是「单设备顺序操作与常规重试下结果确定」，不是任意并发下的线性化。
21. **删除没有 tombstone。** KB 的 `DELETE` 无版本前置条件，永远生效；A 删除后 B 的在途 `PUT`（`baseUpdatedAt: null`）会让文档复活。记忆卡同理：`PUT` 永不删行，旧设备快照不会让卡消失。要禁止复活需要 tombstone 表，上一轮不做。
22. **`mergeDocs` 用远端覆盖本地，不比较版本**（`src/lib/kbRemote.ts:423`）。本地有一次尚未成功上传的修改时，下一次读会显示远端旧副本，本地新内容被遮住——这是上一轮唯一会**丢用户可见修改**的读路径。修法是按 id 比较 `updatedAt` 取大者，未实现。
23. **记忆卡单卡删除没有接线。** `memoryClient.deleteMemory`（`src/lib/memoryClient.ts:94`）没有调用方；界面移除一张卡后只靠 `pushMemories` 快照同步，而 `PUT /api/memories` 永不删行，下一次 `pullMemories` 会把这张卡复活。只有「清空学科」走了显式 `clearMemories`。
24. **账号级存储实例不回收，换号清理不等待完成。** `syncedStorages` 按 userId 缓存复合存储（`src/lib/kbRemote.ts:814`），登出/换号不清（只有测试用的 `__resetKbStorageCacheForTests`）；`applyAccountTransition` 用 `void clearKbDatabase()`（`src/lib/authStore.ts:186`），另一个标签页仍持连接时，新账号可能短暂读到上一位用户的文档。正确做法是 `await` 删除或在删除完成前禁用 KB 读取。
25. **没有自建限流，两个路由没有请求体上限。** `/api/search` 与 `/api/tts` 直接 `request.json()`，没有 `readLimitedText`；搜索成功响应也没有字节上限。登录用户可以无限调用代发与最大 32 MiB 的 `/api/kb` PUT（`ALP_MAX_KB_BYTES` 可调）；新增的 `/api/agent`、`/api/kb/vectors`、`/api/kb/similar` 有请求体上限但没有速率限制。线上必须在反向代理层限流 / 限体积。
26. **域外门控已加（上一轮修复）。** `search()` 在按 k 截断之前对完整候选跑 `passesRelevanceGate`（`src/lib/rag.ts:138-163`，调用点 `:217`）：查询里必须有至少一个「非疑问词、且语料真实存在」的主题词出现在 top1——标题命中直接放行；正文命中时再排除虚词开头的跨词 bigram（如「…的路…」）。上一轮 `npm run eval:rag` 的 `outOfDomainEmpty` 为 `1.000`（10/10），falseContext 为 0，answer-absent 的 relatedHit 保持 `1.000`（10/10）。门控只覆盖内置知识点检索，上传资料的混合检索仍未测（第 27 条）。
27. **内置知识点仍只走纯 BM25，混合检索只在生产里接上传资料。** 导师页的知识点检索先 `buildIndex(target.graph.concepts)`（`app/tutor/page.tsx:801`），查询用 `search(index, question, 3)`（`:1280`），只有上传片段走 `embedLocalQuery` + `POST /api/kb/similar` + RRF（`:875-1000`）。50 条评测针对的是 `kbDocuments`，且已饱和（answerable 的 recall 全 1.000），所以它既不能证明上传资料的混合检索，也不能证明「向量/RRF 提升」。
28. **契约里的 `search_exhausted` / `tts_unavailable` 没有路由产出，错误体有两种形状。** `/api/config`、`/api/llm/*`、`/api/kb`、`/api/memories` 回 `{error:{code,message}}`；`/api/search`、`/api/tts` 回 `{error,code}`。客户端必须按路由选解析器（`serverConfig.errorOf` 是现成实现）；新增客户端不应假设统一。
29. **主密钥只能有一把。** `resolveSecretKey` 只读 `ALP_SECRET_KEY` / `ALP_SECRET_KEY_ID`，轮换后旧行统一报 `KEY_KID_UNKNOWN`，必须让所有用户重存一次；没有「新旧密钥并存、逐行迁移」的自动路径。`HEALTH_TOKEN` 的详细健康检查已实现，并已写进 `.env.example`。
30. **`/api/kb` PUT 没有 `maxDuration`。** 路由未声明函数时限，而单次请求仍可能携带 32 MiB 上限内的大文档与全部片段；在默认时限较短的平台上，大文档可能被平台超时截断，而不是返回 4xx。向量不再随 PUT 生成（512 维走 `/api/kb/vectors`），所以原先的 25 秒补向量预算已不存在；剩下的风险是正文与片段体积本身。

## 本轮真实缺口（2026-10-30）

这七条是 ADR-0002 能力升级落地后仍然存在、且会影响演示或评估口径的缺口；不写成「已解决」。

1. **浏览器本地模型首次使用要下载约 22.8MB 权重。** `bge-small-zh-v1.5` q8 的 `model_quantized.onnx` 为 24,010,842 B（约 22.8MiB），另有推理运行时文件；网络慢时首次提问会先等到 15s 查询嵌入超时，然后本次退回 BM25。当前没有下载进度条，只有设置页的「文件是否存在 / 自检」；修法是预取 + 进度提示 + 失败后明确写「本次未使用语义检索」，而不是把超时藏起来。
2. **Anthropic 协议不支持工具。** `/api/agent` 对 `kind=anthropic` 不发 `tools`，只发一条「当前供应商未启用工具调用」的 notice，然后按普通问答跑。原因是本轮没有实现 Anthropic `tool_use` / `input_json_delta` 的流式解析；这是明确的不做项，不是模型能力问题。
3. **local（BYOK）模式没有工具循环。** `/api/agent` 只认账号里保存的服务端模型配置；local 模式在界面上直接禁用智能体开关并提示切到服务端模式。MCP 传输必须走服务端的 `guardedRequest`（钉 IP、防 SSRF），浏览器直连做不了这件事；所以这不是遗漏，而是安全边界。
4. **MCP 只支持 Streamable HTTP。** 客户端只实现 MCP 2025-06-18 的单端点 POST + JSON/SSE 双读，不支持 stdio，也不支持 2024-11-05 之前的 HTTP+SSE 双端点；会话终止没有 DELETE（v1 主动放弃），只靠 `notifications/cancelled` 与服务器会话过期。本轮也没有用真实第三方 MCP 服务器做端到端验证。
5. **向量只覆盖 512 维本地模型。** `kb_chunk_vectors` 的列固定为 `vector(512)`，只写 `bge-small-zh-v1.5-q8`；外部 1024 / 1536 维嵌入不会进入该表，也不参与 `POST /api/kb/similar`。内置知识点检索仍是纯 BM25；向量只接上传资料，且跨方向不共享索引。
6. **没有 rerank。** 融合层只有 RRF（k=60、每路 20、top3、余弦阈值 0.25），没有交叉编码器重排、query rewrite 或多轮检索；语义相近但字面不同的长尾仍可能排在 top3 之外，只能靠域外门控与引用核对兜底。
7. **评测硬集未做。** 现有 50 条评测的 answerable recall@3 / MRR / 金句都已 1.000，已饱和；chunk 级 hard 集（约 40 条、500 字切块）、四臂对照（无检索 / BM25 / 纯向量 / RRF）、nDCG@10、recall@20、词面覆盖率与配对 bootstrap 区间都还没有落地。因此「向量 / RRF 有收益」目前**没有证据**，不能写成效。

**本轮仍未验证的项**（有代码与单测，但没有真实环境证据）：

- `CREATE EXTENSION vector`、`$1::vector` 写入与 `<=>` 查询未在真实 Neon 分支执行；迁移脚本本身也只做过 dry-run / 单测，未对生产库跑过。
- 真实第三方 MCP 服务器的握手、工具发现与调用未实跑；只有本地 smoke 与假 transport 单测。
- 浏览器端本地嵌入的完整链路（模型下载 → Worker 推理 → `/api/kb/vectors` → `/api/kb/similar`）未在真实浏览器里端到端验证。
- 真实 TTS（OpenAI `speech` / mimo `chat-audio`）没有用真实凭据验证；只有单测、mock 与浏览器内置语音。
- PDF worker 的浏览器侧未验证（`scripts/pdf-smoke.ts` 未跑）。
- Lighthouse / Core Web Vitals 没有实测数字（LCP / INP / CLS 均未采集）。

## 本轮新增能力的边界（2026-10-30）

**Agent 与工具**

- 智能体只在服务端模式可用；工具全部只读（5 个本地 + 用户 MCP 白名单），没有写工具、没有创建 / 修改方向、没有触发作答。
- 默认上限 8 步 / 5 并行 / 20s 单工具 / 4000 字符单结果 / 180s 全会话，可被 `ALP_AGENT_*` 调大，但没有后台队列：请求断开或超时即收口。
- 轨迹只存在当前会话（≤300 字 preview），不落库、不写 localStorage；刷新即失。
- Anthropic 不发 tools；local 模式没有工具循环（见上文第 2、3 条）。

**MCP**

- 只有 Streamable HTTP；不支持 stdio / 旧 HTTP+SSE；没有会话 DELETE。
- 每用户最多 20 个服务器、每个最多 50 条工具白名单、一次 run 最多加载 5 个服务器 / 24 个工具；发现阶段 30s 超时后其余服务器本次不加载。
- 服务器 URL、鉴权头与工具白名单都由用户配置；地址必须能通过 SSRF 形状 / DNS / 钉 IP 校验，本地 `http://` 必须显式进 `ALP_ALLOW_HTTP_PROVIDER_HOSTS`。

**向量库**

- 只承载 512 维本地模型；外部 1024 / 1536 维不写入 `kb_chunk_vectors`。
- 默认精确扫描，不启用 HNSW；默认 50,000 段 / 方向的上限下这是有意的取舍，不是「已做 ANN」。
- 向量只用于上传资料召回；内置知识点仍走 BM25；没有 rerank、query rewrite、多轮检索。
- 本地模型资产在 `public/`，不在 Next bundle；首次使用要下载约 22.8MB 权重，缺失时降级 BM25。

**多模态**

- 图片只支持 jpeg / png / webp / gif，最多 3 张，单张压缩后 ≤400KB；只接受 data URI，不落库；Anthropic 协议在界面上直接拒绝图片。
- 语音输入只用 Web Speech API，不做服务端 ASR、不上传音频、不连续识别、不自动发送；Chrome 的识别由浏览器厂商服务完成，音频可能离开本机。
- 匿名路径与浏览器侧不做 OCR（登录后的文档解析走服务端 OCR）；不做视频输入；浏览器侧 PDF 仍只抽文本层。

## 上一轮新增能力的边界（2026-10-29）

**文件与知识库**

- **不做 OCR。** 扫描件 PDF 没有文本层时整份拒绝，提示「请上传可复制文字的 PDF 或 Markdown/TXT」；不接 `tesseract` 或任何浏览器 OCR。PPT / DOCX 也不解析。
- **PDF 只抽文本层**：单份默认 ≤2000 页、≤64MB、正文 ≤100 万字；单方向默认 ≤50,000 段 / ≤1000 万字（`ALP_MAX_KB_*` 可收紧）。超过就整体拒绝，不导入半份。
- **知识库同步是账号级副本，不是协同编辑。** 未登录只写本机 IndexedDB（`alp-kb-v1`）；登录后本地先写、再 `PUT /api/kb` 到 `kb_docs` / `kb_chunks`，换设备登录同一账号能拿回。不随方向公开 / 复制，其他用户读不到；方向市场副本默认空库。换账号时 `planAccountTransition` 清本机知识库，登出也清空。远端失败不回滚本地，只显示 `syncWarning`；409 冲突文案固定为「文档已在其他设备更新，请刷新后重试」。
- **并发语义是文档级 LWW + 前置 CAS，片段随文档整体替换。** CAS 不是事务（见「真实缺口」第 20 条）；删除没有 tombstone（第 21 条）；`mergeDocs` 远端覆盖本地（第 22 条）。这些窗口都写清楚了，不承诺线性化。
- **未绑定知识点的上传文档只用于导师检索**，不进出题与 L6 核对；绑定后才会以「上传资料」章节进入资料包。
- 生产构建上一轮 exit 0；PDF worker 的浏览器侧仍未验证（`scripts/pdf-smoke.ts` 需要 Playwright Chromium 与 Next 服务，上一轮未跑）。

**记忆与校准**

- **记忆卡不是第二个掌握度。** 不做 FSRS 参数拟合、不给 α/β 乘时间衰减、不用 LLM 自动 ADD/UPDATE/DELETE 记忆；复习自评与易混标记都不进 α/β。
- **记忆卡独立成表，LWW 版本取 `max(lastSeenAt, createdAt)`。** `PUT /api/memories` 只 upsert，永不删除不在列表里的卡；删除必须显式 `DELETE`。设备时钟快的一方会赢，这是 LWW 的已知代价；单卡删除尚未接线（第 23 条）。
- 每学科最多 200 张；全为 open 时拒绝新增并显示 warning。`attempts` 本身没有上限，长期使用仍可能撞进度 JSON 的 512KB 上限（上一轮未解决）。
- **校准只做单目标内的弱校准。** 不做 ECE / BSS / 按知识点可靠性图 / 单学生 Platt 或 isotonic 曲线；`n < 30` 只说样本不足；不承诺 ±5pp，`n ≥ 100` 只在内置学科可达。校准样本只来自诊断作答。

**思考、联网与语音**

- **不做 debate / router / ReAct / 同模型第二 solver / 跨供应商核对。** 只做「生成者 + 只读核对者」，且核对者必须逐字引用原文；没有原文时不核对。
- 思考强度只作用于导师回答；出题、批解、方向生成始终非思考——`/api/llm/chat` 的请求体收 `purpose`，`items` / `verify` / `direction` 一律按关档发给上游（`app/api/llm/chat/route.ts:125-131`、`:227`）。server 模式的档位来自账号配置；旧客户端不传 `purpose` 时沿用账号档位，传了则按用途覆盖。OpenAI 官方 Chat Completions 不暴露原始推理正文，面板可能为空；端点拒绝思考参数时自动降级一次并把标准 / 深入置灰。
- **联网支持 DeepSeek / Tavily / 维基百科。** server 模式经 `/api/search` 代发，local 模式 Tavily / 维基百科浏览器直连；DeepSeek 搜索没有浏览器直连路径。服务端不静默换供应商，`search_exhausted` 未实现；网络来源始终标「未核对」，不进入教材命名空间，也不作为 L6 / 引用核对的依据。上一轮真机探测三端点均「未验证」（缺凭据），见 [§15](rag.md)。
- **TTS 在 server 模式下不再受浏览器 CORS 限制**：`/api/tts` 支持 `speech` 与 mimo `chat-audio` 两种协议；local 模式仍直连，失败自动回退浏览器语音。只朗读正文、单段最多 2000 字，不自动播放、不做逐字高亮 / 字幕同步；语音密钥与聊天密钥分开保存。
- **换账号会清本机存档。** `planAccountTransition` 对 A→B / A→匿名清空 learner、本机知识库、搜索 / 语音密钥与教材讲义；匿名→B 保留并登记归属；登出无条件清空并删除调用模式键（`src/lib/authStore.ts:177-218`、`:371`）。服务端账号里的配置不会因切换被删除。

**运行环境**

- **Node 20 不支持。** `pdfjs-dist@6.4.299` 要求 Node ≥22.13；要保留 Node 20 只能降级 `pdfjs-dist` 5.x 并重验 PDF worker，不在上一轮已验证范围。
- 上一轮新增的流式 / 思考、引用核对、联网、上传、记忆、校准、朗读、账号同步与 server 模式**没有进入 `smoke.ts`**；`auth-smoke` 覆盖了配置 401、KB 往返、记忆卡 LWW 与市场，但浏览器交互仍需手测（清单见下）。

## 浏览器手测清单（2026-10-30 新增能力）

以下交互没有自动化 DOM 回归，按界面操作核对；本轮未跑，保持未验证：

1. **Agent 工具循环**：服务端模式问「给我排一条 90 分钟的路径」→ 轨迹至少 `list_subjects` + `plan_path`，最终文本引用路径指纹；停掉 MCP 服务器 → notice「MCP 不可用」且本地工具仍完成。
2. **Agent 降级**：local 模式 / 未登录 → 开关禁用并提示；Anthropic → notice「未启用工具调用」；上游 500 → 清空半截正文并退回普通流式问答。
3. **MCP 配置**：保存 URL + 鉴权头 → 刷新只显示末 4 位掩码；白名单外工具不会被调用；未登录 / 内存库保存时给出明确失败原因。
4. **本地向量**：断网 + `public/models` 存在 → 上传资料检索状态显示「本地模型 + /api/kb/similar」；删掉模型目录 → 显示「本地向量不可用」并退回 BM25。
5. **pgvector**：在隔离 Neon 分支执行迁移 → `kb_chunk_vectors` 存在；写一条 512 维向量 → `/api/kb/similar` 返回该 chunk；未装扩展时其余表照建。
6. **图片**：只粘贴截图不写字也能发送；回答分【图中文字】/【解答】；换不支持图片的模型 → 明确提示并给「改为文字提问」；不静默去图重发。
7. **语音**：Chrome 允许麦克风 → 转写只填空、不自动发送；拒绝麦克风 / 非 HTTPS → 给出原因且不重试；不支持的浏览器按钮置灰。
8. **真实 TTS**：server 模式分别用 `speech` 与 mimo `chat-audio` 朗读；404 / 409 回退浏览器语音。**本轮未用真实凭据跑，保持未验证。**

## 浏览器手测清单（2026-10-29 新增能力）

单元测试覆盖纯函数与调用语义，下面这些交互按界面操作核对；没有自动化 DOM 回归：

1. **流式 + 思考**：mock `/stream/v1`；思考面板先出现，正文开始后自动折叠；点停止只保留已输出部分；400 降级后设置页显示「不支持」。
2. **思考强度**：三档分别发请求，抓包确认「关」没有 `reasoning_effort` / `thinking`；Anthropic 档没有 `temperature`。
3. **联网**：无 Tavily key 时用维基；有 key 时用 Tavily；断网 / 429 不阻塞回答；网络来源与教材来源分块显示。
4. **上传**：2 页中文 PDF → 段数 / 页码正确；纯图片 PDF → 明确报「无文本层」；GBK txt → 中文正常；换方向看不到；删除后 BM25 检索不到。
5. **记忆**：答错生成 1 张卡；同题再答错不新增；答对变 resolved；复习自评前后 Beta 数值不变。
6. **校准**：模拟 30 / 60 / 100 条作答（100 标注为模拟）；档位文案与 Wilson 区间一致；`n<30` 不出现「可信」；页面写明单方向最多约 80 题、不承诺 ±5pp。
7. **TTS**：浏览器 voice 可切换、可停止；OpenAI / SiliconFlow 端点可出声；CORS 失败回退并提示。
8. **方向名**：改名保存刷新仍在；空名 / 61 字被拒。
9. **配置往返**：保存 `thinking` / `thinkingStatus` / `verification`，刷新设置页与导师页仍读到；400 降级写回的 unsupported 也在。
10. **L6 整批**：一次生成 3–4 题只发 1 次核对；通过的题显示「依据核对」，未过降 practice，网络 / JSON 失败显示「依据核对：未完成」且仍 accepted；「已通过 N 项」不计未通过 / 未完成。
11. **quote 最小长度**：mock 返回 2–4 个常见字的 quote，必须判 `not_found`；返回 12+ 字真正原文才 `supported`。
12. **PDF worker**：`npm run build` 后 Network 里有 `pdf.worker` 资源，不是主线程 fake worker；若 404 按 public/ 或 `?url` 退化方案修。
13. **server 模式配置**：登录后保存 llm 配置 → 刷新只显示掩码；删除配置后提问，服务端回 404「还没有保存模型配置」，页面回退知识库拼装；未配 `ALP_SECRET_KEY` 时保存回 503 并提示联系部署者。
14. **知识库同步**：浏览器 A 上传 → 刷新 / 换浏览器 B 登录同一账号 → 文档与片段出现；B 改绑定后 A 再改同一文档 → A 收到「文档已在其他设备更新」；断网后上传仍成功但显示「仅显示本机资料」。
15. **记忆卡同步**：A 答错生成卡 → B 登录拉回；B 复习后 A 再同步，`lastSeenAt` 较新者胜出；清空学科后不再复活。
16. **搜索回退**：未登录选 DeepSeek → 显示「已改用维基百科（免密钥）」；server 模式未配 Tavily → 同样回退；配好之后响应 provider 与请求一致。
17. **TTS 两种协议**：server 模式分别用 `speech` 端点与 mimo `chat-audio` 端点朗读；404 / 409 回退浏览器语音并显示原因。

## 下一步

教师班级视图 → 4 个新学科的专家审题 → 真实课程小规模试用 → Lighthouse 实测与演示视频。工程侧优先清掉 `check:secrets` 的 3 个测试占位符（恢复 CI 绿），再补 chunk 级 hard 集与配对区间、在隔离 Neon 分支验证 pgvector DDL、用真实 MCP 服务器与真实 TTS 各跑一次端到端；`/api/search`、`/api/tts` 的请求体上限与限流仍待补。
