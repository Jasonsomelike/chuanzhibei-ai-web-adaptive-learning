"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ButtonLink } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useStaggerIn, useSwapIn } from "@/components/motion";
import { SUBJECTS } from "@/data/subjects";
import { useSubject } from "@/lib/subject";
import { useLearner } from "@/lib/useLearner";
import { planPath } from "@/lib/plan";
import { targetQuery } from "@/lib/target";

/** A usable opening study plan computed from the same evidence as /path. */
export function LearningJourney() {
  const { target, targetId, setTargetId, ready, targetError } = useSubject();
  const { progress, ready: learnerReady } = useLearner(targetId, target?.graph);
  const [budget, setBudget] = useState(30);
  const [phase, setPhase] = useState(1);
  const previewId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const phaseTabs = useRef<HTMLDivElement>(null);
  useSwapIn(sheet, phase);
  const root = useRef<HTMLElement>(null);
  useStaggerIn(root);
  const plan = useMemo(() => target && progress ? planPath({ graph: target.graph, mastery: progress.mastery, budgetMinutes: budget }) : null, [target, progress, budget]);
  const loaded = ready && learnerReady && target && progress && plan;
  const query = target ? targetQuery(target) : "";
  const attempted = progress?.attempts.length ?? 0;
  const names = new Map(target?.graph.concepts.map(c => [c.id, c.name]));
  const exampleQuestion = target?.kind === "subject" ? target.questions[0] : null;
  const nextConcept = target?.graph.concepts.find(concept => concept.id === plan?.steps[0]?.kcId) ?? target?.graph.concepts[0];

  return <><section ref={root} id="study" className="study-hero scroll-mt-24" aria-labelledby="study-heading" aria-busy={!loaded}>
    <div data-motion="study-intro">
      <h2 id="study-heading" className="text-2xl font-semibold">学习流程演示</h2>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">选择课程，切换诊断、路径和导师三个阶段。预览读取当前记录，不保存作答。</p>
      <label className="mt-5 block text-sm">演示课程<select className="mt-2 block w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3" value={targetId} onChange={event => setTargetId(event.target.value)}>
        {target?.kind === "direction" ? <option value={target.id}>{target.name}</option> : null}
        {SUBJECTS.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
      </select></label>
      {targetError ? <p role="alert">{targetError}</p> : null}
    </div>
    <div ref={sheet} id={`${previewId}-panel`} role="tabpanel" aria-labelledby={`${previewId}-tab-${phase}`} className="study-sheet min-h-[390px]" data-motion="study-plan">
      {phase === 0 ? <>
        <h2 className="text-2xl font-semibold">试做一道题</h2>
        <p className="mt-3 text-xs text-[var(--ink-faint)]">{target?.name} · 题目预览，不写入学习记录</p>
        {exampleQuestion ? <><p className="mt-6 text-base font-medium leading-relaxed">{exampleQuestion.stem}</p><ul className="mt-4 space-y-2">{exampleQuestion.options.map((option, index) => <li key={index} className="flex gap-3 border-b border-[var(--line)] py-2 text-sm text-[var(--ink-soft)]"><span className="text-[var(--ink-faint)]">{String.fromCharCode(65 + index)}.</span>{option}</li>)}</ul></> : <p className="mt-8 text-sm leading-relaxed text-[var(--ink-soft)]">进入诊断页，围绕当前方向逐步了解基础，再根据作答证据安排学习。</p>}
        <div className="mt-5"><ButtonLink href={`/diagnose${query}`}>进入诊断<Icon name="arrow" size={17} className="ml-2" /></ButtonLink></div>
      </> : phase === 2 ? <>
        <h2 className="text-2xl font-semibold">向课程导师提问</h2>
        <p className="mt-3 text-xs text-[var(--ink-faint)]">{target?.name} · 围绕下一步学习内容提问</p>
        <div className="my-6 border-l-2 border-[var(--accent)] pl-4"><h3 className="font-medium">{nextConcept?.name ?? "选择一门课程"}</h3><p className="mt-3 text-sm leading-[1.9] text-[var(--ink-soft)]">{nextConcept?.summary ?? "先选择课程，导师会结合当前课程资料帮助你理解。"}</p></div>
        <p className="text-sm text-[var(--ink-soft)]">可以从提示开始，再逐步展开思路。提问时可对照教材，检查回答出处。</p>
        <div className="mt-6"><ButtonLink href={`/tutor${query}${query ? "&" : "?"}q=${encodeURIComponent(`请引导我理解${nextConcept?.name ?? "这门课程"}，先给一个思考问题。`)}`}>带着这一步问导师<Icon name="arrow" size={17} className="ml-2" /></ButtonLink></div>
      </> : <>
      <h2 className="text-2xl font-semibold">本次学习安排</h2>
      <fieldset className="mt-5"><legend className="sr-only">这次有多少时间？</legend><div className="segmented">
        {[30, 60, 90].map(minutes => <button key={minutes} type="button" aria-pressed={budget === minutes} onClick={() => setBudget(minutes)}>{minutes} 分钟</button>)}
      </div></fieldset>
      <p className="mt-3 text-xs leading-relaxed text-[var(--ink-faint)]" aria-live="polite">{loaded ? attempted === 0 ? "尚未测评，先按基础顺序建议。诊断后会更新。" : `本次建议 ${plan.steps.length} 步，预计 ${plan.totalMinutes} 分钟。` : "正在读取真实学习记录…"}</p>
      <ol className="mt-5 min-h-32">
        {plan?.steps.slice(0, 3).map((step, index) => <li key={step.kcId} className="relative flex items-center gap-4 py-4 not-last:after:absolute not-last:after:bottom-[-16px] not-last:after:left-[14px] not-last:after:h-8 not-last:after:w-px not-last:after:bg-[var(--line)]">
          <span className="journey-number relative z-10 bg-[var(--surface)]">{index + 1}</span><span className="min-w-0 flex-1 wrap-anywhere text-sm font-medium sm:text-base">{names.get(step.kcId)}</span><span className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--ink-faint)]"><Icon name="clock" size={15} />{step.estMinutes} 分钟</span>
        </li>)}
      </ol>
      {loaded && plan.steps.length === 0 ? <p className="text-sm">当前知识点已达学习阈值，可以继续诊断或复习巩固。</p> : null}
      <div className="mt-5 flex justify-center border-t border-[var(--line)] pt-5"><ButtonLink href={`/path${query}${query ? "&" : "?"}budget=${budget}`} variant="ghost">查看完整计划<Icon name="arrow" size={18} className="ml-3" /></ButtonLink></div>
      </>}
    </div>
  </section>
  <section className="mb-10" aria-label="学习流程预览">
    <p className="text-xs text-[var(--ink-faint)]">点选三个阶段，看看一次学习如何连起来。</p>
    <div ref={phaseTabs} role="tablist" aria-label="学习流程阶段" className="learning-journey">
      {[{ title: "先了解自己", text: "用少量题目了解基础，每一次作答都留下学习证据。" }, { title: "安排下一步", text: "结合先修关系和可用时间，让下一步清楚、可调整。" }, { title: "学懂，再验证", text: "对照原文、带着卡点提问，再通过练习验证理解。" }].map((step, index) => <button type="button" role="tab" key={step.title} id={`${previewId}-tab-${index}`} aria-controls={`${previewId}-panel`} aria-selected={phase === index} tabIndex={phase === index ? 0 : -1} onClick={() => setPhase(index)} onKeyDown={event => {
        const next = event.key === "ArrowRight" ? (phase + 1) % 3 : event.key === "ArrowLeft" ? (phase + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : null;
        if (next !== null) { event.preventDefault(); setPhase(next); phaseTabs.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus(); }
      }} className="journey-step text-left"><span className="journey-number">{index + 1}</span><span><span className="block text-sm font-semibold sm:text-base">{step.title}</span><span className="mt-1 block text-xs leading-relaxed text-[var(--ink-soft)]">{step.text}</span></span></button>)}
    </div>
  </section></>;
}
