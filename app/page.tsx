import { Nav, Card, SectionTitle, Pill, ButtonLink } from "@/components/ui";
import { datasetStats } from "@/lib/dataset";
import { ALGO_VERSION } from "@/lib/plan";
import { knowledgeGraph } from "@/data/knowledge-graph";

export default function HomePage() {
  const stats = datasetStats();

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-5xl px-5 py-10">
        {/* 主张：一句话说清这个系统和普通推荐有什么区别 */}
        <section className="mb-12">
          <Pill tone="accent">传智杯 AI WEB 网页开发挑战赛 · B 组</Pill>
          <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            给你一条
            <span className="text-[var(--color-accent)]">算得出、说得清、改得动</span>
            <br className="hidden sm:block" />
            的数据结构学习路径
          </h1>
          <p className="mt-4 max-w-2xl text-[var(--color-ink-soft)]">
            掌握度用难度加权的 Beta 后验建模，同时给出「你现在多会」和「我们有多确定」。
            排序由先修图、掌握度与时间预算用纯函数算出——
            <strong className="font-medium text-[var(--color-ink)]">大模型不参与排序</strong>，
            所以同一条路径可以逐位复现，大模型不可用时路径照常生成。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/diagnose">开始诊断</ButtonLink>
            <ButtonLink href="/path" variant="ghost">
              直接看路径
            </ButtonLink>
          </div>
        </section>

        {/* 三个可验证的承诺，每条都指向具体的代码位置 */}
        <section className="mb-12">
          <SectionTitle hint="这三条不是宣传语，每一条都能在仓库里找到对应的实现与测试。">
            三个可验证的承诺
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <h3 className="font-medium">路径可复现</h3>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                同一输入 + 同一版本 → 同一路径。`path_hash` 对输出取 SHA-256，
                算法或图谱一改，hash 立刻变，CI 会红。
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--color-ink-faint)]">
                src/lib/plan.ts · ALGO_VERSION={ALGO_VERSION}
              </p>
            </Card>
            <Card>
              <h3 className="font-medium">理由可追溯</h3>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                每一步都写明为什么排在这里，并引用具体的掌握度数值。
                大模型生成的解释必须标注引用了哪个知识点。
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--color-ink-faint)]">
                src/lib/llm.ts · 引用强制带 kcId
              </p>
            </Card>
            <Card>
              <h3 className="font-medium">大模型可缺席</h3>
              <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                没配 API key 时，导师回答退化为知识库检索 + 题库解析的结构化拼装，
                依然可用。这是「LLM 不是必需品」的实现，不是兜底话术。
              </p>
              <p className="mt-3 font-mono text-xs text-[var(--color-ink-faint)]">
                src/lib/llm.ts · composeDeterministicAnswer
              </p>
            </Card>
          </div>
        </section>

        {/* 课程数据 */}
        <section className="mb-12">
          <SectionTitle hint="数据规模决定了「几个题够用」，所以这些数字都经过校验脚本检查。">
            当前课程
          </SectionTitle>
          <Card>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <div>
                <dt className="text-sm text-[var(--color-ink-soft)]">课程</dt>
                <dd className="mt-1 font-medium">数据结构</dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--color-ink-soft)]">知识点</dt>
                <dd className="tabular mt-1 font-medium">{stats.kcCount} 个</dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--color-ink-soft)]">先修关系</dt>
                <dd className="tabular mt-1 font-medium">{stats.edgeCount} 条</dd>
              </div>
              <div>
                <dt className="text-sm text-[var(--color-ink-soft)]">题库</dt>
                <dd className="tabular mt-1 font-medium">{stats.qCount} 道</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-[var(--color-line)] pt-4 text-sm text-[var(--color-ink-soft)]">
              每个知识点 3 道题，难度覆盖易/中/难。难度均值{" "}
              <span className="tabular font-medium text-[var(--color-ink)]">
                {stats.meanDifficulty.toFixed(2)}
              </span>
              ——这个值决定「3 题是否足以让不确定度降到阈值以下」，
              所以它被校验脚本单独盯着，偏离设计假设会给出警告。
            </p>
          </Card>
        </section>

        {/* 章节概览 */}
        <section>
          <SectionTitle hint="点击任意知识点可以先看它依赖什么、又被谁依赖。">
            知识图谱覆盖
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {groupByChapter().map(({ chapter, concepts }) => (
              <Card key={chapter}>
                <h3 className="text-sm font-medium">{chapter}</h3>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
                  {concepts.slice(0, 4).join("、")}
                  {concepts.length > 4 ? ` 等 ${concepts.length} 个` : ""}
                </p>
              </Card>
            ))}
          </div>
        </section>

        <footer className="mt-12 border-t border-[var(--color-line)] pt-6 text-sm text-[var(--color-ink-faint)]">
          <p>
            胆子肥嘟嘟队 · 北京电子科技学院 · B 组 · 团队编号 38543
          </p>
          <p className="mt-1">
            图谱版本 {knowledgeGraph.version} · 算法版本 {ALGO_VERSION}
          </p>
        </footer>
      </main>
    </>
  );
}

function groupByChapter() {
  const map = new Map<string, string[]>();
  for (const c of knowledgeGraph.concepts) {
    const list = map.get(c.chapter) ?? [];
    list.push(c.name);
    map.set(c.chapter, list);
  }
  return [...map.entries()].map(([chapter, concepts]) => ({ chapter, concepts }));
}
