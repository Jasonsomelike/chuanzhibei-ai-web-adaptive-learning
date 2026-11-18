from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "submission" / "作品介绍文档.docx"
SHOTS = ROOT / "screenshots" / "2026-10-30"
INK = RGBColor(0, 0, 0)

doc = Document()

# ── 页面与样式：对照参考报告 ─────────────────────────
for section in doc.sections:
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.54)
    section.bottom_margin = Cm(2.54)
    section.left_margin = Cm(3.0)
    section.right_margin = Cm(2.5)

normal = doc.styles["Normal"]
normal.font.name = "Times New Roman"
normal.font.size = Pt(12)
normal.font.color.rgb = INK
normal._element.rPr.rFonts.set(qn("w:eastAsia"), "SimSun")
normal.paragraph_format.line_spacing = 1.3
normal.paragraph_format.space_after = Pt(3)
normal.paragraph_format.first_line_indent = Cm(0.85)
normal.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT

h1 = doc.styles["Heading 1"]
h1.font.name = "Times New Roman"
h1.font.size = Pt(16)
h1.font.bold = True
h1.font.color.rgb = RGBColor(0, 0, 0)
h1._element.rPr.rFonts.set(qn("w:eastAsia"), "SimHei")
h1.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER
h1.paragraph_format.space_before = Pt(18)
h1.paragraph_format.space_after = Pt(10)
h1.paragraph_format.line_spacing = Pt(19)
h1.paragraph_format.first_line_indent = Cm(0)
h1.paragraph_format.keep_with_next = True

def _fix_rfonts(style, east):
    rPr = style.element.get_or_add_rPr()
    rf = rPr.get_or_add_rFonts()
    for attr in ("asciiTheme", "eastAsiaTheme", "hAnsiTheme", "cstheme"):
        rf.attrib.pop(qn("w:" + attr), None)
    rf.set(qn("w:ascii"), "Times New Roman")
    rf.set(qn("w:hAnsi"), "Times New Roman")
    rf.set(qn("w:eastAsia"), east)

h2 = doc.styles["Heading 2"]
h2.font.name = "Times New Roman"
h2.font.size = Pt(14)
h2.font.bold = True
h2.font.color.rgb = RGBColor(0, 0, 0)
h2._element.rPr.rFonts.set(qn("w:eastAsia"), "SimHei")
h2.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
h2.paragraph_format.space_before = Pt(14)
h2.paragraph_format.space_after = Pt(7)
h2.paragraph_format.line_spacing = Pt(18)
h2.paragraph_format.first_line_indent = Cm(0)
h2.paragraph_format.keep_with_next = True


_fix_rfonts(h1, "SimHei")
_fix_rfonts(h2, "SimHei")
_fix_rfonts(normal, "SimSun")

def run_font(run, size=12, bold=None, east="SimSun", ascii_font="Times New Roman"):
    run.font.name = ascii_font
    run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    run._element.rPr.rFonts.set(qn("w:eastAsia"), east)


def _add_inline(p, text, size=12, bold_base=False):
    """解析 **加粗** 与 `代码`（代码用 Consolas，中文仍走宋体）。"""
    for i, chunk in enumerate(text.split("`")):
        if chunk == "":
            continue
        is_code = i % 2 == 1
        for j, part in enumerate(chunk.split("**")):
            if part == "":
                continue
            r = p.add_run(part)
            run_font(
                r,
                size,
                bold=(bold_base or j % 2 == 1),
                ascii_font=("Consolas" if is_code else "Times New Roman"),
            )


def body(text, indent=True):
    p = doc.add_paragraph()
    if not indent:
        p.paragraph_format.first_line_indent = Cm(0)
    _add_inline(p, text, 12)
    return p


def bullet(text):
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Cm(0)
    p.paragraph_format.left_indent = Cm(0.85)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("· ")
    run_font(r, 12)
    _add_inline(p, text, 12)
    return p


def caption(text, bold=False, keep_next=False):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = Cm(0)
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_together = True
    p.paragraph_format.keep_with_next = keep_next
    r = p.add_run(text)
    run_font(r, 10.5, bold=bold)
    return p


def figure(name, cap, width=11.64):
    path = SHOTS / name
    if not path.exists():
        return
    doc.add_picture(str(path), width=Cm(width))
    pic = doc.paragraphs[-1]
    pic.alignment = WD_ALIGN_PARAGRAPH.CENTER
    pic.paragraph_format.first_line_indent = Cm(0)
    pic.paragraph_format.space_before = Pt(6)
    pic.paragraph_format.keep_with_next = True
    pic.paragraph_format.keep_together = True
    caption(cap)


def shade(cell):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), "F2F2F2")
    tcPr.append(shd)


def no_borders(t):
    tblPr = t._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement("w:" + edge)
        el.set(qn("w:val"), "none")
        el.set(qn("w:sz"), "0")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "auto")
        borders.append(el)
    tblPr.append(borders)


def three_line(t):
    tblPr = t._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "bottom"):
        el = OxmlElement("w:" + edge)
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "12")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "000000")
        borders.append(el)
    for edge in ("left", "right", "insideH", "insideV"):
        el = OxmlElement("w:" + edge)
        el.set(qn("w:val"), "none")
        el.set(qn("w:sz"), "0")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "auto")
        borders.append(el)
    tblPr.append(borders)


def header_bottom(cell):
    tcPr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "8")
    bottom.set(qn("w:space"), "0")
    bottom.set(qn("w:color"), "000000")
    borders.append(bottom)
    tcPr.append(borders)


def figure_grid(items):
    t = doc.add_table(rows=1, cols=len(items))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    no_borders(t)
    for i, (name, cap, width) in enumerate(items):
        cell = t.rows[0].cells[i]
        cell.width = Cm(7.5)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.first_line_indent = Cm(0)
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after = Pt(2)
        p.add_run().add_picture(str(SHOTS / name), width=Cm(width))
        cp = cell.add_paragraph()
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.paragraph_format.first_line_indent = Cm(0)
        cp.paragraph_format.space_after = Pt(6)
        run_font(cp.add_run(cap), 9, False)
    trPr = t.rows[0]._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:cantSplit"))


def table(cap, headers, rows, widths):
    caption(cap, bold=True, keep_next=True)
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    three_line(t)
    for i, h in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = ""
        p = cell.paragraphs[0]
        p.paragraph_format.first_line_indent = Cm(0)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run_font(p.add_run(h), 10.5, bold=True)
        header_bottom(cell)
    trPr = t.rows[0]._tr.get_or_add_trPr()
    trPr.append(OxmlElement("w:tblHeader"))
    for row in rows:
        cells = t.add_row().cells
        for i, v in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.first_line_indent = Cm(0)
            p.paragraph_format.space_after = Pt(1)
            run_font(p.add_run(str(v)), 10.5)
    for ri, tr in enumerate(t.rows):
        trPr = tr._tr.get_or_add_trPr()
        cant = OxmlElement("w:cantSplit")
        trPr.append(cant)
        if ri < len(t.rows) - 1:
            for cell in tr.cells:
                for para in cell.paragraphs:
                    para.paragraph_format.keep_with_next = True
        for i, w in enumerate(widths):
            tr.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def toc_field():
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = Cm(0)
    r = p.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = 'TOC \\h \\o "1-2"'
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = "右键更新目录"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for node in (begin, instr, sep, text, end):
        r._r.append(node)


# ── 排版后处理：去掉中文与西文之间的空格 ──────────────
# 规则：CJK 字符与 [A-Za-z0-9] 相邻处的空格删除（两个方向都删）；
# 西文与西文之间的空格（如 Next.js 16.4.2、npm run verify）保留。
CJK = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff"
SPACE = " \u00a0\u3000"
CJK_LATIN_SPACE = re.compile(
    rf"(?<=[{CJK}])[{SPACE}]+(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])[{SPACE}]+(?=[{CJK}])"
)


def _iter_direct_runs(p_el):
    """段落内的 w:r，跳过嵌套段落（文本框）里的 run。"""
    for r in p_el.iter(qn("w:r")):
        anc = r.getparent()
        nested = False
        while anc is not None and anc is not p_el:
            if anc.tag == qn("w:p"):
                nested = True
                break
            anc = anc.getparent()
        if not nested:
            yield r


def _flush_text_segment(segment):
    """segment 是同一段落内连续的纯文本 w:t 列表；删掉其中的中西文间隔空格。"""
    if not segment:
        return 0
    texts = [t.text or "" for t in segment]
    full = "".join(texts)
    marks = set()
    for m in CJK_LATIN_SPACE.finditer(full):
        marks.update(range(m.start(), m.end()))
    if not marks:
        return 0
    drops = {}
    offset = 0
    for ti, s in enumerate(texts):
        for ci, _ch in enumerate(s):
            if offset + ci in marks:
                drops.setdefault(ti, set()).add(ci)
        offset += len(s)
    for ti, drop in drops.items():
        new = "".join(ch for ci, ch in enumerate(texts[ti]) if ci not in drop)
        el = segment[ti]
        el.text = new
        if new[:1].isspace() or new[-1:].isspace():
            el.set(qn("xml:space"), "preserve")
        else:
            el.attrib.pop(qn("xml:space"), None)
    return len(marks)


def disable_cjk_latin_autospace(document):
    """关掉 Word 的「自动调整中文与西文之间的间距」。

    只删字符空格还不够：Word 默认会在 CJK 与拉丁/数字之间自动补一段
    视觉间隙（autoSpaceDE / autoSpaceDN），导出的 PDF 看起来仍有空格。
    这里在每个段落的 pPr 里显式置 0，并同步 Normal 与 TOC 样式。
    """
    successors = (
        "w:bidi",
        "w:adjustRightInd",
        "w:snapToGrid",
        "w:spacing",
        "w:ind",
        "w:contextualSpacing",
        "w:mirrorIndents",
        "w:suppressOverlap",
        "w:jc",
        "w:textDirection",
        "w:textAlignment",
        "w:textboxTightWrap",
        "w:outlineLvl",
        "w:divId",
        "w:cnfStyle",
        "w:rPr",
        "w:sectPr",
        "w:pPrChange",
    )

    def patch(pPr):
        for tag in ("w:autoSpaceDE", "w:autoSpaceDN"):
            el = pPr.find(qn(tag))
            if el is None:
                el = pPr.makeelement(qn(tag), {})
                pPr.insert_element_before(el, *successors)
            el.set(qn("w:val"), "0")

    count = 0
    for p_el in document.element.body.iter(qn("w:p")):
        patch(p_el.get_or_add_pPr())
        count += 1

    for style_name in ("Normal", "TOC 1", "TOC 2"):
        try:
            style = document.styles[style_name]
        except KeyError:
            continue
        patch(style.element.get_or_add_pPr())
    return count


def strip_cjk_latin_spaces(document):
    """只处理正文与表格（document.xml 的 body）；页眉页脚是独立 part，不动。"""
    removed = 0
    for p_el in document.element.body.iter(qn("w:p")):
        segment = []
        for r in _iter_direct_runs(p_el):
            children = [c for c in r.iterchildren() if c.tag != qn("w:rPr")]
            if children and all(c.tag == qn("w:t") for c in children):
                segment.extend(children)
            else:
                # 含 tab / br / 域代码 / 图片的 run：断开，避免跨结构误删
                removed += _flush_text_segment(segment)
                segment = []
        removed += _flush_text_segment(segment)
    return removed


# ── 省赛版封面 ─────────────────────────────────────
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "submission" / "省赛作品介绍文档.docx"
SHOTS = ROOT / "screenshots" / "provincial"

doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.first_line_indent = Cm(0)
run_font(p.add_run("2026 第九届传智杯全国大学生计算机技能大赛"), 14, False, "SimSun")

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.first_line_indent = Cm(0)
p.paragraph_format.space_before = Pt(4)
run_font(p.add_run("AI WEB 网页开发挑战赛 · 省赛作品介绍文档"), 14, False, "SimSun")

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.first_line_indent = Cm(0)
p.paragraph_format.space_before = Pt(18)
p.paragraph_format.space_after = Pt(6)
run_font(p.add_run("可解释的自适应学习路径"), 26, True, "SimHei")

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.first_line_indent = Cm(0)
p.paragraph_format.space_after = Pt(26)
run_font(p.add_run("算得出 · 说得清 · 改得动"), 13, False, "SimSun")

info = [
    ("作品名称", "可解释的自适应学习路径"),
    ("参赛赛道", "AI WEB 网页开发挑战赛（省赛 / 复赛 · 作品题 · 团队赛）"),
    ("参赛组别", "B 组（非 985/211 普通本科）"),
    ("所属赛区", "北部赛区"),
    ("团队名称", "胆子肥嘟嘟队（编号 38543）"),
    ("所属院校", "北京电子科技学院"),
    ("团队成员", "李双、于凯、王一超"),
    ("指导教师", "李浩亮"),
    ("完成日期", "2026 年 11 月 18 日"),
]
t = doc.add_table(rows=0, cols=2)
t.style = "Table Grid"
t.alignment = WD_TABLE_ALIGNMENT.CENTER
for k, v in info:
    cells = t.add_row().cells
    for i, text in enumerate((k, v)):
        cells[i].text = ""
        q = cells[i].paragraphs[0]
        q.paragraph_format.first_line_indent = Cm(0)
        run_font(q.add_run(text), 11, bold=(i == 0))
for tr in t.rows:
    tr.cells[0].width = Cm(3.4)
    tr.cells[1].width = Cm(11.2)

doc.add_section(WD_SECTION.NEW_PAGE)

# ── 目录 ────────────────────────────────────────────
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
p.paragraph_format.first_line_indent = Cm(0)
p.paragraph_format.space_after = Pt(10)
run_font(p.add_run("目  录"), 16, True, "SimHei")
for toc_name in ("TOC 1", "TOC 2"):
    try:
        _fix_rfonts(doc.styles[toc_name], "SimSun")
    except KeyError:
        pass
toc_field()

doc.add_section(WD_SECTION.NEW_PAGE)

# ══════════════════════════════════════════════════
# 正文
# ══════════════════════════════════════════════════

h1 = doc.add_paragraph("一、作品概述", style="Heading 1")
h2 = doc.add_paragraph("（一）问题与定位", style="Heading 2")
body(
    "高校硬课里，学生最常问的不是「这题怎么做」，而是「我现在到底该学哪一步」。一门数据结构有 40 个知识点，"
    "先修关系把它们连成一张有向无环图；学生既不知道自己卡在哪，也不知道下一步该补哪个先修。常见推荐系统按兴趣、"
    "热度或相似度排序，回答的是「你可能喜欢什么」，却回答不了「你现在能不能学、先学哪一个」。"
)
body(
    "本项目把课程先修关系建成硬约束，把掌握度建成带不确定性的 Beta 后验，把时间预算建成显式装包约束，得到一条"
    "**算得出、说得清、改得动**的学习路径。排序是纯函数：给定同一份图谱、证据与预算，路径逐位可复现；"
    "大模型只参与解释、出题与工具决策，不参与排序。"
)

h2 = doc.add_paragraph("（二）目标用户与场景", style="Heading 2")
body(
    "**学生**：课前做一轮诊断，知道缺哪块先修；课后按 30 / 60 / 90 分钟预算规划下一次自习；"
    "遇到不会的题，在错题本里按知识点回看，再用同一条作答管线重做。"
)
body(
    "**教师与评审**：看到每一步的数值理由、路径指纹与作答证据，能判断系统为什么这样排；"
    "公开课程可被复制到自己的账号，题库、先修边与资料口径保持可核查。"
)
body(
    "**开发者**：通过 25 个 API 与 MCP 端点（5 tools / 18 resources / 2 prompts）把只读的图谱、路径与检索能力"
    "接到自己的工具里；工具集合在 run 开始时冻结，模型不能凭参数新增工具。"
)

h2 = doc.add_paragraph("（三）方案与关键数字", style="Heading 2")
body(
    "系统由四个层次组成：触点层是 11 个页面与 25 个 API；能力层负责大模型、教学工作流、检索、文档、MCP 与语音；"
    "决策层是 `plan.ts`、`mastery.ts`、`graph.ts`、`chapters.ts` 这些纯函数；数据层是 17 张表与浏览器 IndexedDB。"
    "关键约束只有一条：**决策层不 import 触点层**，所以模型、搜索、存储全部不可用时，排序行为完全不变。"
)
for text in [
    "**9 学科 · 360 知识点 · 540 条先修边 · 1080 道题**，每学科 40 点 / 60 边 / 120 题，逐科校验无环、无悬空边、每点恰好 3 题。",
    "**11 个页面 + 25 个 API**；116 个测试文件、2207 条用例全部通过；生产构建 exit 0。",
    "**17 张表**承载账号、进度、方向、密钥、知识库、向量、MCP 与教学检查点；浏览器侧另有 IndexedDB 兜底。",
    "**6 套配色 × 明暗 × 3 种布局**；核心链路（诊断、路径、错题、BM25 检索）不配任何 API key 也能完整使用。",
]:
    bullet(text)

table(
    "表1  省赛作品提交要求与本文对应",
    ["要求", "本文对应位置", "可核查的证据"],
    [
        ["作品简介", "第一章", "问题、用户、方案与关键数字"],
        ["技术架构与实现", "第二章、第六章", "分层图、核心模块表、关键参数表"],
        ["功能说明", "第三章", "11 个页面的使用路径与功能矩阵"],
        ["AI 技术应用", "第五章", "大模型、Agent、RAG、多模态、MCP、安全六节"],
        ["创新点", "第四章", "可复现、反事实、证据链、教学工作流、端侧智能"],
        ["系统展示", "第七章", "10 张本机生产构建截图"],
        ["原创与沿革", "第九章", "原创声明、参考项目差异、里程碑"],
    ],
    [3.6, 5.0, 6.4],
)

h1 = doc.add_paragraph("二、系统总体设计", style="Heading 1")
h2 = doc.add_paragraph("（一）分层架构", style="Heading 2")
body(
    "**触点层**：`AppShell` 统一桌面侧栏、顶部标题、命令菜单与移动端底部导航；11 个页面各自只负责交互与展示。"
    "25 个 API 覆盖认证、配置、对话、Agent、方向、文档、知识库、记忆、进度、检索、语音与 MCP。"
)
body(
    "**能力层**：模型供应商适配（OpenAI 兼容与 Anthropic 两种协议）、Learning Supervisor 教学工作流、"
    "BM25 + 向量混合检索、文档解析与 OCR、MCP 客户端、图片压缩与语音识别。每个能力失败只降级自己，不阻塞核心路径。"
)
body(
    "**决策层**：`plan.ts` 负责排序、预算装包、反事实与双指纹；`mastery.ts` 负责 Beta 后验与不确定性；"
    "`graph.ts` 负责先修闭包与拓扑；`chapters.ts` 负责章节收窄。它们只依赖纯数据，不联网、不取时钟、不用随机数。"
)
body(
    "**数据层**：Postgres 17 张表（账号、会话、进度、方向、方向选题、方向题目、密钥、知识库文档、知识库片段、"
    "片段向量、MCP 服务器、记忆卡、教学检查点、导师会话与消息、知识库墓碑、学习产物）；未登录或数据库缺失时退化为进程内内存与 IndexedDB。"
)

h2 = doc.add_paragraph("（二）一次完整学习闭环", style="Heading 2")
body(
    "首页给出「今天先学什么」与 30 / 60 / 90 分钟的即时预览；进入诊断后按先修顺序出题，答完立刻更新掌握度与不确定区间；"
    "知识图谱页把预算、图谱、本次学习顺序与每一步的理由放在同一屏；开始学习后，导师按三档帮助讲解，"
    "练习卡由服务端判分并幂等记录证据；错题进入错题本，按知识点汇总、写笔记、导出 Markdown，"
    "再从同一条作答管线重做；新的证据会重新进入规划，形成闭环。"
)

h2 = doc.add_paragraph("（三）技术栈", style="Heading 2")
table(
    "表2  技术栈与用途",
    ["层次", "技术", "用途"],
    [
        ["前端框架", "Next.js 16 App Router、React 19、TypeScript 5.9 strict", "11 个页面、25 个 API、服务端渲染与流式响应"],
        ["样式与动效", "Tailwind 4、CSS 变量、GSAP、React Flow", "6 套主题、3 种布局、图谱与清单重排"],
        ["数据与存储", "Neon Postgres、pgvector 0.8.6、IndexedDB", "17 张表、512 维向量、匿名本机资料"],
        ["模型与检索", "OpenAI 兼容 / Anthropic 协议、BM25、RRF、bge-small-zh 本地嵌入", "对话、出题、解释、混合检索"],
        ["质量与部署", "Vitest、Playwright、ESLint、Vercel、GitHub Actions", "2207 条单测、E2E、构建与部署"],
    ],
    [3.2, 6.2, 5.6],
)

h1 = doc.add_paragraph("三、详细功能与使用方式", style="Heading 1")
h2 = doc.add_paragraph("（一）学习概览", style="Heading 2")
body(
    "首页不再堆技术说明，而是直接回答「今天先学什么」。左侧给出当前课程、下一个学习任务与预计用时，"
    "右侧是课程列表与最近学习；本次学习安排提供 30 / 60 / 90 分钟三档预览，切换预算时清单与分钟数同步变化。"
    "新用户看到的是真实空状态（0 / 40 个知识点已测），不生成虚假的学习时长。"
)

h2 = doc.add_paragraph("（二）课程诊断", style="Heading 2")
body(
    "诊断按先修顺序出题，每道题先给出「这题预测你答对的概率」，答完立刻显示该知识点的掌握度从 x% 变到 y%，"
    "并给出 ±sd 的不确定区间。预测校准卡把系统的把握与实际对错放在一起对账，样本不足就写样本不足；"
    "答错生成记忆卡，复习自评不计入掌握度。重测只重开会话，不清空历史证据。"
)

h2 = doc.add_paragraph("（三）知识图谱与学习地图", style="Heading 2")
body(
    "知识图谱页把预算、图谱、学习顺序与推荐理由放在同一工作区：预算可从 30 分钟调到 240 分钟，"
    "图谱实时标出本次学习、候选与先修关系；右侧清单列出每一步的分钟数与「为什么这样排」；"
    "页尾保留输入指纹、算法路径指纹、算法版本与图谱版本。每一步可上移、下移、移除，违规时顶部红条指出违反了哪条先修。"
)
body(
    "三种布局（导览 / 地图 / 章节）与六套配色解决不同阅读场景；图谱可搜索、可切换「当前路径 / 全科关系」、可导出 PNG。"
)

h2 = doc.add_paragraph("（四）课程导师与教学工作流", style="Heading 2")
body(
    "导师页是「教材 + 对话」的双栏工作台：左栏读教材、看引用原文与上传资料，右栏提问；移动端把材料收进抽屉，"
    "输入区保持可用。三档帮助（给我提示 / 引导步骤 / 完整讲解）只改变教学策略，不改变事实；"
    "回答先检索再生成，引用逐个核对，教材没有就说没有。"
)
body(
    "登录并保存服务端模型配置后，导师默认启用 Learning Supervisor：它在学情与路径、知识辅导、练习与测评三类工作流之间路由，"
    "读取真实证据、执行有界工具循环、规则核验后保存教学检查点；练习卡由学生显式提交，服务端判分并幂等记录证据，"
    "刷新可恢复。模型不能自报掌握度，也不能修改先修关系。"
)

h2 = doc.add_paragraph("（五）错题本", style="Heading 2")
body(
    "错题本按知识点汇总历史错题与当前掌握度，支持按知识点筛选、逐题写笔记、导出带教材 / 讲义 / 上传资料摘录的"
    "Markdown 总结；重做入口复用诊断页的同一条作答管线，掌握度、记忆卡与预测校准全部沿用，不另开写入路径。"
)

h2 = doc.add_paragraph("（六）我的课程与课程探索", style="Heading 2")
body(
    "「我的课程」支持一句话生成 5–20 个知识点与先修边，预览标题可直接改；保存后可立即规划路径。"
    "课程探索列出公开课程，可搜索、查看规模与复制到自己名下；复制默认私有，上传知识库不随副本复制。"
)

h2 = doc.add_paragraph("（七）设置：外观、模型与工具、资料与口径、学习数据、账号与隐私", style="Heading 2")
body(
    "设置页收敛为五个分区，另设使用帮助入口：外观（3 种布局、6 套配色、明暗 / 跟随系统、减少动态效果）、"
    "模型与工具（供应商预设、两种协议、连通性测试、思考强度、TTS、搜索、MCP）、"
    "资料与口径（教材 / 讲义优先级、逐条裁定、我的讲义）、学习数据（进度、错题、记忆卡、导出与清理）、"
    "账号与隐私（登录、密钥掩码、数据边界）、使用帮助。每个分区独立保存，互不覆盖。"
)
body(
    "服务端模式下模型 / 搜索 / 语音密钥用 AES-256-GCM 加密存进账号，任何响应只回末四位掩码；"
    "本机模式密钥只存浏览器，请求由浏览器直连供应商；未登录强制本机模式，避免请求一个必然 401 的代理。"
)

h2 = doc.add_paragraph("（八）移动端与可访问性", style="Heading 2")
body(
    "手机端使用底部四入口（概览、诊断、图谱、导师）与安全区适配，触控目标不小于 44px；"
    "图谱、材料抽屉与章节抽屉支持键盘与 Escape 焦点恢复；`prefers-reduced-motion` 命中时不建动画；"
    "六套主题的正文与次要文字满足 WCAG AA，图谱状态文字实测对比度不低于 4.5:1。"
)

table(
    "表3  功能矩阵",
    ["角色", "入口", "能做什么"],
    [
        ["学生", "学习概览 / 诊断 / 图谱 / 导师 / 错题本", "诊断、规划、按预算学习、三档求助、错题重做"],
        ["教师与评审", "关于项目 / 使用指南 / 公开课程", "查看算法口径、路径指纹、证据与限制，复制公开课程"],
        ["开发者", "MCP / 25 个 API", "只读图谱、路径、检索与课程能力接入外部工具"],
    ],
    [2.6, 6.0, 6.4],
)

h1 = doc.add_paragraph("四、项目亮点", style="Heading 1")
h2 = doc.add_paragraph("（一）可复现不是一句口号", style="Heading 2")
body(
    "排序是纯函数：不联网、不取时钟、不用随机数。输入快照 + 算法版本 = 同一条路径；"
    "`pathHash` 对步骤序列、算法版本与图谱版本取 SHA-256，测试里锁了 golden 双指纹，改规则或改图谱会立刻失败。"
    "手动调整只改变显示顺序，算法路径指纹不变；换预算只换取舍，不换算法。"
)
h2 = doc.add_paragraph("（二）先修硬约束与预算反事实", style="Heading 2")
body(
    "目标知识点的先修闭包必须全部进入候选，未掌握的先修排在后继之前；先修被预算推迟时，后继进入 blocked 而不是照排。"
    "换一个预算就能看到同一算法在不同时间约束下的取舍：哪些步骤被推迟、哪些因先修被阻塞、阻塞点后面是谁挡住了它。"
)
h2 = doc.add_paragraph("（三）证据链：回答必须有出处", style="Heading 2")
body(
    "导师回答先检索再生成，引用逐个逐字核对；上传资料优先于通用知识，教材与讲义没有依据时明确说没有，"
    "不拿维基百科或模型记忆凑答案。域外门控在截断前对完整候选生效，够不上就不放进来。"
)
h2 = doc.add_paragraph("（四）有界教学工作流，而不是「自主 Agent」", style="Heading 2")
body(
    "Supervisor 是可解释的确定性路由，五个意图、三类工作流；工具集合在 run 开始时冻结，模型不能凭参数新增工具或改 system；"
    "默认 8 步、5 个并行工具、单工具 20 秒、单结果 4000 字符、整轮 180 秒。练习提交是用户显式操作，不是 Agent 的写工具。"
)
h2 = doc.add_paragraph("（五）端侧智能与阅读体验", style="Heading 2")
body(
    "浏览器本地 512 维嵌入让上传资料在端侧完成语义检索，缺失时自动退回 BM25；首页 Canvas 装饰纹样在 6 倍 CPU 降速下"
    "实测约 30fps，单次位图复制最大 1.60ms，并在后台、离屏、减少动态效果与省流环境下暂停或静态降级。"
)
h2 = doc.add_paragraph("（六）安全与可控", style="Heading 2")
body(
    "密钥不进浏览器：服务端 AES-256-GCM 加密、AAD 绑定用户与用途，缺失主密钥时拒绝保存而不是明文落库；"
    "代理与 MCP 做 SSRF 校验（https、私网 / 环回 / 元数据地址拦截）；API 有同源校验、请求体上限与按 IP 限流；"
    "匿名用户能看不能存。"
)

h1 = doc.add_paragraph("五、AI 技术落地与测试", style="Heading 1")
h2 = doc.add_paragraph("（一）大模型集成质量", style="Heading 2")
body(
    "模型层支持 8 个供应商预设与自定义端点，兼容 OpenAI 与 Anthropic 两种协议；流式输出、思考强度、"
    "结构化 JSON 校验、超时与重试、上下文 token 预算都在服务端统一处理。模型只参与生成图谱、出题、写解释与工具决策，"
    "不参与排序；任何模型失败都逐项降级：无工具退回普通问答，无向量退回 BM25，无模型退回知识库拼装。"
)
h2 = doc.add_paragraph("（二）人格、提示词与教学策略", style="Heading 2")
body(
    "三档语气（陪伴 / 学长 / 严格）只改变怎么说，不改变说什么；三档帮助（提示 / 引导 / 完整）只改变教学策略，"
    "不改变事实。所有语气共用固定身份、安全规则与回答结构：先结论、再依据、再下一步。"
    "导师规则评测用 10 条用例 × 8 个维度，硬门全过才进入提交。"
)
h2 = doc.add_paragraph("（三）Agent / 工作流设计", style="Heading 2")
body(
    "服务端 Agent 在同一个 run 内维护 `text / tool_call / tool_result / notice / workflow / done` 六类 SSE 事件；"
    "工具调用按 index 累积，失败自动退回普通流式问答。Learning Supervisor 在此之上增加 Learning Context、"
    "Response Verifier 与 CAS 检查点：先读账号真实证据，再路由工作流，输出前检查引用编号与路径指纹，"
    "最后把可恢复的教学状态写入 `learning_sessions`。"
)
h2 = doc.add_paragraph("（四）RAG 技术应用", style="Heading 2")
body(
    "内置知识点走 BM25（K1=1.5、B=0.75、中文 bigram、单字降权 0.35）；上传资料走 BM25 top20 与 512 维向量 top20，"
    "RRF（k=60）融合后取 top3，余弦阈值 0.25，相邻切块去重。回答里的 `[kcId]` / `[资料n]` 必须能在检索结果中找到，"
    "逐条标注已核对 / 未找到依据 / 与原文冲突。"
)
table(
    "表4  检索评测（2026-11-18 本机）",
    ["指标", "结果", "说明"],
    [
        ["recall@3", "1.000（30/30）", "50 条评测中的可答部分"],
        ["MRR@10", "1.000（30/30）", "首条命中位置"],
        ["goldPhraseInFullText", "1.000（30/30）", "金句必须出现在全文"],
        ["answer-absent relatedHit", "1.000（10/10）", "答不上时仍命中相关知识"],
        ["out-of-domain empty", "1.000（10/10）", "域外问题不放上下文"],
        ["falseContext", "0.000（0/10）", "域外误配为零"],
        ["unanswerableEmpty", "0.500（10/20）", "不可答与域外的并集，仍有提升空间"],
        ["片段级 hard 集 nDCG@10", "0.955", "22 查询 / 18 原文片段，标题加权增益为 0"],
    ],
    [5.6, 4.4, 5.0],
)
body(
    "这套 50 条评测已经饱和，只能证明基础检索没坏，不能证明向量或 RRF 带来提升；混合检索本轮未测。"
    "这一点写进限制，不当作效果证据。"
)
h2 = doc.add_paragraph("（五）多模态能力", style="Heading 2")
body(
    "图片输入支持粘贴、选择与拍照，最多 3 张，长边压到 1568px、JPEG q0.82、单张不超过 400KB；"
    "模型不支持图片时明确提示「改为文字提问」，不静默丢图。语音输入用 Web Speech 只把转写填进输入框，不自动发送；"
    "朗读支持浏览器 speech 与 mimo chat-audio 两种协议。"
)
h2 = doc.add_paragraph("（六）MCP / 工具集成", style="Heading 2")
body(
    "设置页可添加、启用、删除自建 MCP 服务器，填 URL 与工具白名单；鉴权头只写不读，AES-256-GCM 加密存库，"
    "界面只回末四位。服务端 MCP 客户端支持 Streamable HTTP、会话与版本协商；`POST /api/mcp` 暴露 5 tools / 18 resources / 2 prompts，"
    "全部只读。远程工具必须由用户勾选并声明只读，模型不能自行决定地址。"
)
h2 = doc.add_paragraph("（七）AI 安全与可控性", style="Heading 2")
body(
    "服务端密钥 AES-256-GCM + AAD，主密钥只从 `ALP_SECRET_KEY` 读取；密码 PBKDF2-HMAC-SHA256 600k 次；"
    "代理与 MCP 做 SSRF 形状 → DNS → 固定 IP 校验；API 同源、请求体上限、按 IP 固定窗口限流；"
    "匿名用户只读、不写库；仓库密钥扫描覆盖 466 个文件、0 命中。"
)
table(
    "表5  评分维度与对应证据",
    ["维度（权重）", "本项目对应", "证据位置"],
    [
        ["AI 技术深度 35%", "大模型集成、Supervisor、RAG、多模态、MCP、安全", "第五章、第六章"],
        ["创新性 25%", "可复现路径、预算反事实、证据链、教学工作流", "第四章"],
        ["前端工程质量 10%", "TypeScript strict、组件分层、纯函数决策层、2207 条测试", "第六章、第八章"],
        ["实用性 10%", "真实课程闭环、错题复习、三档帮助、无 key 可用", "第三章"],
        ["用户体验 10%", "6 主题 × 3 布局、GSAP、移动端、可访问性", "第三章、第七章"],
        ["社会价值 10%", "县域 / 普通高校的个性化学习基础设施", "第一章、第九章"],
    ],
    [4.4, 7.0, 3.6],
)

h1 = doc.add_paragraph("六、关键技术实现", style="Heading 1")
h2 = doc.add_paragraph("（一）纯函数规划与双指纹", style="Heading 2")
body(
    "`planPath` 的输入只有图谱、掌握证据、显式分钟估算、预算与目标；排序键依次为「先修深度 → ZPD 距离 → sd → 兜底」，"
    "预算装包按分钟累加，装不下就进入 deferred；先修被 deferred 的后继进入 blocked，并列出阻塞者。"
    "`pathHash` 对 steps + algoVersion + kgVersion 取 SHA-256；手写同步 SHA-256 用 Node crypto 逐条交叉验证，"
    "覆盖空串、55/56/63/64/119/120/128/1000 字节与中英混合。"
)
h2 = doc.add_paragraph("（二）Beta 后验与不确定性", style="Heading 2")
body(
    "每个知识点维护 α/β，答对加难度权重、答错加 1；界面显示均值、±sd 与 P(已掌握)。"
    "停测准则同时看证据条数与 sd：条数够但对错分裂时继续测；P(已掌握) 只展示，不作为停测阈值。"
)
h2 = doc.add_paragraph("（三）图谱与预算", style="Heading 2")
body(
    "9 学科各 40 点 / 60 边 / 120 题，`kg:validate` 逐科检查无环、无悬空边、每点恰好 3 题、难度均值在区间内。"
    "章节目标把选中的章展开成 targets + 跨章先修点，图谱始终完整；预算变化只改变装包结果，不改变图谱与排序规则。"
)
h2 = doc.add_paragraph("（四）检索、引用与文档", style="Heading 2")
body(
    "文档生命周期：浏览器算 SHA-256 → 512KiB 分片幂等上传 → 服务端校验大小与哈希 → PDF 按真实页码解析 / 扫描页 OCR → "
    "切块（500 字 + 50 字重叠）→ 单条 SQL 原子发布文档与全部片段。检索按 token 预算整段选取，不截半段；"
    "引用保留文档 ID、文件名、页码与 OCR 标记，跨设备与会话分支继承同一份来源。"
)
h2 = doc.add_paragraph("（五）Supervisor 状态机", style="Heading 2")
body(
    "`WorkflowSnapshot` 是前后端共用的 Zod 契约：`runId / targetId / intent / focusKcId / budgetMinutes / resumedTurns / "
    "stages / plan / exercise / verification / status / persisted`。状态从 running 到 complete 或 awaiting_answer；"
    "检查点用 revision CAS 保存，并发只有一条能替换同版本；作答用稳定 `attemptId = runId:questionId` 幂等写入，"
    "冲突重试最多三次，已提交后换答案返回 409。"
)
h2 = doc.add_paragraph("（六）存储与一致性", style="Heading 2")
body(
    "17 张表覆盖账号、会话、进度、方向、选题、题目、密钥、知识库、片段向量、MCP、记忆卡与教学检查点。"
    "知识库写入用单一事务 + 删除墓碑，避免跨设备在途上传复活旧文档；进度用 `updated_at` 作 revision 做原子条件更新，"
    "过期返回 409；文档分片、检查点与估算缓存进入 `learning_artifacts`，临时原文件成功后删除。"
)
h2 = doc.add_paragraph("（七）安全实现", style="Heading 2")
body(
    "AES-256-GCM 的 AAD 绑定用户与用途，主密钥缺失返回 503 而不是明文；SSRF 先校验协议与主机形状，再解析 DNS 并固定 IP；"
    "API 统一同源校验、请求体上限与按 IP 限流；`check:secrets` 在提交前扫描全仓库。"
)
table(
    "表6  核心模块",
    ["模块", "职责"],
    [
        ["src/lib/plan.ts", "排序、预算装包、反事实、双指纹、先修校验（纯函数）"],
        ["src/lib/mastery.ts", "Beta 后验、sd、P(已掌握)、预测正确率"],
        ["src/lib/graph.ts / chapters.ts", "先修闭包、拓扑序、章节收窄与跨章先修点"],
        ["src/lib/rag.ts / kbVector.ts", "BM25、RRF、向量读写、域外门控、引用核对"],
        ["src/lib/agent.ts / learningWorkflow.ts", "有界工具循环、Supervisor 路由、检查点"],
        ["src/lib/documentStore.ts / documentParser.ts", "分片上传、PDF / OCR 解析、原子发布"],
        ["src/lib/mcpClient.ts / mcpStore.ts", "MCP 会话、工具发现、加密鉴权头"],
        ["src/components/app-shell.tsx", "桌面侧栏、移动底栏、命令菜单、账号弹窗"],
    ],
    [6.2, 9.2],
)
table(
    "表7  关键参数",
    ["参数", "值", "出处"],
    [
        ["BM25 K1 / B", "1.5 / 0.75", "src/lib/rag.ts"],
        ["RRF k / 候选 / top", "60 / 20 / 3", "src/lib/rag.ts"],
        ["向量维度 / 余弦阈值", "512 / 0.25", "src/lib/kbVector.ts"],
        ["Agent 步数 / 并行 / 超时", "8 / 5 / 20s", "ALP_AGENT_*"],
        ["单结果 / 整轮 / 单模型", "4000 字符 / 180s / 60s", "ALP_AGENT_*"],
        ["文档分片 / 切块", "512KiB / 500+50 字", "documentStore.ts"],
        ["密码哈希", "PBKDF2-SHA256 600k", "src/lib/auth.ts"],
    ],
    [5.0, 5.6, 4.4],
)

h1 = doc.add_paragraph("七、系统展示", style="Heading 1")
body(
    "以下截图均来自 2026-11-18 本机生产构建（1440×960 桌面、390×844 手机），"
    "使用未登录的干净会话采集，不包含密钥、手机号或个人邮箱。"
)
figure_grid([
    ("home.png", "图1  学习概览：今天先学什么与预算预览", 7.3),
    ("diagnose.png", "图2  课程诊断：先修顺序、预测与掌握度", 7.3),
])
figure_grid([
    ("path.png", "图3  学习地图：预算、图谱与本次学习顺序", 7.3),
    ("tutor.png", "图4  课程导师：教材 / 对话双栏与三档帮助", 7.3),
])
figure_grid([
    ("settings.png", "图5  设置：外观、布局与六套配色", 7.3),
    ("directions.png", "图6  我的课程：一句话生成与课程管理", 7.3),
])
figure_grid([
    ("mistakes.png", "图7  错题本：按知识点汇总与重做入口", 7.3),
    ("about.png", "图8  关于项目：算法口径、边界与验证", 7.3),
])
figure_grid([
    ("mobile-home.png", "图9  手机端学习概览", 4.4),
    ("mobile-tutor.png", "图10  手机端课程导师", 4.4),
])

h1 = doc.add_paragraph("八、工程验证与复现", style="Heading 1")
h2 = doc.add_paragraph("（一）门禁结果", style="Heading 2")
table(
    "表8  提交前门禁（2026-11-18 本机）",
    ["命令", "验证什么", "本轮结果"],
    [
        ["npm run typecheck", "TypeScript strict", "exit 0"],
        ["npm run test", "单元测试", "116 个文件 / 2207 条通过"],
        ["npm run kg:validate", "图谱完整性", "9 学科 / 360 点 / 540 边 / 1080 题 / 0 error"],
        ["npm run check:secrets", "仓库无真实密钥", "466 个文件 / 0 命中"],
        ["npm run lint", "ESLint", "0 error / 0 warning"],
        ["npm run build", "生产构建", "exit 0；11 页面 + 25 API"],
        ["npm run eval:rag", "检索评测", "recall@3 1.000；OOD empty 1.000"],
        ["npm run eval:tutor", "导师 rubric", "10 条 × 8 维，硬门全过"],
    ],
    [4.6, 5.2, 5.6],
)
h2 = doc.add_paragraph("（二）端到端与性能", style="Heading 2")
body(
    "浏览器学习闭环 291 项、账号接口 36 项、MCP 协议 18 项通过（2026-11-04 实测，覆盖 1440 / 1280 / 853 / 390 / 360px）；"
    "本轮未重跑 E2E，单测与构建为 2026-11-18 实跑。首页 Canvas 在 Chromium 6 倍 CPU 降速的 2 秒窗口绘制约 30fps，"
    "单次位图复制最大 1.60ms；六套主题的正文与次要文字满足 WCAG AA。"
)
h2 = doc.add_paragraph("（三）复现命令", style="Heading 2")
table(
    "表9  复现命令",
    ["命令", "作用"],
    [
        ["npm install", "安装依赖（Node ≥ 22.13）"],
        ["npm run dev", "本地开发（无需环境变量即可使用核心链路）"],
        ["npm run verify", "typecheck + test + kg + secrets + eval:tutor"],
        ["npm run build", "生产构建"],
        ["npm run test:e2e", "隔离内存库与本机可控模型的浏览器回归"],
        ["npm run eval:rag", "50 条检索评测"],
        ["npm run eval:rag:hard", "片段级 hard 集（nDCG@10 / recall@20 / bootstrap）"],
        ["node scripts/fetch-model.mjs", "预取本地 512 维嵌入资产"],
        ["npx tsx scripts/db-migrate.ts", "执行 17 张表的迁移"],
    ],
    [6.6, 8.8],
)
h2 = doc.add_paragraph("（四）部署", style="Heading 2")
body(
    "Vercel + Neon Postgres 部署；`DATABASE_URL` 承载 17 张表，`ALP_SECRET_KEY` 是服务端密钥的根，缺失时拒绝保存而不是明文。"
    "自托管反向代理需要对 `/api/llm/chat` 与 `/api/agent` 关闭 `proxy_buffering`，否则 SSE 会被缓冲。"
    "完整环境变量、限流与 nginx 示例见仓库 `docs/deploy.md`。"
)

h1 = doc.add_paragraph("九、发表、获奖与项目沿革", style="Heading 1")
h2 = doc.add_paragraph("（一）原创声明", style="Heading 2")
body(
    "本项目不是 fork，也不是对现有项目的二次开发；代码在本仓库内独立实现，仓库中没有第三方源码目录。"
    "调研阶段阅读了两个开源实现的产品思路（会话式 Web 应用、PDF 分页文本抽取），吸收的是交互与解析思路，没有复制代码。"
    "与它们相比，本项目把先修 DAG、Beta 后验、可复现路径指纹、预算反事实、有界教学工作流、pgvector 与多模态输入"
    "放在同一条学习闭环里。"
)
h2 = doc.add_paragraph("（二）发表与获奖", style="Heading 2")
body(
    "没有。本项目是为 2026 第九届传智杯 AI WEB 网页开发挑战赛新做的参赛作品，此前未公开发表、未获得任何奖项，"
    "也没有使用真实学生数据或商业数据集。"
)
h2 = doc.add_paragraph("（三）项目沿革", style="Heading 2")
table(
    "表10  里程碑",
    ["时间", "进展"],
    [
        ["2026-10 上旬", "规则整理、选题调研、先修 DAG 与 Beta 后验原型"],
        ["2026-10-21", "赛道规则结构化，确定「可复现路径」主线"],
        ["2026-10-30", "能力升级：Agent、MCP、pgvector、本地嵌入、多模态、人格"],
        ["2026-11-04", "UI V3：首页、诊断、图谱、导师双栏与移动端；错题本与进度合并"],
        ["2026-11-09", "Learning Supervisor：五意图、三类工作流、检查点与练习闭环"],
        ["2026-11-12", "服务端文档分片、OCR、原子发布与学习时长编排"],
        ["2026-11-18", "省赛提交：2207 条单测、11 页面 + 25 API、作品文档与演示视频"],
    ],
    [3.6, 11.4],
)

h1 = doc.add_paragraph("十、局限与后续", style="Heading 1")
body(
    "**教师班级视图未实现**：现在只有「一个学生一份进度」，没有班级聚合与「谁卡在哪」的视图，这是产品叙事里最大的一块空白。"
    "**没有真实学生数据**：掌握度数字来自自测与构造快照，不是教学现场采集；4 个新学科未经任课教师逐题复核。"
    "**未做 Lighthouse / Core Web Vitals 实测**：只有 Canvas 帧率与主题对比度，没有 LCP / INP / CLS 数字。"
)
body(
    "**检索收益未证明**：50 条评测已饱和，hard 集只有 22 查询 / 18 片段，向量与 RRF 臂未测，不能宣称「向量带来提升」。"
    "**真实第三方链路未重测**：Neon 向量、真实 MCP 服务器、真机 TTS 与 PDF worker 的本轮端到端仍未完成；"
    "**跨实例限流未做**：当前是进程内按 IP 限流，serverless 多实例需要平台或反向代理层补分布式限流。"
)
body(
    "后续优先级：教师只读聚合与 CSV 导出 → 真实试点与学习效果验证 → hard 集扩充与配对 bootstrap → "
    "真实第三方 MCP / TTS / 向量链路的 E2E → PDF worker 与浏览器推理的真机取证。"
)

h1 = doc.add_paragraph("附录 A  实测数字与复现", style="Heading 1")
table(
    "表11  实测数字",
    ["项目", "值", "命令"],
    [
        ["测试", "2207 passed / 116 files", "npm run test"],
        ["类型", "exit 0", "npm run typecheck"],
        ["构建", "11 页面 + 25 API，exit 0", "npm run build"],
        ["图谱", "9 学科 / 360 点 / 540 边 / 1080 题", "npm run kg:validate"],
        ["密钥", "466 文件 0 命中", "npm run check:secrets"],
        ["检索", "recall@3 1.000；OOD empty 1.000", "npm run eval:rag"],
        ["hard 集", "nDCG@10 0.955（22 查询 / 18 片段）", "npm run eval:rag:hard"],
        ["导师", "10 条 rubric，硬门全过", "npm run eval:tutor"],
        ["浏览器", "学习 291 / 账号 36 / MCP 18", "npm run test:e2e（2026-11-04）"],
        ["Canvas", "约 30fps @ 6× CPU 降速", "scripts/visual-canvas-smoke.ts"],
    ],
    [3.2, 7.6, 5.0],
)

h1 = doc.add_paragraph("附录 B  边界与不能宣称", style="Heading 1")
for text in [
    "教师班级视图、真实教学效果与学习时长标签尚未验证；掌握度数字不是教学现场采集。",
    "4 个新学科未经任课教师逐题复核；9 学科 1080 题的难度标注仍需教师确认。",
    "50 条检索评测已饱和，不能证明向量或重排有收益；hard 集规模小，向量 / RRF 臂未测。",
    "应用内带登录的真实模型 Agent E2E、真实第三方 MCP、真机 TTS 与 PDF worker 本轮未重测。",
    "Lighthouse / Core Web Vitals 未实测；Canvas 数字不包含完整 GPU 合成与低端真机。",
    "MCP 只支持 Streamable HTTP，不支持 stdio 与旧版 HTTP+SSE；Anthropic 协议暂不发 tools。",
    "本机（BYOK）模式不能用服务端 Agent；跨实例分布式限流未实现。",
]:
    bullet(text)

h1 = doc.add_paragraph("附录 C  术语表", style="Heading 1")
table(
    "表12  术语",
    ["术语", "含义"],
    [
        ["KC", "知识点（Knowledge Concept），路径与题目的最小单位"],
        ["ZPD", "最近发展区，这里用 |掌握度 − 目标| 度量距离"],
        ["Beta 后验", "用 α/β 维护掌握度分布，输出均值与标准差"],
        ["pathHash", "对步骤序列、算法版本、图谱版本取 SHA-256"],
        ["RRF", "Reciprocal Rank Fusion，按名次融合 BM25 与向量"],
        ["Supervisor", "教学工作流路由：学情路径 / 知识辅导 / 练习测评"],
        ["MCP", "Model Context Protocol，模型与外部工具的协议"],
        ["pgvector", "Postgres 的向量类型与相似度扩展"],
        ["BYOK", "Bring Your Own Key，本机模式由用户自带密钥"],
    ],
    [3.6, 11.0],
)

OUT.parent.mkdir(parents=True, exist_ok=True)
_removed = strip_cjk_latin_spaces(doc)
_autospace = disable_cjk_latin_autospace(doc)
doc.save(OUT)
print(f"saved {OUT}；stripped {_removed} spaces；patched {_autospace} paragraphs")
