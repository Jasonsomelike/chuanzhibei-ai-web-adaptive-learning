"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { useSwapIn } from "@/components/motion";
import { SUBJECTS } from "@/data/subjects";
import { useSubject } from "@/lib/subject";
import { useLearner } from "@/lib/useLearner";
import { planPath } from "@/lib/plan";
import { targetQuery } from "@/lib/target";

const PHASES = [
  {
    title: "诊断测评",
    label: "先了解自己",
    text: "完成少量作答，了解自己的知识起点。",
  },
  {
    title: "查看图谱",
    label: "安排下一步",
    text: "查看先修关系，选择本次的学习顺序。",
  },
  {
    title: "课程导师",
    label: "学懂，再验证",
    text: "对照原文提问，再用独立练习检查理解。",
  },
] as const;

/** Preview choices stay in component state and never call the assessment or progress mutations. */
export function LearningJourney() {
  const { target, targetId, setTargetId, ready, targetError } = useSubject();
  const { progress, ready: learnerReady } = useLearner(targetId, target?.graph);
  const [budget, setBudget] = useState(30);
  const [phase, setPhase] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const previewId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  useSwapIn(sheet, phase);
  const plan = useMemo(
    () =>
      target && progress
        ? planPath({
            graph: target.graph,
            mastery: progress.mastery,
            budgetMinutes: budget,
          })
        : null,
    [target, progress, budget],
  );
  const loaded = Boolean(ready && learnerReady && target && progress && plan);
  const query = target ? targetQuery(target) : "";
  const question = target?.kind === "subject" ? target.questions[0] : null;
  const nextConcept =
    target?.graph.concepts.find((item) => item.id === plan?.steps[0]?.kcId) ??
    target?.graph.concepts[0];
  const names = new Map(
    target?.graph.concepts.map((item) => [item.id, item.name]),
  );

  return (
    <section
      id="study"
      className="guide-journey"
      aria-labelledby="study-heading"
      aria-busy={!loaded}
    >
      <h2 id="study-heading">从一次诊断开始</h2>
      <p className="guide-journey-intro">
        选择课程，完成作答，再查看系统如何安排学习路径。
      </p>
      <div
        className="guide-phase-tabs"
        role="tablist"
        aria-label="学习流程阶段"
        ref={tabs}
      >
        {PHASES.map((item, index) => (
          <button
            key={item.title}
            type="button"
            role="tab"
            id={previewId + "-tab-" + index}
            aria-label={item.label + " · " + item.title}
            aria-controls={previewId + "-panel"}
            aria-selected={phase === index}
            tabIndex={phase === index ? 0 : -1}
            onClick={() => setPhase(index)}
            onKeyDown={(event) => {
              let next = phase;
              if (event.key === "ArrowRight") next = (phase + 1) % 3;
              else if (event.key === "ArrowLeft") next = (phase + 2) % 3;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = 2;
              else return;
              event.preventDefault();
              setPhase(next);
              tabs.current
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
          >
            <span className="guide-step-marker">{index + 1}</span>
            <span>
              <strong>{item.title}</strong>
              <small>{item.text}</small>
            </span>
          </button>
        ))}
      </div>
      <div
        ref={sheet}
        className="guide-preview"
        id={previewId + "-panel"}
        role="tabpanel"
        aria-labelledby={previewId + "-tab-" + phase}
      >
        <p className="guide-preview-caption">操作预览 · 不计入学习记录</p>
        <label className="guide-preview-course">
          课程
          <select
            aria-label="演示课程"
            value={targetId}
            onChange={(event) => {
              setChoice(null);
              setChecked(false);
              setTargetId(event.target.value);
            }}
          >
            {target?.kind === "direction" ? (
              <option value={target.id}>{target.name}</option>
            ) : null}
            {SUBJECTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {targetError ? <p role="alert">{targetError}</p> : null}
        {!loaded ? (
          <p role="status" className="guide-preview-loading">
            正在读取课程与学习记录…
          </p>
        ) : phase === 0 ? (
          <>
            <p className="guide-preview-note">
              {target?.name} · 题目预览，不写入学习记录
            </p>
            {question ? (
              <>
                <fieldset disabled={checked}>
                  <legend>{question.stem}</legend>
                  {question.options.map((option, index) => (
                    <label key={index} className="guide-preview-option">
                      <input
                        type="radio"
                        name={previewId + "-answer"}
                        checked={choice === index}
                        onChange={() => setChoice(index)}
                      />
                      {option}
                    </label>
                  ))}
                </fieldset>
                <div className="guide-preview-actions">
                  <button
                    type="button"
                    disabled={choice === null}
                    onClick={() => {
                      if (checked) {
                        setChecked(false);
                        setChoice(null);
                      } else setChecked(true);
                    }}
                  >
                    {checked ? "再试一次" : "试做这道题"}
                  </button>
                  <ButtonLink href={"/diagnose" + query} variant="ghost">
                    开始正式诊断
                    <ArrowRight size={17} />
                  </ButtonLink>
                </div>
                {checked ? (
                  <div className="guide-preview-feedback" role="status">
                    <strong>
                      {choice === question.answerIndex
                        ? "回答正确"
                        : "正确答案为 " +
                          String.fromCharCode(65 + question.answerIndex)}
                    </strong>
                    <p>{question.explanation}</p>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p>当前方向的练习请进入诊断页。</p>
                <ButtonLink href={"/diagnose" + query}>进入诊断</ButtonLink>
              </>
            )}
          </>
        ) : phase === 1 ? (
          <>
            <h3>本次学习安排</h3>
            <fieldset className="guide-preview-budget">
              <legend>这次有多少时间？</legend>
              <div className="segmented">
                {[30, 60, 90].map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={budget === minutes}
                    onClick={() => setBudget(minutes)}
                  >
                    {minutes} 分钟
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="guide-preview-note">
              {progress?.attempts.length
                ? "根据当前作答记录与先修关系安排。"
                : "尚未测评，先按基础顺序建议。诊断后会更新。"}
            </p>
            <ol className="guide-preview-plan">
              {plan?.steps.slice(0, 3).map((step, index) => (
                <li key={step.kcId}>
                  <span>{index + 1}</span>
                  <strong>{names.get(step.kcId)}</strong>
                  <small>{step.estMinutes} 分钟</small>
                </li>
              ))}
            </ol>
            <ButtonLink
              href={"/path" + query + (query ? "&" : "?") + "budget=" + budget}
              variant="ghost"
            >
              查看完整图谱
              <ArrowRight size={17} />
            </ButtonLink>
          </>
        ) : (
          <>
            <h3>{nextConcept?.name ?? "向课程导师提问"}</h3>
            <p className="guide-preview-concept">{nextConcept?.summary}</p>
            <p>可以先请求一个提示，再逐步展开思路。教材与引用需要时再打开。</p>
            <ButtonLink
              href={
                "/tutor" +
                query +
                (query ? "&" : "?") +
                "q=" +
                encodeURIComponent(
                  "请引导我理解" +
                    (nextConcept?.name ?? "这门课程") +
                    "，先给一个思考问题。",
                )
              }
            >
              带着这一步问导师
              <ArrowRight size={17} />
            </ButtonLink>
          </>
        )}
      </div>
    </section>
  );
}
