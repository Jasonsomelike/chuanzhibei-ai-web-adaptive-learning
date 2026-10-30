from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "submission" / "作品介绍文档.docx"
SHOTS = ROOT / "screenshots" / "2026-10-30"
ACCENT = RGBColor(0x9A, 0x3B, 0x12)
INK = RGBColor(0x1F, 0x1B, 0x18)
MUTED = RGBColor(0x6B, 0x63, 0x5C)

doc = Document()
sec = doc.sections[0]
sec.top_margin = Cm(2.2)
sec.bottom_margin = Cm(2.2)
sec.left_margin = Cm(2.4)
sec.right_margin = Cm(2.4)

def set_font(run, size=10.5, bold=False, color=INK):
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = "Microsoft YaHei"
    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")

normal = doc.styles["Normal"]
normal.font.name = "Microsoft YaHei"
normal.font.size = Pt(10.5)
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
normal.paragraph_format.line_spacing = 1.45
normal.paragraph_format.space_after = Pt(6)

blocks = []
def h1(t): blocks.append(("h1", t))
def h2(t): blocks.append(("h2", t))
def p(t, bold=False): blocks.append(("p", t, bold))
def b(t): blocks.append(("b", t))
def img(name, width, cap): blocks.append(("img", name, width, cap))
def table(headers, rows, widths): blocks.append(("table", headers, rows, widths))

# 封面
for _ in range(3):
    doc.add_paragraph()
tp = doc.add_paragraph(); tp.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(tp.add_run("可解释的自适应学习路径"), 28, True, ACCENT)
sp = doc.add_paragraph(); sp.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(sp.add_run("算得出 · 说得清 · 改得动"), 13, False, MUTED)
doc.add_paragraph()
for line in ["2026 第九届传智杯全国大学生数智创新与 AI 应用大赛", "AI WEB 网页开发挑战赛（技术应用赛 · 团队赛）"]:
    q = doc.add_paragraph(); q.alignment = WD_ALIGN_PARAGRAPH.CENTER
    set_font(q.add_run(line), 11)

ct = doc.add_table(rows=2, cols=6)
ct.style = "Light Grid Accent 1"
ct.alignment = WD_TABLE_ALIGNMENT.CENTER
head = ["团队", "编号", "院校", "组别", "成员", "指导教师"]
row = ["胆子肥嘟嘟队", "38543", "北京电子科技学院", "B 组", "李双、于凯、王一超", "李浩亮"]
for i in range(6):
    set_font(ct.rows[0].cells[i].paragraphs[0].add_run(head[i]), 9.5, True)
    set_font(ct.rows[1].cells[i].paragraphs[0].add_run(row[i]), 9)
doc.add_paragraph()
doc.add_picture(str(SHOTS / "home.png"), width=Cm(15.5))
doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
cap = doc.add_paragraph(); cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
set_font(cap.add_run("首页：诊断、路径、导师三条主入口；不需要任何密钥即可开始。"), 9, False, MUTED)
doc.add_page_break()

h1("一、项目详情及使用方式")
h2("1.1 一句话")
p("给高校硬课的学生一条算得出、说得清、改得动的学习路径：先修图决定能不能学，Beta 后验决定先学哪个，时间预算决定这次学到哪。")
p("覆盖 9 个学科、360 个知识点、540 条先修边、1080 道题。每个知识点 3 道题、每学科 40 点 / 60 边 / 120 题，由「3 题能否形成充分证据」反推，而不是随手定的规模。")

h2("1.2 三类使用者")
b("学生：做诊断、看掌握度、按预算规划、手动改写路径、问导师、上传自己的教材 / 讲义 / PDF。")
b("评审 / 教师：账号内看到跨设备同步的进度与知识库；在方向市场选用公开方向；通过 MCP 端点把只读能力接到自己的工具里。")
b("开发者：MCP 客户端可接自建服务器；设置页可配置模型、MCP、向量与语气，不需要改代码。")

h2("1.3 三条主流程")
p("流程一：诊断 → 路径。", True)
p("按先修深度与掌握度出题，答完立即显示该点掌握度从 x% 变到 y%；诊断完成后按「深度 → ZPD → 不确定度 → 拓扑序」排序，再用 15 分钟 / 新学、8 分钟 / 复习装进预算。每一步都有一句带数值的理由，页尾给出输入指纹与路径指纹。")
p("流程二：导师。", True)
p("先检索教材 / 上传资料，再注入上下文，模型流式回答，最后逐字核对引用。服务端模式下可以打开「智能体」：模型在有界循环里调用 5 个本地只读工具和用户自建的 MCP 工具，界面显示每一步工具轨迹；失败自动退回普通流式问答。输入支持图片与浏览器语音。")
p("流程三：方向与知识库。", True)
p("一句话生成 5–20 个知识点与先修边，可改方向名；每个方向一份知识库，支持 Markdown / TXT / 带文本层 PDF；登录后同步到账号，换设备能拿回；方向可公开、可复制到自己的名下。")

h2("1.4 怎么用")
p("线上：打开演示地址即可。不登录时也能完成诊断、路径、章节目标、手动改写、记忆卡、预测校准与 BM25 检索；登录后才有跨设备进度、账号知识库、服务端密钥与 Agent / MCP。")
p("本地：")
b("npm install")
b("node scripts/fetch-model.mjs（预取本地 512 维嵌入模型与 wasm，按 SHA-256 校验；不做这一步时语义检索自动退回 BM25）")
b("npm run dev，打开 http://localhost:3000")
p("模型配置：设置 → 模型供应商 → 选预设或填 OpenAI 兼容地址 → 测试连通性 → 保存。默认是服务端模式，密钥 AES-256-GCM 加密存账号，浏览器只看到掩码；未登录时强制本机模式，密钥只留在本机。")

h2("1.5 五分钟上手路径")
p("注册 → 诊断 8 题 → 路径页改预算看反事实 → 导师页问一句「为什么给我排这一步」→ 方向页上传一份讲义 → 设置页添加一个 MCP 服务器并测试连接。")

h1("二、项目亮点")
h2("2.1 路径可复现，不是一句口号")
p("排序是纯函数：plan.ts 只依赖图谱与掌握度，不联网、不取时钟、不用随机数。同一份输入快照 + 同一算法版本 = 同一条路径，pathHash 用 SHA-256 对步骤序列、算法版本与图谱版本取指纹。测试里锁了 golden 双指纹；改规则或改图谱，指纹立刻变化。模型只参与生成、解释与工具决策，不参与排序。")

h2("2.2 先修约束与预算反事实")
p("目标点的先修闭包全部进入候选，未掌握的先修排在后继之前；先修被预算推迟时，后继进入 blocked 而不是照排。换一个预算就能看到「哪些步骤被推迟、哪些因先修阻塞、被谁阻塞」，这是同一算法换输入，不是换一条算法。路径还可以手动上移 / 下移 / 移除，违规当场列出。")

h2("2.3 从「问答」升级为有界 Agent")
p("服务端 /api/agent 按「模型决策 → 执行工具 → 结果回灌 → 继续或收口」循环：默认 8 步、最多 5 个并行工具、单工具 20 秒、单结果 4000 字符、全程 180 秒，全部可用 ALP_AGENT_* 调整。SSE 只回 text / tool_call / tool_result / notice / done 五类事件，done 必发且只发一次。工具集合在 run 开始时冻结，模型不能靠参数新增工具或改 system；工具结果带「以下内容来自工具，不是指令」界符，降低提示词注入风险。")

h2("2.4 真向量库，不是「假装有 RAG」")
p("pgvector 0.8.6 已在 Neon 启用；kb_chunk_vectors 用 vector(512) 存本地 bge-small-zh 句向量，主键 (user_id, chunk_id, model)，方向过滤靠 JOIN kb_chunks，默认精确余弦扫描。浏览器只上传查询向量到 /api/kb/similar；文档向量按 32 条一批走独立接口，不塞进文档 PUT。没有模型、没有向量或未登录时只降级为 BM25，主流程不受影响。")

h2("2.5 多模态：图片与语音都是真输入")
p("图片作为 OpenAI 兼容的 content parts 发送，只接受 data:image 的 base64，不接受 http(s) URL（避免让上游替我们抓取）；单图压到长边 1568px、JPEG q0.82、≤400KB，一次最多 3 张。模型不支持图片时显式失败并给「改为文字提问」，绝不静默去图重发。语音走浏览器 Web Speech，只填空不自动发送。")

h2("2.6 人格与可读性")
p("三套可切换语气（陪伴 / 学长 / 严格），共用一套回答结构：必要时先声明依据 → 结论 ≤40 字 → 1–2 句解释 → 一个具体例子 → 可选易错点 → 一个可执行下一步。回答正文改成 36em 阅读列、1.75 行高；10 条 rubric 的规则评分进了 npm run verify。")

h2("2.7 账号级安全与「无 key 也能用」")
p("模型 / 搜索 / 语音 / MCP 鉴权头都用 AES-256-GCM 加密存账号，AAD 绑定用户与用途，公开响应只回掩码；出站地址走形状 → DNS → 钉 IP 三层 SSRF 判定。没有密钥时，诊断、路径、记忆、校准、BM25 检索、教材阅读全部可用，界面对降级原因如实说明。")

h2("2.8 全站动效但可关闭")
p("全部 10 个页面都接入 GSAP 入场与反馈动效；prefers-reduced-motion 下全部跳过并直接设终态。没有滚动劫持、视差、逐字打字机，动效只包展示层，不改请求与状态。")

h1("三、AI 测试技术落地使用情况")
h2("3.1 自动门禁")
table(
    ["检查", "结果（2026-10-30 本机）", "说明"],
    [
        ["TypeScript strict", "exit 0", "tsc --noEmit，无 any、无 ignore"],
        ["单元 / 集成测试", "98 文件 / 2032 用例全绿", "纯函数、路由、工具循环、MCP、向量、人格"],
        ["图谱校验", "9 学科 0 error", "360 点 / 540 边 / 1080 题，每点恰好 3 题"],
        ["生产构建", "exit 0", "10 个页面 + 18 个 API 路由"],
        ["密钥扫描", "309 文件 0 命中", "screenshots 也扫描；假密钥必须短于 16 位"],
        ["导师 rubric", "10 条 / 8 维，硬门全过", "eval:tutor --judge rules，零 key"],
        ["检索评测", "recall@3 1.000，OOD empty 1.000", "50 条饱和，只作回归门槛"],
    ],
    [3.2, 5.2, 7.0],
)

h2("3.2 用 AI 测 AI 的四层")
p("第一层：可控 Mock 供应商。", True)
p("scripts/mock-provider.ts 按 baseUrl 分档返回正常、选项倒序、双解不一致、截断、坏 JSON、同批重复题干六种响应，用来验证出题链路与降级路径，不依赖真实模型。")
p("第二层：假模型 + 假 MCP 服务器。", True)
p("工具循环用注入的假 caller 覆盖 max_steps、并行工具、参数分片、工具超时、loop_detected、done 必发；MCP 客户端用 node:http 起服务器，覆盖 initialize、session、JSON / SSE 双读、404 重协商与白名单。")
p("第三层：真实上游探测。", True)
p("用配置的中转端点实测：带 tools 的请求返回 finish_reason=tool_calls；content 数组带 1×1 纯色图，三次分别读出绿 / 红 / 蓝；/embeddings 返回 404（因此改用本地模型）；pgvector 的 <=> 算子返回正确余弦距离；本地模型对 3 段中文输出 512 维、有限、归一化向量。")
p("第四层：检索与回答评测。", True)
p("50 条检索评测分字面、同义、有相关点但答不上、域外四类；域外门控把 emptyRate 从 0 提到 1.000，且 answer-absent relatedHit 保持 1.000。导师 10 条 rubric 覆盖结构、例子、禁语、声明位置等 8 个维度。")

h2("3.3 没有验证的部分")
p("应用内带登录的真实模型 Agent E2E、浏览器 Web Worker 实际推理、真机 TTS 出声、PDF worker 浏览器侧、Lighthouse / Core Web Vitals、chunk 级 hard 评测与配对 bootstrap，本轮都没有跑。文档与视频里不会把它们写成已实现。")

h1("四、项目涉及的关键技术")
h2("4.1 掌握度：难度加权 Beta 后验")
p("先验 α₀=s·p₀、β₀=s·(1−p₀)，s=2，p₀=max(0.10, 0.35−0.05·depth)；答对 α+=w、答错 β+=w，w=(0.5+0.25·d)×weightScale；输出 mean=α/(α+β) 与 sd。3 题全对后 sd 最大 0.196、中位 0.184，全部 ≤0.20。界面上显示「70% ±19」与 P(已掌握)，不是点估计。")

h2("4.2 规划：纯函数排序与装包")
p("候选按先修深度升序 → ZPD 距离升序 → sd 降序 → 拓扑序 / id 排序；再按 15 / 8 分钟贪心装包；先修被推迟时后继 blocked。输入指纹与路径指纹都是 SHA-256，golden case 锁在测试里。")

h2("4.3 检索：BM25 + 向量 + RRF")
p("BM25 用中文 bigram，单字权重 0.35、K1=1.5、B=0.75；域外门控要求查询里至少一个非疑问主题词出现在 top1（标题命中直接放行，正文命中排除虚词开头的跨词 bigram）。上传资料走 BM25 top20 ∥ 向量 top20 → RRF(k=60) → top3 → 相邻切块去重；向量不可用时只跑 BM25。")

h2("4.4 工具调用与事件流")
p("按 OpenAI 流式 tool_calls 的 index 累积 id / name / arguments 分片，支持并行调用；纯 tool_calls、content 为空的流不再被误判为空响应。服务端循环把 assistant.tool_calls 与 role:tool 的 tool_call_id 原样回灌，SSE 向前端发五类事件。")

h2("4.5 MCP 客户端")
p("按 MCP 2025-06-18 的 Streamable HTTP：单端点 POST、Accept 同时要 JSON 与 SSE、透传 Mcp-Session-Id、每个请求带 MCP-Protocol-Version、404 重新 initialize 一次。服务器地址只能来自用户配置，一律走 SSRF 防护；工具名命名空间 mcp__<server>__<tool>，白名单三层取交集。")

h2("4.6 pgvector 与本地嵌入")
p("kb_chunk_vectors 用 vector(512)，查询向量以字符串参数 + ::vector 传入（Neon 驱动会把 JS 数组序列化成 {…}）；方向过滤 JOIN kb_chunks；默认不用 HNSW、不用 SET LOCAL，避免过滤选择性低时降召回与会话状态不保留。本地模型 bge-small-zh-v1.5 q8 约 22.9MB，放 public/ 由浏览器 Worker 加载，不进 Next bundle。")

h2("4.7 多模态与安全")
p("content parts 只收 data URI；Anthropic 分支转 image block；单图压缩与数量上限在客户端做。安全侧：PBKDF2-HMAC-SHA256 600,000 次、每用户随机盐、常量时间比较；AES-256-GCM 的 AAD 绑定 userId 与用途；SSRF 三层判定并钉 IP；所有有副作用的请求校验同源；匿名入口有请求体上限。")

h2("4.8 动效")
p("GSAP 只包展示层：标题 / 卡片 stagger、路径步骤高亮、诊断题卡切换、导师新消息入场、设置分区切换、市场卡片抬升；reduced-motion 下全部跳过。")

h1("五、项目相关的图片")
img("diagnose.png", 15.5, "诊断：按先修顺序出题，答完立即显示掌握度变化与解析。")
img("path.png", 15.5, "路径：每一步带数值理由、±sd 与双指纹；可改预算看反事实，也可手动改写。")
img("tutor.png", 15.5, "导师：智能体开关、工具轨迹、图片与语音入口、向量状态与降级说明。")
img("settings-agent.png", 15.5, "设置 · 智能体与工具：MCP 服务器由用户添加，鉴权头只回掩码。")
img("settings-vector.png", 15.5, "设置 · 向量检索：本地模型状态、预取进度、重建索引与降级说明。")
img("mobile-tutor.png", 9.0, "移动端：导师页在 390×844 下不横向溢出，点击目标满足触控尺寸。")

h1("六、项目之前是否发表过或获奖")
p("没有。本项目是为 2026 第九届传智杯 AI WEB 网页开发挑战赛新做的参赛作品，此前未公开发表、未获得任何奖项，也没有使用真实学生数据或商业数据集。")

h1("七、是否在其他项目基础上优化")
p("不是 fork，也不是对现有项目的二次开发；代码在本仓库内独立实现，仓库中没有第三方源码目录。")
p("调研阶段阅读了队友提到的两个开源实现：面向会话式 Web 应用的 webapp-conversation，以及做 PDF 分页文本抽取的 pdf-page-processor；吸收的是产品思路（会话式交互、先解析再引用），没有复制其代码。与它们的差异在于：本项目把先修 DAG、Beta 后验、可复现路径指纹、预算反事实、有界 Agent + MCP、pgvector 与多模态输入放在同一条学习闭环里。")

h1("附录 A：实测数字与复现命令")
table(
    ["项目", "值", "命令"],
    [
        ["测试", "2032 passed / 98 files", "npm test"],
        ["类型", "exit 0", "npm run typecheck"],
        ["构建", "10 页面 + 18 API，exit 0", "npm run build"],
        ["图谱", "9 学科 / 360 点 / 540 边 / 1080 题", "npm run kg:validate"],
        ["密钥", "309 文件 0 命中", "npm run check:secrets"],
        ["检索", "recall@3 1.000；OOD empty 1.000", "npm run eval:rag"],
        ["导师", "10 条 rubric，硬门全过", "npm run eval:tutor"],
        ["本地嵌入", "3 段中文 → 512 维有限向量", "node scripts/precheck-embed.mjs"],
        ["pgvector", "0.8.6；余弦算子可用", "SELECT '[1,0,0]'::vector(3) <=> '[0,1,0]'::vector(3)"],
    ],
    [3.0, 7.2, 5.6],
)

h1("附录 B：边界与不能宣称")
b("应用内带登录的真实模型 Agent E2E 尚未执行；目前证据是单元测试、假模型 / 假 MCP 服务器与真实上游 wire-format 探测。")
b("浏览器 Web Worker 的实际推理未在真机浏览器验证；Node 侧同模型已通过 512 维自检。")
b("真机 TTS 出声、PDF worker 浏览器侧、Lighthouse / Core Web Vitals 未验证。")
b("50 条检索评测已饱和，不能证明向量或重排有收益；chunk 级 hard 集与配对 bootstrap 尚未做。")
b("MCP 只支持 Streamable HTTP，不支持 stdio 与旧版 HTTP+SSE；本项目的 /api/mcp 仍是公开只读端点。")
b("Anthropic 协议暂不发 tools；本机（BYOK）模式不能用服务端 Agent。")
b("浏览器本地模型首次需要预取约 44MB（44.3MiB）静态资产；缺失时语义检索降级为 BM25，不阻塞主流程。")

for blk in blocks:
    kind = blk[0]
    if kind == "h1":
        q = doc.add_paragraph()
        q.paragraph_format.space_before = Pt(16)
        q.paragraph_format.space_after = Pt(8)
        set_font(q.add_run(blk[1]), 16, True, ACCENT)
    elif kind == "h2":
        q = doc.add_paragraph()
        q.paragraph_format.space_before = Pt(10)
        q.paragraph_format.space_after = Pt(4)
        set_font(q.add_run(blk[1]), 12.5, True, INK)
    elif kind == "p":
        q = doc.add_paragraph()
        set_font(q.add_run(blk[1]), 10.5, blk[2])
    elif kind == "b":
        q = doc.add_paragraph(style="List Bullet")
        q.paragraph_format.space_after = Pt(3)
        set_font(q.add_run(blk[1]), 10.5)
    elif kind == "img":
        path = SHOTS / blk[1]
        if path.exists():
            doc.add_picture(str(path), width=Cm(blk[2]))
            doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cap = doc.add_paragraph()
            cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            set_font(cap.add_run(blk[3]), 9, False, MUTED)
    elif kind == "table":
        headers, rows, widths = blk[1], blk[2], blk[3]
        t = doc.add_table(rows=1, cols=len(headers))
        t.style = "Light Grid Accent 1"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, htext in enumerate(headers):
            cell = t.rows[0].cells[i]
            cell.text = ""
            set_font(cell.paragraphs[0].add_run(htext), 9.5, True)
        for r in rows:
            cells = t.add_row().cells
            for i, val in enumerate(r):
                cells[i].text = ""
                set_font(cells[i].paragraphs[0].add_run(str(val)), 9)
        for tr in t.rows:
            for i, w in enumerate(widths):
                tr.cells[i].width = Cm(w)
        doc.add_paragraph().paragraph_format.space_after = Pt(2)

OUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUT)
print("saved", OUT)
