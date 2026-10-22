"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill, MasteryBar } from "@/components/ui";
import { knowledgeGraph } from "@/data/knowledge-graph";
import { questionsForKc, type Question } from "@/data/questions";
import {
  createLearner,
  loadLearner,
  saveLearner,
  recordAttempt,
  attemptedQuestionIds,
  type LearnerState,
} from "@/lib/learner";
import { masteryMean, masterySd } from "@/lib/mastery";
import { computeDepths } from "@/lib/graph";

/**
 * 诊断流程：
 *   1. 从先修深度最小的未测评知识点开始，保证不跳级
 *   2. 每个知识点出 1 道还没做过的题（优先中等难度，信息量最大）
 *   3. 做完立即更新掌握度并显示变化，让学生看到「这一题改变了什么」
 *   4. 达到目标题数或没有可出的题时结束
 */

const DIAGNOSE_TARGET = 10;

interface PickedQuestion {
  readonly question: Question;
  readonly kcName: string;
  readonly depth: number;
}

export default function DiagnosePage() {
  const [learner, setLearner] = useState<LearnerState | null>(null);
  const [answered, setAnswered] = useState<{
    question: Question;
    correct: boolean;
    before: number;
    after: number;
  }[]>([]);
  const [current, setCurrent] = useState<PickedQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  const depths = useMemo(() => computeDepths(knowledgeGraph), []);
  const kcName = useMemo(
    () => new Map(knowledgeGraph.concepts.map((c) => [c.id, c.name])),
    [],
  );

  // 首次加载：从 localStorage 恢复，或新建
  useEffect(() => {
    setLearner(loadLearner());
  }, []);

  // 每次状态变化都持久化——这就是「跨会话记得住」的实现
  useEffect(() => {
    if (learner) saveLearner(learner);
  }, [learner]);

  const pickNext = useCallback(
    (state: LearnerState): PickedQuestion | null => {
      // 按先修深度升序，同深度内按掌握度升序（优先补弱的）
      const candidates = knowledgeGraph.concepts
        .map((c) => {
          const m = state.mastery.find((x) => x.kcId === c.id);
          const done = attemptedQuestionIds(state, c.id);
          const remaining = questionsForKc(c.id).filter((q) => !done.has(q.id));
          return {
            concept: c,
            mastery: m,
            remaining,
            depth: depths.get(c.id) ?? 0,
          };
        })
        .filter((x) => x.remaining.length > 0 && x.mastery);

      if (candidates.length === 0) return null;

      candidates.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        const ma = masteryMean(a.mastery!);
        const mb = masteryMean(b.mastery!);
        if (Math.abs(ma - mb) > 1e-9) return ma - mb;
        return a.concept.id < b.concept.id ? -1 : 1;
      });

      const chosen = candidates[0];
      // 优先出中等难度：太易测不出上限，太难多半是猜
      const byDifficulty = [...chosen.remaining].sort(
        (a, b) => Math.abs(a.difficulty - 3) - Math.abs(b.difficulty - 3),
      );

      return {
        question: byDifficulty[0],
        kcName: chosen.concept.name,
        depth: chosen.depth,
      };
    },
    [depths],
  );

  // 初始化第一题
  useEffect(() => {
    if (learner && !current && answered.length < DIAGNOSE_TARGET) {
      setCurrent(pickNext(learner));
    }
  }, [learner, current, answered.length, pickNext]);

  const submit = () => {
    if (!learner || !current || selected === null) return;

    const correct = selected === current.question.answerIndex;
    const beforeState = learner.mastery.find((m) => m.kcId === current.question.kcId);
    const before = beforeState ? masteryMean(beforeState) : 0;

    const next = recordAttempt(learner, current.question, correct, new Date().toISOString());
    const afterState = next.mastery.find((m) => m.kcId === current.question.kcId);
    const after = afterState ? masteryMean(afterState) : 0;

    setLearner(next);
    setAnswered((prev) => [...prev, { question: current.question, correct, before, after }]);
    setRevealed(true);
  };

  const next = () => {
    setSelected(null);
    setRevealed(false);
    if (learner) setCurrent(pickNext(learner));
  };

  const reset = () => {
    const fresh = createLearner();
    setLearner(fresh);
    saveLearner(fresh);
    setAnswered([]);
    setCurrent(null);
    setSelected(null);
    setRevealed(false);
  };

  if (!learner) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 py-10">
          <p className="text-[var(--color-ink-soft)]">正在读取你的学习记录…</p>
        </main>
      </>
    );
  }

  const done = answered.length >= DIAGNOSE_TARGET || (!current && !revealed);
  const correctCount = answered.filter((a) => a.correct).length;

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">诊断测评</h1>
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              按先修顺序出题，每答一题立即更新掌握度。做 {DIAGNOSE_TARGET} 题即可生成路径。
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="shrink-0 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]"
          >
            清空记录
          </button>
        </div>

        {/* 进度 */}
        <Card className="mb-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--color-ink-soft)]">
              已答 <span className="tabular font-medium text-[var(--color-ink)]">{answered.length}</span> / {DIAGNOSE_TARGET} 题
            </span>
            <span className="text-[var(--color-ink-soft)]">
              正确 <span className="tabular font-medium text-[var(--color-ink)]">{correctCount}</span> 题
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-[width] duration-300"
              style={{ width: `${Math.min(100, (answered.length / DIAGNOSE_TARGET) * 100)}%` }}
            />
          </div>
        </Card>

        {/* 当前题目 */}
        {current && !done ? (
          <Card className="mb-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Pill tone="accent">{current.kcName}</Pill>
              <Pill>难度 {current.question.difficulty}</Pill>
              <Pill>先修深度 {current.depth}</Pill>
            </div>
            <h2 className="text-base font-medium leading-relaxed">{current.question.stem}</h2>

            <fieldset className="mt-4 space-y-2" disabled={revealed}>
              <legend className="sr-only">选择一个答案</legend>
              {current.question.options.map((opt, i) => {
                const isSelected = selected === i;
                const isCorrect = i === current.question.answerIndex;
                let tone =
                  "border-[var(--color-line)] hover:border-[var(--color-ink-faint)]";
                if (revealed && isCorrect)
                  tone = "border-[var(--color-good)] bg-[var(--color-good-soft)]";
                else if (revealed && isSelected && !isCorrect)
                  tone = "border-[var(--color-bad)] bg-[var(--color-bad-soft)]";
                else if (isSelected) tone = "border-[var(--color-accent)] bg-[var(--color-accent-soft)]";

                return (
                  <label
                    key={i}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${tone} ${revealed ? "cursor-default" : ""}`}
                  >
                    <input
                      type="radio"
                      name="answer"
                      checked={isSelected}
                      onChange={() => setSelected(i)}
                      className="mt-1"
                    />
                    <span>{opt}</span>
                  </label>
                );
              })}
            </fieldset>

            {revealed ? (
              <div className="mt-4 rounded-lg bg-[var(--color-canvas)] p-3 text-sm">
                <p className="font-medium">
                  {selected === current.question.answerIndex ? "回答正确" : "回答错误"}
                </p>
                <p className="mt-1 text-[var(--color-ink-soft)]">
                  {current.question.explanation}
                </p>
                <p className="mt-2 tabular text-xs text-[var(--color-ink-faint)]">
                  该知识点掌握度：
                  {Math.round(
                    (answered[answered.length - 1]?.before ?? 0) * 100,
                  )}
                  % → {Math.round((answered[answered.length - 1]?.after ?? 0) * 100)}%
                </p>
                <button
                  type="button"
                  onClick={next}
                  className="mt-3 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
                >
                  下一题
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={selected === null}
                className="mt-4 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                提交答案
              </button>
            )}
          </Card>
        ) : null}

        {/* 诊断完成 */}
        {done ? (
          <Card className="mb-5">
            <SectionTitle hint="诊断结束。下面是这次测评带来的变化。">
              诊断完成
            </SectionTitle>
            <div className="space-y-3">
              {summarize(answered, learner).map((row) => (
                <MasteryBar
                  key={row.kcId}
                  mean={row.mean}
                  sd={row.sd}
                  evidenceN={row.n}
                  label={kcName.get(row.kcId) ?? row.kcId}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/path"
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
              >
                查看学习路径
              </Link>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm"
              >
                重新诊断
              </button>
            </div>
          </Card>
        ) : null}

        {/* 已答题目回顾 */}
        {answered.length > 0 ? (
          <section>
            <SectionTitle>答题记录</SectionTitle>
            <div className="space-y-2">
              {answered.map((a, i) => (
                <Card key={`${a.question.id}-${i}`} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{a.question.stem}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                        {kcName.get(a.question.kcId)} · 难度 {a.question.difficulty}
                      </p>
                    </div>
                    <Pill tone={a.correct ? "good" : "bad"}>
                      {a.correct ? "对" : "错"}
                    </Pill>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}

/** 把作答汇总成每个知识点的最新状态。用传入的 learner，不读存储。 */
function summarize(
  answered: { question: Question }[],
  learner: LearnerState,
): { kcId: string; mean: number; sd: number; n: number }[] {
  const kcIds = [...new Set(answered.map((a) => a.question.kcId))];

  return kcIds.map((kcId) => {
    const m = learner.mastery.find((x) => x.kcId === kcId);
    return {
      kcId,
      mean: m ? masteryMean(m) : 0,
      sd: m ? masterySd(m) : 1,
      n: m?.evidenceN ?? 0,
    };
  });
}
