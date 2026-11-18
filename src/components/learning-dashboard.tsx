"use client";

import { useLearningTime } from "@/lib/useLearningTime";
import { LearningTimeNote } from "@/components/learning-time-note";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Circle, CircleDot, PencilLine } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { useStaggerIn, useSwapIn } from "@/components/motion";
import { SUBJECTS } from "@/data/subjects";
import { useSubject } from "@/lib/subject";
import { useLearner } from "@/lib/useLearner";
import { planPath } from "@/lib/plan";
import { targetQuery } from "@/lib/target";
import { dueMemories } from "@/lib/memory";

function LearningSkeleton() {
  return <div className="overview-skeleton" role="status"><span className="sr-only">正在读取学习记录…</span>
    <div className="skeleton-top" aria-hidden="true">{[0, 1].map(i => <div key={i}><span className="skeleton-line heading" /><span className="skeleton-line short" /><span className="skeleton-line" /><span className="skeleton-line" /></div>)}</div>
    <div className="skeleton-bottom" aria-hidden="true"><span className="skeleton-line heading" />{[0, 1, 2, 3].map(i => <span key={i} className="skeleton-line" />)}</div>
  </div>;
}

export function LearningDashboard() {
  const { target, targetId, setTargetId, ready, targetError } = useSubject();
  const { learner, progress, ready: learnerReady, synced } = useLearner(targetId, target?.graph);
  const timing=useLearningTime(targetId,target?.graph,progress);
  const [budget, setBudget] = useState(60);
  const [now] = useState(() => new Date().toISOString());
  const root = useRef<HTMLElement>(null);
  useStaggerIn(root);
  const schedule = useRef<HTMLOListElement>(null);
  useSwapIn(schedule, `${targetId}:${budget}:${timing.source}`);
  const plan = useMemo(() => target && progress ? planPath({ graph: target.graph, mastery: progress.mastery, budgetMinutes: budget,timeEstimates:timing.estimates }) : null, [target, progress, budget,timing.estimates]);
  const query = target ? targetQuery(target) : "";
  const attempts = progress?.attempts.filter(attempt => !attempt.retired) ?? [];
  const last = attempts.reduce<(typeof attempts)[number] | undefined>((latest, attempt) => !latest || attempt.at > latest.at ? attempt : latest, undefined);
  const due = progress ? dueMemories(progress.memories ?? [], now) : [];
  const names = new Map(target?.graph.concepts.map(concept => [concept.id, concept.name]));
  const next = plan?.steps[0];
  const pathHref = `/path${query}${query ? "&" : "?"}budget=${budget}`;
  const studyHref = (id: string) => `/tutor${query}${query ? "&" : "?"}q=${encodeURIComponent(`请引导我学习${names.get(id) ?? id}，先给一个思考问题。`)}`;
  const loaded = ready && learnerReady && target && progress && plan;
  const courseIndex = SUBJECTS.filter(subject => subject.id !== targetId).slice(0, 2);
  const history = SUBJECTS.filter(subject => learner?.subjects[subject.id]?.attempts.length);

  return <section ref={root} className="daily-dashboard" aria-labelledby="study-heading" aria-busy={!loaded}>
    <div className="overview-heading" data-motion="heading">
      <h1 id="study-heading">学习概览</h1><p>选择课程，安排这次学习。</p>
      <select aria-label="当前学习目标" value={targetId} onChange={event => setTargetId(event.target.value)}>
        {target?.kind === "direction" ? <option value={target.id}>{target.name}</option> : null}
        {SUBJECTS.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
      </select>
    </div>
    {targetError ? <p role="alert" className="mb-4 text-sm text-[var(--bad)]">{targetError}</p> : null}
    {loaded ? <>
      <div className="overview-primary" data-motion="overview">
        <section className="daily-task" aria-label="下一项学习任务">
          <h2>今天先学什么？</h2>
          <p className="task-caption">当前课程<strong>{target.name}</strong></p>
          <div className="next-task-heading"><CircleDot size={22} /><div>
            <p className="text-sm font-medium text-[var(--accent)]">下一个学习任务</p>
            <h3>{next ? names.get(next.kcId) : "复习与巩固"}</h3>
            <p className="task-reason">{!last ? "尚未测评，先用几道题了解当前状态。" : next ? next.reason : "当前范围内已无待学步骤，可以复习或继续诊断。"}</p>
          </div></div>
          <div className="task-actions">
            <ButtonLink href={last && next ? studyHref(next.kcId) : `/diagnose${query}`}>{last && next ? "继续学习" : "开始诊断"}</ButtonLink>
            <Link href={pathHref} className="editorial-text-link">查看知识图谱<ArrowRight size={18} /></Link>
          </div>
        </section>
        <section className="overview-course-index" aria-labelledby="course-index-heading">
          <h2 id="course-index-heading">我的课程</h2>
          <ul><li><button type="button" aria-pressed="true" onClick={() => setTargetId(target.id)}><CircleDot />{target.name}</button></li>
            {courseIndex.map(subject => <li key={subject.id}><button type="button" aria-pressed="false" onClick={() => setTargetId(subject.id)}><Circle />{subject.name}</button></li>)}
          </ul><Link href="/directions" className="editorial-text-link">查看全部课程<ArrowRight size={18} /></Link>
        </section>
      </div>
      <div className="overview-secondary">
        <section aria-labelledby="session-heading">
          <div className="overview-section-heading"><h2 id="session-heading">本次学习安排</h2><fieldset><legend className="sr-only">可用学习时间</legend><div className="segmented">{[30, 60, 90].map(minutes => <button type="button" key={minutes} aria-pressed={budget === minutes} onClick={() => setBudget(minutes)}>{minutes} 分钟</button>)}</div></fieldset></div>
          <LearningTimeNote timing={timing}/>
          <div className="overview-steps">
            <p className="sr-only" aria-live="polite">建议 {plan.steps.length} 步，预计 {plan.totalMinutes} 分钟。{!last ? "尚未测评，按先修顺序建议；诊断后更新。" : ""}</p>
            {plan.steps.length ? <ol ref={schedule}>{plan.steps.slice(0, 4).map((step, index) => <li key={step.kcId}><span className="overview-step-number tabular">{index + 1}</span><div><Link href={`${pathHref}&kc=${encodeURIComponent(step.kcId)}`}>{names.get(step.kcId)}</Link></div><span className="overview-step-time">{step.estMinutes} 分钟</span></li>)}</ol> : <p className="py-4 text-sm text-[var(--ink-soft)]">当前范围内没有待学步骤。</p>}
            <Link href={pathHref} className="overview-list-link">完整学习清单<ArrowRight size={16} /></Link>
          </div>
        </section>
        <section className="overview-recent" aria-labelledby="recent-study-heading">
          <div className="overview-section-heading"><h2 id="recent-study-heading">最近学习</h2></div>
          <div className="overview-recent-body">
            {last ? <div className="recent-record"><CheckCircle2 size={20} /><p>最近作答：<strong>{names.get(last.kcId) ?? last.kcId}</strong><span>{new Date(last.at).toLocaleString("zh-CN")} · {last.correct ? "答对" : "答错"}</span></p></div> : <div className="overview-empty"><BookOpen size={66} /><h3>尚无学习记录</h3><p>完成作答后，会在这里保留学习记录。</p><Link href="/guide" className="editorial-text-link">使用指南<ArrowRight size={17} /></Link></div>}
            {due.length ? <><h3>待复习内容</h3><ul className="review-links">{due.slice(0, 3).map(item => <li key={item.id}><Link href={`/diagnose${query}#memory-review`}>{names.get(item.kcId) ?? item.kcId}<span>{item.kind === "error" ? "错题" : "易混知识点"}</span></Link></li>)}</ul></> : null}
            {last ? <Link href={`/mistakes${query}`} className="editorial-text-link"><PencilLine size={17} />复习错题</Link> : null}
            {history.length ? <details className="overview-history"><summary>课程学习记录 · {history.length} 门</summary><ul>{history.map(subject => <li key={subject.id}><Link href={`/path?subject=${subject.id}`}>{subject.name}</Link><span>{learner?.subjects[subject.id]?.attempts.length} 次作答</span></li>)}</ul></details> : null}
            <p className="overview-storage">{synced ? "已读取账号进度" : "记录保存在本浏览器，登录后可同步。"}</p>
          </div>
        </section>
      </div>
    </> : <LearningSkeleton />}
  </section>;
}
