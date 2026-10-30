import Link from "next/link";
import { Nav, Card, SectionTitle, Pill, ButtonLink } from "@/components/ui";
import { MotionScope } from "@/components/motion";
import { TEAM, SCHEDULE } from "@/data/team";
import { SUBJECTS, allSubjectsStats } from "@/data/subjects";
import { ALGO_VERSION } from "@/lib/plan";
import { THEMES } from "@/lib/themes";

/**
 * 关于页：功能说明 + 团队介绍。
 *
 * 单独成页而不是塞在首页，是因为评审和老师打开链接时，
 * 第一件想知道的是「这是谁做的、做了什么、能信吗」。
 * 首页用来演示，这一页用来交代。
 */

export default function AboutPage() {
  const stats = allSubjectsStats();
  const totalKc = stats.reduce((s, x) => s + x.concepts, 0);
  const totalQ = stats.reduce((s, x) => s + x.questions, 0);
  const totalEdge = stats.reduce((s, x) => s + x.edges, 0);

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <MotionScope>
        <div className="mb-8" data-motion="hero">
          <Pill tone="accent">{TEAM.competition}</Pill>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            可解释的自适应学习路径
          </h1>
          <p className="mt-2 text-[var(--ink-soft)]">
            面向高校硬课的学生与任课教师，做一张算得出、说得清、改得动的学习路径图。
            当前覆盖 {SUBJECTS.length} 个学科、{totalKc} 个知识点、{totalQ} 道题。
          </p>
        </div>

        {/* ── 功能 ── */}
        <section className="mb-10">
          <SectionTitle hint="每个功能都对应评分表里的具体考察点，不是堆砌。">
            这个应用能做什么
          </SectionTitle>

          <div className="space-y-3">
            <Feature
              title="诊断测评"
              href="/diagnose"
              points={[
                "按先修顺序出题，不会让你跳过前置知识直接做题",
                "每答一题立即更新掌握度，并显示这一题带来的变化",
                "掌握度带不确定度：显示「已测 3 题 · 68%（±19）」而不是一个光秃秃的百分比",
                "9 个学科的掌握度独立计算，互不污染",
              ]}
            />
            <Feature
              title="学习路径"
              href="/path"
              points={[
                "按时间预算生成路径，改预算立刻重算，无需等待",
                "反事实对比：选一个对照预算，标出哪些步骤会被推迟",
                "手动改写：可以用 ↑ / ↓ 调整顺序或删除任何一步，系统实时标出是否违反先修约束",
                "路径指纹：对输出取 SHA-256，同一输入永远得到同一指纹",
              ]}
            />
            <Feature
              title="课程导师"
              href="/tutor"
              points={[
                "回答优先依据课程知识库；引用只列回复里真正出现的知识点，没有引用会如实说明",
                "检索用 BM25 中文 bigram，不依赖向量数据库",
                "没配置大模型时仍可用，退化为检索拼装并如实标注",
              ]}
            />
            <Feature
              title="自定义学习方向"
              href="/directions"
              points={[
                "用一句自然语言描述想学什么，系统拆成带先修关系的知识点图谱",
                "配了模型由大模型按 schema 生成，没配则从现有学科挑选相关知识点",
                "生成结果必须通过严格校验：无环、边不悬空、知识点 5–20 个",
                "可以选择公开，让其他人也能用",
              ]}
            />
            <Feature
              title="方向市场"
              href="/market"
              points={[
                "浏览其他人公开的学习方向，未登录也能看",
                "搜索标题与描述，找到相近的学习主题",
                "选用后复制一份到自己名下，默认私有，可自行修改与公开",
                "只有作者本人能改标题、描述与公开状态",
              ]}
            />
            <Feature
              title="账号与进度同步"
              href="/login"
              points={[
                "邮箱注册即可，不需要验证邮箱",
                "密码用 PBKDF2-HMAC-SHA256 加盐哈希存储，不存明文",
                "登录后进度存在服务端，换设备能继续",
                "不登录也能完整使用，进度留在本浏览器",
              ]}
            />
            <Feature
              title="模型供应商设置"
              href="/settings"
              points={[
                "地址、密钥、模型名全部自己填，支持 OpenAI 兼容与 Anthropic 两种协议",
                "内置 DeepSeek / OpenAI / Claude / 通义 / Kimi / 智谱 预设",
                "一键测试连通性，会真实发一次对话请求验证 key 与模型名",
                "两种调用模式：服务端模式把密钥加密存进账号、由本项目代发；本机模式密钥只存本浏览器、浏览器直连供应商",
                "服务端模式需要登录；未登录时按本机模式工作，不会假装保存成功",
              ]}
            />
            <Feature
              title="外观主题"
              href="/settings"
              points={[
                `${THEMES.length} 套配色 × 明暗两种模式，共 ${THEMES.length * 2} 个组合`,
                "正文与次要文字通过 WCAG AAA（≥7:1），非文本元素按 AA；对比度由脚本实算而非估计",
                "深色下中文正文自动加字重，避免笔画发虚",
              ]}
            />
            <Feature
              title="MCP 端点"
              href="/api/mcp"
              points={[
                "实现 MCP 三种原语：tools 5 个 / resources 18 个 / prompts 2 个",
                "任何支持 MCP 的客户端都能把本课程的知识图谱当工具调用",
                "只接受 POST（JSON-RPC 2.0）；GET 明确返回 405，不把「能打开」当成协议入口",
              ]}
            />
          </div>
        </section>

        {/* ── 三个可验证的承诺 ── */}
        <section className="mb-10">
          <SectionTitle hint="这三条都能在仓库里找到实现与测试，不是宣传语。">
            三个可验证的承诺
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card motion="promise">
              <h3 className="font-medium">路径可复现</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                排序是纯函数，不调大模型。同输入同版本 → 同指纹，
                算法或图谱一改指纹立刻变。
              </p>
              <p className="mt-2 font-mono text-xs text-[var(--ink-faint)]">
                src/lib/plan.ts · {ALGO_VERSION}
              </p>
            </Card>
            <Card motion="promise">
              <h3 className="font-medium">理由可追溯</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                每一步都写明为什么排在这，并引用具体掌握度数值。
                大模型生成的解释必须标注引用来源。
              </p>
              <p className="mt-2 font-mono text-xs text-[var(--ink-faint)]">
                src/lib/direction.ts
              </p>
            </Card>
            <Card motion="promise">
              <h3 className="font-medium">大模型可缺席</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                不配置任何密钥，诊断、路径与自定义方向仍可用。
                这是设计选择，不是降级兜底。
              </p>
              <p className="mt-2 font-mono text-xs text-[var(--ink-faint)]">
                src/lib/provider.ts
              </p>
            </Card>
          </div>
        </section>

        {/* ── 学科覆盖 ── */}
        <section className="mb-10">
          <SectionTitle
            hint={`共 ${totalKc} 个知识点 / ${totalEdge} 条先修边 / ${totalQ} 道题。每个学科规模一致，是为了共用同一套模型参数。`}
          >
            学科覆盖
          </SectionTitle>
          <Card motion="section">
            <div className="space-y-3">
              {SUBJECTS.map((s) => {
                const st = stats.find((x) => x.id === s.id)!;
                return (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--line)] pb-3 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-[var(--ink-faint)]">
                        {s.tagline} · {s.syllabus}
                      </p>
                    </div>
                    <p className="tabular shrink-0 text-xs text-[var(--ink-soft)]">
                      {st.concepts} 点 / {st.edges} 边 / {st.questions} 题 · {st.chapters} 章
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>

        {/* ── 团队 ── */}
        <section className="mb-10">
          <SectionTitle hint={`${TEAM.competition} · ${TEAM.track}（${TEAM.trackType}）`}>
            关于我们
          </SectionTitle>
          <Card motion="section">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-[var(--ink-soft)]">团队</dt>
                <dd className="mt-1 font-medium">
                  {TEAM.name}
                  <span className="tabular ml-2 text-sm text-[var(--ink-faint)]">
                    #{TEAM.id}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--ink-soft)]">院校与组别</dt>
                <dd className="mt-1 font-medium">
                  {TEAM.school} · {TEAM.group}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--ink-soft)]">指导教师</dt>
                <dd className="mt-1 font-medium">{TEAM.advisor}</dd>
              </div>
            </dl>

            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <p className="text-sm text-[var(--ink-soft)]">成员</p>
              <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                {TEAM.members.map((m) => (
                  <li key={m.name} className="font-medium">
                    {m.name}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <p className="text-sm text-[var(--ink-soft)]">赛程</p>
              <ul className="mt-2 space-y-1 text-sm">
                {SCHEDULE.map((s) => (
                  <li key={s.stage} className="flex flex-wrap items-baseline gap-x-2">
                    <span>{s.stage}</span>
                    <span className="tabular text-[var(--ink-soft)]">{s.deadline}</span>
                    {s.note ? (
                      <span className="text-xs text-[var(--ink-faint)]">{s.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <p className="mt-4 border-t border-[var(--line)] pt-4 text-xs text-[var(--ink-faint)]">
              联系方式按赛事要求在报名系统内提交，不写入公开页面。
            </p>
          </Card>
        </section>

        {/* ── 技术栈 ── */}
        <section className="mb-10">
          <SectionTitle>技术栈</SectionTitle>
          <Card motion="section">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ["框架", "Next.js 16 App Router + React 19"],
                ["语言", "TypeScript strict"],
                ["样式", "Tailwind CSS 4，CSS 变量驱动主题"],
                ["掌握度", "难度加权 Beta-Bernoulli 后验"],
                ["路径规划", "纯函数：先修闭包 → 深度+ZPD 排序 → 预算装包"],
                ["检索", "BM25 + 中文 bigram，进程内，无向量库"],
                ["方向生成", "LLM 按 schema 生成 + 代码严格校验"],
                ["认证", "PBKDF2-HMAC-SHA256 + 服务端会话"],
                ["存储", "Postgres（Neon）；本地无库时退化为内存"],
                ["工具协议", "MCP（JSON-RPC 2.0）"],
                ["测试", "Vitest 1721 条 + Playwright E2E + MCP 协议测试"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[var(--ink-soft)]">{k}</dt>
                  <dd className="mt-0.5">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </section>

        {/* ── 已知限制 ── */}
        <section className="mb-10">
          <SectionTitle hint="预指导阶段如实列出，不粉饰。">
            已知限制
          </SectionTitle>
          <Card motion="section">
            <ul className="space-y-2 text-sm text-[var(--ink-soft)]">
              <li>· 题库与图谱未经任课教师逐条签字确认，是初始版本</li>
              <li>· 没有真实学生使用数据，掌握度数字来自自测</li>
              <li>· 教师班级视图未实现，这是当前最大的功能缺口</li>
              <li>· 自定义方向没有内置题库，需要用模型生成或手动录题后才能诊断</li>
              <li>· 路径页是列表视图，未做图形化画布</li>
              <li>· 未做性能预算实测（Lighthouse / CWV）</li>
              <li>· 「本机」直连受 CORS 与混合内容约束；登录后可切到服务端代发绕开这两条限制</li>
            </ul>
          </Card>
        </section>

        <div className="flex flex-wrap gap-3" data-motion="cta">
          <ButtonLink href="/diagnose">开始使用</ButtonLink>
          <Link
            href="/settings"
            className="inline-flex items-center rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium"
          >
            配置模型供应商
          </Link>
        </div>
        </MotionScope>
      </main>
    </>
  );
}

function Feature({
  title,
  href,
  points,
}: {
  title: string;
  href: string;
  points: string[];
}) {
  return (
    <Card motion="feature">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-medium">{title}</h3>
        <Link href={href} className="shrink-0 text-xs text-[var(--accent)] underline">
          去试试
        </Link>
      </div>
      <ul className="mt-2 space-y-1 text-sm text-[var(--ink-soft)]">
        {points.map((p) => (
          <li key={p}>· {p}</li>
        ))}
      </ul>
    </Card>
  );
}
