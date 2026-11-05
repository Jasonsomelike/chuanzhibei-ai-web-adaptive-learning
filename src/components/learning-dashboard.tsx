"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { useStaggerIn } from "@/components/motion";
import { SUBJECTS } from "@/data/subjects";
import { useSubject } from "@/lib/subject";
import { useLearner } from "@/lib/useLearner";
import { masteredSet, planPath } from "@/lib/plan";
import { targetQuery } from "@/lib/target";
import { dueMemories } from "@/lib/memory";

/** Daily view: genuine attempts and existing planner, without writing evidence. */
export function LearningDashboard() {
  const { target, targetId, setTargetId, ready, targetError } = useSubject();
  const { learner, progress, ready: learnerReady, synced } = useLearner(targetId, target?.graph);
  const [budget, setBudget] = useState(30);
  const [now] = useState(() => new Date().toISOString());
  const root = useRef<HTMLElement>(null);
  useStaggerIn(root);
  const plan = useMemo(() => target && progress ? planPath({ graph: target.graph, mastery: progress.mastery, budgetMinutes: budget }) : null, [target, progress, budget]);
  const query = target ? targetQuery(target) : "";
  const attempts = progress?.attempts.filter(attempt => !attempt.retired) ?? [];
  const last = attempts.reduce<(typeof attempts)[number] | undefined>((latest, attempt) => !latest || attempt.at > latest.at ? attempt : latest, undefined);
  const due = progress ? dueMemories(progress.memories ?? [], now) : [];
  const names = new Map(target?.graph.concepts.map(concept => [concept.id, concept.name]));
  const observed = progress?.mastery.filter(item => item.evidenceN > 0).length ?? 0;
  const mastered = progress ? masteredSet(progress.mastery.filter(item => item.evidenceN > 0)).size : 0;
  const next = plan?.steps[0];
  const pathHref = `/path${query}${query ? "&" : "?"}budget=${budget}`;
  const continueHref = next ? `/tutor${query}&q=${encodeURIComponent(`请引导我学习${names.get(next.kcId)}，先给一个思考问题。`)}` : `/diagnose${query}`;
  const loaded = ready && learnerReady && target && progress && plan;
  const history = SUBJECTS.filter(subject => learner?.subjects[subject.id]?.attempts.length);

  return <section ref={root} className="daily-dashboard" aria-labelledby="study-heading" aria-busy={!loaded}>
    <div className="mb-6" data-motion="heading"><h1 id="study-heading" className="text-3xl font-semibold tracking-tight">今天先学什么？</h1><p className="mt-3 text-sm text-[var(--ink-soft)]">{last ? "接着当前课程学习，或查看本次安排。" : "先选择课程，做一次诊断来确定学习起点。"}</p></div>
    {loaded ? <>
      <div className="daily-overview" data-motion="overview">
        <div>
          <label className="block text-xs text-[var(--ink-faint)]" htmlFor="daily-course">当前课程</label>
          <select id="daily-course" aria-label="当前学习目标" value={targetId} onChange={event => setTargetId(event.target.value)} className="mt-2 w-full max-w-md rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] p-3 text-base font-medium">
            {target.kind === "direction" ? <option value={target.id}>{target.name}</option> : null}
            {SUBJECTS.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
          {targetError ? <p role="alert" className="mt-2 text-sm text-[var(--bad)]">{targetError}</p> : null}
          <dl className="mt-5 flex flex-wrap gap-6 text-sm">{[{label:"已测知识点",value:`${observed}/${target.graph.concepts.length}`},{label:"已达学习阈值",value:mastered},{label:"到期复习卡",value:due.length}].map(item => <div key={item.label}><dt className="text-xs text-[var(--ink-faint)]">{item.label}</dt><dd className="tabular mt-1 text-xl font-semibold">{item.value}</dd></div>)}</dl>
          <p className="mt-5 text-sm text-[var(--ink-soft)]">{last ? `最近作答：${names.get(last.kcId) ?? last.kcId} · ${new Date(last.at).toLocaleString("zh-CN")} · ${last.correct ? "答对" : "答错"}` : "尚无作答记录，未测评不代表不会。"}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href={last ? continueHref : `/diagnose${query}`}>{last ? "继续学习" : "开始诊断"}</ButtonLink>
            <ButtonLink href={pathHref} variant="ghost">查看完整计划</ButtonLink>
            {last ? <Link className="self-center text-sm text-[var(--accent)] underline" href={`/diagnose${query}`}>继续诊断</Link> : <Link className="self-center text-sm text-[var(--accent)] underline" href="/guide">查看使用指南</Link>}
          </div>
          <p className="mt-4 text-xs text-[var(--ink-faint)]">{synced ? "已读取账号进度" : "记录保存在本浏览器，登录后可同步。"}</p>
        </div>
        <div className="daily-task">
          <h2 className="text-lg font-semibold">本次学习安排</h2>
          <fieldset className="mt-4"><legend className="mb-2 text-xs text-[var(--ink-faint)]">可用学习时间</legend><div className="segmented">{[30,60,90].map(minutes => <button type="button" key={minutes} aria-pressed={budget === minutes} onClick={() => setBudget(minutes)}>{minutes} 分钟</button>)}</div></fieldset>
          <p className="mt-3 text-xs text-[var(--ink-faint)]" aria-live="polite">{last ? `建议 ${plan.steps.length} 步，预计 ${plan.totalMinutes} 分钟。` : "尚未测评，按先修顺序建议；诊断后更新。"}</p>
          {next ? <div className="mt-5"><p className="text-xs text-[var(--ink-faint)]">下一任务 · {next.estMinutes} 分钟</p><h3 className="mt-2 text-xl font-semibold">{names.get(next.kcId)}</h3><p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">{(progress.mastery.find(item => item.kcId === next.kcId)?.evidenceN ?? 0) > 0 ? next.reason : "尚无作答证据，先按先修顺序建立基础，再用练习确认。"}</p><Link className="mt-4 inline-block text-sm text-[var(--accent)] underline" href={continueHref}>学习这一步 →</Link></div> : <p className="mt-5 text-sm">本次范围内已无待学任务，可以诊断或复习巩固。</p>}
        </div>
      </div>
      <div className="daily-history" data-motion="history">
        <div><h2 className="text-base font-semibold">待复习内容</h2>{due.length ? <ul className="mt-3 space-y-2">{due.slice(0,3).map(item => <li key={item.id}><Link href={`/diagnose${query}#memory-review`} className="text-sm text-[var(--accent)] underline">{names.get(item.kcId) ?? item.kcId} · {item.kind === "error" ? "错题" : "易混知识点"}</Link></li>)}</ul> : <p className="mt-3 text-sm text-[var(--ink-faint)]">当前课程没有到期复习卡。</p>}</div>
        <div><h2 className="text-base font-semibold">课程学习记录</h2>{history.length ? <ul className="mt-3 space-y-2">{history.map(subject => <li key={subject.id} className="flex flex-wrap justify-between gap-2 text-sm"><Link href={`/path?subject=${subject.id}`} className="text-[var(--accent)] underline">{subject.name}</Link><span className="text-[var(--ink-faint)]">{learner?.subjects[subject.id]?.attempts.length} 次作答</span></li>)}</ul> : <p className="mt-3 text-sm text-[var(--ink-faint)]">完成作答后，这里会显示课程记录。</p>}</div>
      </div>
    </> : <p role="status" className="py-10 text-sm text-[var(--ink-faint)]">正在读取学习记录…</p>}
  </section>;
}
