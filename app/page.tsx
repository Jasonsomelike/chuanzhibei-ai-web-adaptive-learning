import Link from "next/link";
import { Nav, Card, SectionTitle, Pill, ButtonLink } from "@/components/ui";
import { MotionScope } from "@/components/motion";
import { SUBJECTS, allSubjectsStats } from "@/data/subjects";
import { ALGO_VERSION } from "@/lib/plan";
import { TEAM, teamLine } from "@/data/team";
import { THEMES } from "@/lib/themes";

export default function HomePage() {
  const stats = allSubjectsStats();
  const totalKc = stats.reduce((s, x) => s + x.concepts, 0);
  const totalQ = stats.reduce((s, x) => s + x.questions, 0);
  const totalEdge = stats.reduce((s, x) => s + x.edges, 0);

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-5xl px-5 py-10">
        <MotionScope>
        {/* 主张：一句话说清这个系统和普通推荐有什么区别 */}
        <section className="mb-12" data-motion="hero">
          <Pill tone="accent">{TEAM.track} · {TEAM.group}</Pill>
          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            给你一条
            <span className="text-[var(--accent)]">算得出、说得清、改得动</span>
            <br className="hidden sm:block" />
            的学习路径
          </h1>
          <p className="mt-4 max-w-2xl text-[var(--ink-soft)]">
            掌握度用难度加权的 Beta 后验建模，同时给出「你现在多会」和「我们有多确定」。
            排序由先修图、掌握度与时间预算用纯函数算出——
            <strong className="font-medium text-[var(--ink)]">大模型不参与排序</strong>，
            所以同一条路径可以逐位复现，大模型不可用时路径照常生成。
          </p>
          <p className="mt-2 max-w-2xl text-sm text-[var(--ink-faint)]">
            覆盖 {SUBJECTS.length} 个学科 · {totalKc} 个知识点 · {totalEdge} 条先修关系 ·{" "}
            {totalQ} 道题
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/diagnose">开始诊断</ButtonLink>
            <ButtonLink href="/path" variant="ghost">
              直接看路径
            </ButtonLink>
            <ButtonLink href="/guide" variant="ghost">
              使用指南
            </ButtonLink>
          </div>
        </section>

        {/* 三个可验证的承诺 */}
        <section className="mb-12">
          <SectionTitle hint="这三条不是宣传语，每一条都能在仓库里找到对应的实现与测试。">
            三个可验证的承诺
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card motion="promise">
              <h3 className="font-medium">路径可复现</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                同一个 attempt 快照 + 同一算法版本 → 同一条路径。
                `path_hash` 对输出取 SHA-256，算法或图谱一改，hash 立刻变，
                `npm test` 里的 golden 字面量会失败。
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--ink-faint)]">
                src/lib/plan.ts · {ALGO_VERSION}
              </p>
            </Card>
            <Card motion="promise">
              <h3 className="font-medium">理由可追溯</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                每一步都写明为什么排在这里，并引用具体的掌握度数值。
                大模型生成的解释必须标注引用了哪个知识点。
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--ink-faint)]">
                app/tutor/page.tsx · 引用从回复里解析
              </p>
            </Card>
            <Card motion="promise">
              <h3 className="font-medium">大模型可缺席</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                不配置任何密钥时，导师回答退化为知识库检索 + 题库解析的结构化拼装，
                依然可用。这是设计选择，不是兜底话术。
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--ink-faint)]">
                src/lib/provider.ts
              </p>
            </Card>
          </div>
        </section>

        {/* 上传教材：最容易被忽略的能力，给一个显眼的直达入口 */}
        <section className="mb-12">
          <Card className="border-[var(--accent)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <h3 className="font-medium">上传自己的教材、讲义或 PPT 文字稿</h3>
                <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
                  自定义方向支持上传 Markdown / TXT / 带文本层的 PDF：导师回答会检索你上传的片段并标注出处，
                  绑定知识点后还会进入出题依据。解析全部在本浏览器完成，不保存原始文件。
                </p>
              </div>
              <ButtonLink href="/directions?kb=open">去上传教材</ButtonLink>
            </div>
          </Card>
        </section>

        {/* 学科列表 */}
        <section className="mb-12">
          <SectionTitle hint="每个学科规模一致，是为了共用同一套模型参数与界面。">
            支持的学科
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {SUBJECTS.map((s) => {
              const st = stats.find((x) => x.id === s.id)!;
              return (
                <Card key={s.id} motion="subject">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-medium">{s.name}</h3>
                    <span className="tabular shrink-0 text-xs text-[var(--ink-faint)]">
                      {st.concepts} 点 / {st.questions} 题
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-[var(--ink-soft)]">{s.tagline}</p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {s.syllabus} · {st.chapters} 章
                  </p>
                </Card>
              );
            })}
          </div>
        </section>

        {/* 主题与个性化 */}
        <section className="mb-12">
          <SectionTitle hint="配色不是拍脑袋定的：每套都实算过对比度。正文与次要文字达到 WCAG AAA（≥7:1），分隔线等非文本元素达到 AA（≥3:1）。">
            个性化
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card motion="personalize">
              <h3 className="font-medium">{THEMES.length} 套配色主题</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                {THEMES.map((t) => t.name).join(" · ")}
              </p>
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                配浅色 / 深色 / 跟随系统三种模式，共 {THEMES.length * 2} 个组合。
                正文对比度最低 15.50:1，次要文字最低 7.24:1。
              </p>
              <Link href="/settings?panel=appearance" className="mt-3 inline-block text-sm text-[var(--accent)] underline">
                切换主题
              </Link>
            </Card>
            <Card motion="personalize">
              <h3 className="font-medium">自带模型供应商</h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">
                地址、密钥、模型名自己填，支持 OpenAI 兼容与 Anthropic 两种协议。
                内置 DeepSeek / OpenAI / Claude / 通义 / Kimi / 智谱 预设，也可填任意自建端点。
              </p>
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                密钥只存本浏览器，请求由浏览器直连供应商，不经过本项目后端。
              </p>
              <Link href="/settings?panel=provider" className="mt-3 inline-block text-sm text-[var(--accent)] underline">
                配置供应商
              </Link>
            </Card>
          </div>
        </section>

        {/* 参赛团队 */}
        <section>
          <SectionTitle hint={`${TEAM.competition} · ${TEAM.track}`}>
            参赛团队
          </SectionTitle>
          <Card motion="team">
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-[var(--ink-soft)]">团队</p>
                <p className="mt-1 font-medium">
                  {TEAM.name}
                  <span className="tabular ml-2 text-sm text-[var(--ink-faint)]">
                    #{TEAM.id}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--ink-soft)]">院校与组别</p>
                <p className="mt-1 font-medium">
                  {TEAM.school} · {TEAM.group}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--ink-soft)]">指导教师</p>
                <p className="mt-1 font-medium">{TEAM.advisor}</p>
              </div>
            </div>
            <p className="mt-4 border-t border-[var(--line)] pt-4 text-sm text-[var(--ink-soft)]">
              成员：{TEAM.members.map((m) => m.name).join(" · ")} ·{" "}
              <Link href="/about" className="text-[var(--accent)] underline">
                了解团队与功能
              </Link>
            </p>
          </Card>
        </section>

        <footer
          data-motion="footer"
          className="mt-12 border-t border-[var(--line)] pt-6 text-sm text-[var(--ink-faint)]"
        >
          <p>{teamLine()}</p>
          <p className="mt-1">
            {TEAM.competition} · {TEAM.track}
          </p>
        </footer>
        </MotionScope>
      </main>
    </>
  );
}
