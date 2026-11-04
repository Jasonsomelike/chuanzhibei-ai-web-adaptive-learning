import Link from "next/link";
import { Nav, Card, SectionTitle, ButtonLink } from "@/components/ui";
import { LearningDashboard } from "@/components/learning-dashboard";
import { SUBJECTS, allSubjectsStats } from "@/data/subjects";
import { ALGO_VERSION } from "@/lib/plan";
import { TEAM, teamLine } from "@/data/team";

export default function HomePage() {
  const stats = allSubjectsStats();
  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-6xl px-5 py-10 sm:py-14">
        <section className="mb-8 max-w-3xl">
          <p className="text-sm font-medium text-[var(--accent)]">智慧学伴 · 每一步，都有依据</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
            知道卡在哪里，<br />也知道下一步怎么学。
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-[var(--ink-soft)]">
            用几道题了解当前状态，按你的时间安排学习。读资料、问导师、再练习，让每一次作答帮助你调整方向。
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--ink-faint)]">
            <span>9 门课程可直接开始</span><span>无需密钥即可诊断与规划</span>
            <Link href="/guide" className="text-[var(--accent)] underline">第一次使用？查看指南 →</Link>
          </div>
        </section>

        <LearningDashboard />

        <section className="mb-10" aria-labelledby="journey-heading">
          <h2 id="journey-heading" className="mb-4 text-lg font-semibold">把一次学习，连成一个闭环</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { number: "01", title: "先了解自己", text: "诊断会区分尚未测评与需要巩固。没有作答记录时，我们先了解你的基础。", href: "/diagnose", action: "做一轮诊断" },
              { number: "02", title: "安排下一步", text: "选好能投入的时间，按先修关系排出步骤。每一步都能查看推荐依据，也能自己调整。", href: "/path", action: "查看学习路径" },
              { number: "03", title: "学懂，再验证", text: "结合教材和讲义提问，核对回答出处。用练习和到期复习，检验是否真的理解。", href: "/tutor", action: "打开课程导师" },
            ].map((step) => <Card key={step.number}>
              <span className="tabular text-sm text-[var(--accent)]">{step.number}</span>
              <h3 className="mt-2 font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-soft)]">{step.text}</p>
              <Link href={step.href} className="mt-4 inline-block text-sm text-[var(--accent)] underline">{step.action} →</Link>
            </Card>)}
          </div>
        </section>

        <section className="mb-10">
          <SectionTitle hint="选一门课直接开始，学习记录按课程分别保存。">从你正在学的课程开始</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SUBJECTS.map((subject) => <Link key={subject.id} href={`/diagnose?subject=${subject.id}`}
              className="group rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--accent)]">
              <h3 className="font-medium group-hover:text-[var(--accent)]">{subject.name}<span aria-hidden="true" className="float-right">↗</span></h3>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{subject.tagline}</p>
              <p className="mt-2 text-xs text-[var(--ink-faint)]">{subject.graph.concepts.length} 个知识点 · {subject.questions.length} 道题</p>
            </Link>)}
          </div>
        </section>

        <Card className="mb-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-2xl">
              <h2 className="text-lg font-semibold">让学伴读懂你的课程资料</h2>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">创建自定义方向，上传 Markdown、TXT 或带文本层的 PDF。提问时检索原文，回答标注出处，学习内容与你的课程对齐。</p>
            </div>
            <ButtonLink href="/directions?kb=open" variant="ghost">创建方向与上传资料 →</ButtonLink>
          </div>
        </Card>

        <details className="rounded-xl border border-[var(--line)] p-5">
          <summary className="cursor-pointer font-medium">为什么相信这份学习建议？</summary>
          <div className="mt-4 grid gap-4 text-sm text-[var(--ink-soft)] sm:grid-cols-3">
            <div><h3 className="font-medium text-[var(--ink)]">推荐有依据</h3><p className="mt-2">先修关系、作答证据和时间预算共同决定路径。Beta 后验同时记录估计与不确定性，未测评不等于不会。</p></div>
            <div><h3 className="font-medium text-[var(--ink)]">过程可复现</h3><p className="mt-2">相同输入生成相同路径，模型不可用时仍可诊断和规划。算法版本 {ALGO_VERSION}；{stats.reduce((sum, s) => sum + s.edges, 0)} 条先修关系。</p></div>
            <div><h3 className="font-medium text-[var(--ink)]">回答可核对</h3><p className="mt-2">导师引用课程或上传资料，并提供引用核对。资料中没有依据时明确说明；模型与检索可在设置中配置。</p></div>
          </div>
          <Link href="/about" className="mt-4 inline-block text-sm text-[var(--accent)] underline">查看算法、能力边界与团队</Link>
        </details>

        <footer className="mt-10 border-t border-[var(--line)] pt-5 text-xs text-[var(--ink-faint)]">
          <p>{teamLine()}</p><p className="mt-1">{TEAM.competition} · {TEAM.track}</p>
        </footer>
      </main>
    </>
  );
}
