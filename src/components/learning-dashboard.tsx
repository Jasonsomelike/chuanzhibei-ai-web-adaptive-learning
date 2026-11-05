"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Icon } from "@/components/icons";
import KnowledgeContourCanvas from "@/components/visual/knowledge-contour-canvas";
import { useStaggerIn } from "@/components/motion";
import { SUBJECTS } from "@/data/subjects";
import { useSubject } from "@/lib/subject";
import { useLearner } from "@/lib/useLearner";
import { masteredSet, planPath } from "@/lib/plan";
import { targetQuery } from "@/lib/target";
import { dueMemories } from "@/lib/memory";

/** V3 layout, using the existing evidence and planner rather than prototype data. */
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
  const studyHref = (id: string) => `/tutor${query}&q=${encodeURIComponent(`请引导我学习${names.get(id) ?? id}，先给一个思考问题。`)}`;
  const continueHref = next ? studyHref(next.kcId) : `/diagnose${query}`;
  const loaded = ready && learnerReady && target && progress && plan;
  const history = SUBJECTS.filter(subject => learner?.subjects[subject.id]?.attempts.length);

  return <section ref={root} className="daily-dashboard" aria-labelledby="study-heading" aria-busy={!loaded}>
    <div className="overview-heading" data-motion="heading">
      <h1 id="study-heading">学习概览</h1>
      <p>{last ? "根据已有学习记录，查看下一项任务和最近的课程进展。" : "选择一门课程并开始诊断，确定你的学习起点。"}</p>
    </div>
    {loaded ? <>
      <div className="overview-primary" data-motion="overview">
        <section className="daily-task" aria-label="下一项学习任务">
          <KnowledgeContourCanvas />
          <div className="task-foreground">
            <p className="task-caption">下一项学习任务 · {target.name}</p>
            <h2>{next ? names.get(next.kcId) : "复习与巩固"}</h2>
            <p className="task-reason">{next ? (progress.mastery.find(item => item.kcId === next.kcId)?.evidenceN ?? 0) > 0 ? next.reason : "尚无作答证据，先按先修顺序建立基础，再用练习确认。" : "本次范围内已无待学任务，可以继续诊断或复习。"}</p>
            <div className="task-actions">
              <ButtonLink href={last ? continueHref : `/diagnose${query}`}>{last ? "继续学习" : "开始诊断"}<Icon name="arrow" size={17} className="ml-2" /></ButtonLink>
              <ButtonLink href={pathHref} variant="ghost">查看完整计划</ButtonLink>
            </div>
            <p className="task-duration">{next ? <>预计 <strong>{next.estMinutes} 分钟</strong><span aria-hidden="true"> · </span></> : null}当前路径 <strong>{plan.steps.length} 步</strong></p>
          </div>
        </section>
        <section className="overview-progress" aria-labelledby="course-progress-heading">
          <div className="overview-panel-heading"><h2 id="course-progress-heading">当前课程进度</h2><Link href={pathHref}>查看路径<Icon name="arrow" size={14} /></Link></div>
          <label htmlFor="daily-course" className="sr-only">当前课程</label>
          <select id="daily-course" aria-label="当前学习目标" value={targetId} onChange={event => setTargetId(event.target.value)}>
            {target.kind === "direction" ? <option value={target.id}>{target.name}</option> : null}
            {SUBJECTS.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
          </select>
          {targetError ? <p role="alert" className="mt-2 text-sm text-[var(--bad)]">{targetError}</p> : null}
          <p className="overview-count tabular"><strong>{observed}</strong><span>/ {target.graph.concepts.length} 个知识点已测</span></p>
          <div className="course-coverage" role="progressbar" aria-label="已测知识点覆盖率（非掌握度）" aria-valuemin={0} aria-valuemax={target.graph.concepts.length} aria-valuenow={observed}><span style={{ width: `${observed / target.graph.concepts.length * 100}%` }} /></div>
          <p className="overview-note">{observed ? "进度表示测评覆盖范围，掌握情况由作答证据估计。" : "尚未测评，未测评不代表不会。"}</p>
          <dl className="overview-stats"><div><dt>已达学习阈值</dt><dd>{mastered}<span> 个</span></dd></div><div><dt>到期复习卡</dt><dd>{due.length}<span> 张</span></dd></div></dl>
        </section>
      </div>
      <div className="overview-secondary">
        <section aria-labelledby="session-heading">
          <div className="overview-section-heading"><h2 id="session-heading">本次学习安排</h2><fieldset><legend className="sr-only">可用学习时间</legend><div className="segmented">{[30,60,90].map(minutes => <button type="button" key={minutes} aria-pressed={budget === minutes} onClick={() => setBudget(minutes)}>{minutes} 分钟</button>)}</div></fieldset></div>
          <div className="overview-steps">
            <p className="overview-note" aria-live="polite">{last ? `建议 ${plan.steps.length} 步，预计 ${plan.totalMinutes} 分钟。` : "尚未测评，按先修顺序建议；诊断后更新。"}</p>
            {plan.steps.length ? <ol>{plan.steps.slice(0,3).map((step,index) => <li key={step.kcId}><span className="overview-step-number tabular">{String(index+1).padStart(2,"0")}</span><div><Link href={studyHref(step.kcId)}>{names.get(step.kcId)}</Link><p>{step.kind === "review" ? "复习巩固" : "建立基础"}</p></div><span className="overview-step-time">{step.estMinutes} 分钟</span></li>)}</ol> : <p className="py-4 text-sm text-[var(--ink-soft)]">当前范围内没有待学步骤。</p>}
            <Link href={pathHref} className="overview-list-link">完整学习清单<Icon name="arrow" size={16} /></Link>
          </div>
        </section>
        <section className="overview-recent" aria-labelledby="recent-study-heading">
          <div className="overview-section-heading"><h2 id="recent-study-heading">最近学习</h2>{last ? <Link href={`/diagnose${query}`}>继续诊断</Link> : <Link href="/guide">使用指南</Link>}</div>
          <div className="overview-recent-body">
            <div className="recent-record"><Icon name={last ? "check" : "book"} size={19} /><p>{last ? <>最近作答：<strong>{names.get(last.kcId) ?? last.kcId}</strong><span>{new Date(last.at).toLocaleString("zh-CN")} · {last.correct ? "答对" : "答错"}</span></> : <>尚无作答记录<span>完成一次诊断后，这里会显示最近的学习内容。</span></>}</p></div>
            <h3>待复习内容</h3>{due.length ? <ul className="review-links">{due.slice(0,3).map(item => <li key={item.id}><Link href={`/diagnose${query}#memory-review`}>{names.get(item.kcId) ?? item.kcId}<span>{item.kind === "error" ? "错题" : "易混知识点"}</span></Link></li>)}</ul> : <p className="overview-note">当前课程没有到期复习卡。</p>}
            {history.length ? <details className="overview-history"><summary>课程学习记录 · {history.length} 门</summary><ul>{history.map(subject => <li key={subject.id}><Link href={`/path?subject=${subject.id}`}>{subject.name}</Link><span>{learner?.subjects[subject.id]?.attempts.length} 次作答</span></li>)}</ul></details> : null}
            <p className="overview-storage">{synced ? "已读取账号进度" : "记录保存在本浏览器，登录后可同步。"}</p>
          </div>
        </section>
      </div>
    </> : <div className="overview-loading" role="status"><span />正在读取学习记录…</div>}
  </section>;
}
