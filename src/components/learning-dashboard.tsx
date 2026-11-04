"use client";

import { useMemo, useState } from "react";
import { ButtonLink, Card, Pill } from "@/components/ui";
import { SUBJECTS } from "@/data/subjects";
import { useSubject } from "@/lib/subject";
import { useLearner } from "@/lib/useLearner";
import { masteredSet, planPath } from "@/lib/plan";
import { targetQuery } from "@/lib/target";
import { dueMemories } from "@/lib/memory";

/** 首页展示真实学习状态，与诊断、路径使用同一份进度和规划器。 */
export function LearningDashboard() {
  const { target, targetId, setTargetId, ready, targetError } = useSubject();
  const { progress, ready: learnerReady, synced } = useLearner(targetId, target?.graph);
  const [budget, setBudget] = useState(30);
  const [now] = useState(() => new Date().toISOString());
  const plan = useMemo(() => target && progress ? planPath({
    graph: target.graph, mastery: progress.mastery, budgetMinutes: budget,
  }) : null, [target, progress, budget]);

  if (!ready || !learnerReady || !target || !progress || !plan) {
    return <Card className="mb-10"><p role="status" className="text-sm text-[var(--ink-soft)]">正在整理你的学习计划…</p></Card>;
  }

  const query = targetQuery(target);
  const attempted = progress.attempts.length;
  const observed = progress.mastery.filter((m) => m.evidenceN > 0).length;
  const mastered = masteredSet(progress.mastery.filter((m) => m.evidenceN > 0)).size;
  const due = dueMemories(progress.memories ?? [], now).length;
  const names = new Map(target.graph.concepts.map((c) => [c.id, c.name]));

  return (
    <section aria-labelledby="study-heading" className="mb-10 scroll-mt-24" id="study">
      <Card className="border-[var(--line-strong)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Pill tone="accent">我的学习</Pill>
            <h2 id="study-heading" className="mt-3 text-2xl font-semibold tracking-tight">
              {attempted > 0 ? "接着上次，继续前进" : "从一小步开始"}
            </h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)]">
              {attempted > 0 ? `已完成 ${attempted} 次作答。根据你的记录，安排接下来的学习。` : "选好学科，先做一轮诊断，看看哪些基础需要补上。无需登录或配置模型。"}
            </p>
          </div>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm">
            <span className="text-[var(--ink-soft)]">当前学习目标</span>
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)}
              className="max-w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2">
              {target.kind === "direction" ? <option value={target.id}>{target.name}</option> : null}
              {SUBJECTS.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
          </label>
        </div>
        {targetError ? <p role="alert" className="mt-3 text-sm text-[var(--bad)]">{targetError}</p> : null}
        <div className="mt-6 grid gap-6 border-t border-[var(--line)] pt-5 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <dl className="grid grid-cols-3 gap-3">
              {[
                { value: `${observed}/${target.graph.concepts.length}`, label: "已测知识点" },
                { value: mastered, label: "已达学习阈值" },
                { value: due, label: "到期复习卡" },
              ].map((item) => <div key={item.label}>
                <dd className="tabular text-2xl font-semibold">{item.value}</dd>
                <dt className="mt-1 text-xs text-[var(--ink-faint)]">{item.label}</dt>
              </div>)}
            </dl>
            <div className="mt-6 flex flex-wrap gap-2">
              <ButtonLink href={`/diagnose${query}`}>{attempted > 0 ? "继续诊断" : "开始诊断"}</ButtonLink>
              {due > 0 ? <ButtonLink href={`/diagnose${query}#memory-review`} variant="ghost">复习 {due} 张卡片</ButtonLink> : null}
              <ButtonLink href={`/tutor${query}`} variant="ghost">问学习导师</ButtonLink>
            </div>
            <p className="mt-3 text-xs text-[var(--ink-faint)]">
              {synced ? "已读取账号进度" : "记录保存在本浏览器，可登录同步到账号"}
            </p>
          </div>
          <div className="min-w-0 rounded-lg bg-[var(--canvas)] p-4">
            <fieldset>
              <legend className="mb-2 text-sm font-medium">这次有多少时间？</legend>
              <div className="flex flex-wrap gap-2">
                {[30, 60, 90].map((minutes) => <button key={minutes} type="button"
                  aria-pressed={budget === minutes} onClick={() => setBudget(minutes)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${budget === minutes ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]" : "border-[var(--line-strong)]"}`}>
                  {minutes} 分钟
                </button>)}
              </div>
            </fieldset>
            <p className="mt-3 text-xs text-[var(--ink-faint)]">
              {observed === 0 ? "尚未测评，以下按基础先修顺序建议；诊断后会更新。" : `本次建议 ${plan.steps.length} 步，预计 ${plan.totalMinutes} 分钟。`}
            </p>
            <ol className="mt-3 space-y-2">
              {plan.steps.slice(0, 3).map((step, index) => <li key={step.kcId} className="flex items-baseline gap-2 text-sm">
                <span className="tabular text-[var(--ink-faint)]">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 wrap-anywhere">{names.get(step.kcId)}</span>
                <span className="shrink-0 text-xs text-[var(--ink-faint)]">{step.estMinutes} 分钟</span>
              </li>)}
            </ol>
            {plan.steps.length === 0 ? <p className="mt-3 text-sm">当前知识点已达学习阈值，可以继续诊断或复习巩固。</p> : null}
            <div className="mt-4"><ButtonLink href={`/path${query}&budget=${budget}`} variant="ghost">查看完整计划 →</ButtonLink></div>
          </div>
        </div>
      </Card>
    </section>
  );
}
