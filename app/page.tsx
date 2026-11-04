import Link from "next/link";
import { Nav, Card, SectionTitle, ButtonLink } from "@/components/ui";
import { LearningDashboard } from "@/components/learning-dashboard";
import { SUBJECTS, allSubjectsStats } from "@/data/subjects";
import { ALGO_VERSION } from "@/lib/plan";
import { TEAM, teamLine } from "@/data/team";
import { Icon } from "@/components/icons";

export default function HomePage() {
  const stats = allSubjectsStats();
  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-7xl px-5 pb-10 sm:px-8">
        <LearningDashboard />


        <section className="mb-10">
          <SectionTitle hint="9 门课程，学习记录分别保存。选一门课，直接开始。">从你正在学的课程开始</SectionTitle>
          <div className="border-t border-[var(--line)]">
            {SUBJECTS.map((subject) => <Link key={subject.id} href={`/diagnose?subject=${subject.id}`}
              className="course-row group">
              <h3 className="flex items-center gap-3 text-sm font-medium group-hover:text-[var(--accent)]"><Icon name="layers" size={19} className="shrink-0 text-[var(--ink-faint)]" />{subject.name}</h3>
              <p className="course-description text-xs leading-relaxed text-[var(--ink-soft)] sm:text-sm">{subject.tagline}</p>
              <span className="flex items-center gap-3 text-xs text-[var(--accent)] sm:text-sm">开始学习<Icon name="arrow" size={17} /></span>
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
