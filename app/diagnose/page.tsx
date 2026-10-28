"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill, MasteryBar } from "@/components/ui";
import { TargetPicker, targetCaption } from "@/components/target-picker";
import { useSubject } from "@/lib/subject";
import { useDirectionDraft } from "@/lib/useDirectionDraft";
import { ensureItems, fetchItems } from "@/lib/directionItems";
import { useAuth } from "@/lib/useAuth";
import { loadProvider, type ProviderConfig } from "@/lib/provider";
import type { Question } from "@/data/questions";
import { recordAttempt, attemptedQuestionIds, progressOf } from "@/lib/learner";
import { useLearner } from "@/lib/useLearner";
import { useMaterialPack } from "@/lib/materialStore";
import {
  MATERIAL_CHECK_PREFIX,
  buildMaterialContext,
  materialCheckLabel,
} from "@/lib/materials";
import {
  masteryMean,
  masterySd,
  masteryProbAbove,
  predictCorrect,
  hasEnoughEvidence,
} from "@/lib/mastery";
import { computeDepths } from "@/lib/graph";
import {
  GENERATED_WEIGHT_SCALE,
  ITEMS_PER_KC,
  kcEvidenceTarget,
  type DirectionItem,
} from "@/lib/itemgen";
import type { LearningTarget } from "@/lib/target";

/**
 * 诊断流程：
 *   1. 从先修深度最小的未测评知识点开始，保证不跳级
 *   2. 每个知识点出 1 道还没做过的题，选「预测正确率最接近 0.65」的那道
 *   3. 做完立即更新掌握度并显示变化
 *   4. 每个 KC 达到证据门槛、或没有可出的题、或答满 HARD_CAP 时结束
 *
 * 自定义方向的题按 KC 懒生成：推进到某个 KC 且它没题时才调用模型，
 * 生成结果落库缓存，第二次诊断零调用。
 *
 * 关键约束：pickNext 只看 depth + mastery + items.length，不调用模型。
 * 模型只负责「出什么题」，不负责「先测哪个点」——这是路径可复现的前提。
 */

/** 全局上限。替代原先的 DIAGNOSE_TARGET = 10：per-KC 门槛已经限制总量。 */
const HARD_CAP = 15;

interface PickedQuestion {
  readonly question: Question;
  readonly kcName: string;
  readonly depth: number;
  /** 生成题/借用题的来源标记；内置题为 undefined。 */
  readonly origin?: DirectionItem["source"];
  /** 只练习、不计证据（L4 未过或手动录入）。 */
  readonly practiceOnly: boolean;
  /** 通过了几项校验，用于「已通过 N 项校验」标记。不含「提示：」与「依据：」。 */
  readonly checkCount: number;
  /** 未拒绝但值得提示的问题（L5 难度理由不匹配等）。 */
  readonly checkNotes: readonly string[];
  /** 题目的资料出处（checks 里的「依据：…」行）；内置题没有。 */
  readonly materialLabel: string | null;
  /** 所属章节。内置题用它标注「第X章 · 内置题库」。 */
  readonly chapter: string;
}

interface AnsweredRow {
  question: Question;
  correct: boolean;
  before: number;
  after: number;
  practiceOnly: boolean;
}

/** 生成状态机：只对当前 KC 有效。 */
type GenState =
  | { kind: "idle" }
  | { kind: "loading"; kcId: string; kcName: string; done: number; total: number }
  | { kind: "failed"; kcId: string; kcName: string; error: string }
  | { kind: "no-model"; kcId: string; kcName: string };

export default function DiagnosePage() {
  const { target, targetId, setTarget, setTargetId, ready, loadingTarget, targetError } =
    useSubject();
  const {
    learner,
    ready: learnerReady,
    progress,
    setLearner,
    synced,
    resetSubject,
  } = useLearner(targetId, target?.graph);

  const [answered, setAnswered] = useState<AnsweredRow[]>([]);
  const [current, setCurrent] = useState<PickedQuestion | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);

  const [directionItems, setDirectionItems] = useState<DirectionItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [gen, setGen] = useState<GenState>({ kind: "idle" });
  const [skippedKcs, setSkippedKcs] = useState<Set<string>>(new Set());
  /** 非阻塞提示：生成成功但题不够、或双解校验没跑完。 */
  const [genNotice, setGenNotice] = useState<string | null>(null);
  const [showNewDirection, setShowNewDirection] = useState(false);

  const genAbort = useRef<AbortController | null>(null);
  /** 本次会话里已经尝试过生成的 KC，防止「生成成功但题不够」反复计费。 */
  const attemptedGenKcs = useRef<Set<string>>(new Set());
  const [provider, setProvider] = useState<ProviderConfig | null>(null);

  // 切目标时重读一次：用户可能刚在设置页改过供应商配置
  useEffect(() => {
    setProvider(loadProvider());
  }, [targetId]);

  const graph = target?.graph;
  /*
   * 资料口径：内置数据包 + 我的笔记。只有出题时用得到，但 hook 必须无条件调用，
   * 所以放在这里而不是 generateFor 里。graph 用于让笔记继承知识点的章节，
   * 否则笔记的章节为空，在同优先级片段里会被排到最后。
   */
  const {
    pack: materialPack,
    selection: materialSelection,
    unresolved,
  } = useMaterialPack(targetId, graph);
  const depths = useMemo(
    () => (graph ? computeDepths(graph) : new Map<string, number>()),
    [graph],
  );
  const kcName = useMemo(
    () => new Map((graph?.concepts ?? []).map((c) => [c.id, c.name])),
    [graph],
  );

  /** 当前目标可用的题：内置题库或方向已落库的题。 */
  const availableQuestions = useMemo<readonly Question[]>(() => {
    if (!target) return [];
    if (target.kind === "subject") return target.questions;
    return directionItems.filter((i) => i.status !== "rejected");
  }, [target, directionItems]);

  const questionsByKc = useMemo(() => {
    const map = new Map<string, Question[]>();
    for (const c of graph?.concepts ?? []) map.set(c.id, []);
    for (const q of availableQuestions) {
      const list = map.get(q.kcId);
      if (list) list.push(q);
    }
    return map;
  }, [graph, availableQuestions]);

  // 切目标时清空本次答题与生成状态
  useEffect(() => {
    setAnswered([]);
    setCurrent(null);
    setSelected(null);
    setRevealed(false);
    setDirectionItems([]);
    setGen({ kind: "idle" });
    setSkippedKcs(new Set());
    setGenNotice(null);
    genAbort.current?.abort();
    genAbort.current = null;
    attemptedGenKcs.current = new Set();
  }, [targetId]);

  // 方向目标：先拉一次全量已落库题目（含 rejected 的过滤在内部）
  useEffect(() => {
    if (target?.kind !== "direction") return;
    let cancelled = false;
    setItemsLoading(true);
    void (async () => {
      try {
        const res = await fetch(
          `/api/directions/items?directionId=${encodeURIComponent(target.id)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = (await res.json()) as { items?: DirectionItem[] };
          if (!cancelled) setDirectionItems(data.items ?? []);
        }
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  /**
   * 某 KC 的证据门槛。生成题要 4 条，内置/借用/手动题 3 条。
   *
   * 只看 **accepted** 题：practice 不计证据，也就不能用来满足门槛——
   * 否则「1 道 accepted + 3 道 practice」会被误判为测够了。
   * 与方向页的「就绪」判断共用同一口径（`kcEvidenceTarget`）。
   */
  const perKcTarget = useCallback(
    (kcId: string): number => {
      const sources = (questionsByKc.get(kcId) ?? [])
        .map((q) => directionItems.find((i) => i.id === q.id))
        .filter((i): i is DirectionItem => i !== undefined && i.status === "accepted")
        .map((i) => i.source);
      return kcEvidenceTarget(sources);
    },
    [questionsByKc, directionItems],
  );

  const pickNext = useCallback(
    (state: typeof learner): PickedQuestion | null => {
      if (!state || !graph) return null;

      /*
       * 必须用 progressOf 而不是 state.subjects[targetId]：
       * 新方向第一次进入时 subjects 里还没有这个键，直接读会得到 undefined，
       * 于是「没题」被误判成「没有可测的知识点」，页面直接显示诊断完成。
       */
      const stateProgress = progressOf(state, targetId, graph);

      const candidates = graph.concepts
        .map((c) => {
          const m = stateProgress.mastery.find((x) => x.kcId === c.id);
          const done = attemptedQuestionIds(state, targetId, c.id, graph);
          const remaining = (questionsByKc.get(c.id) ?? []).filter((q) => !done.has(q.id));
          return { concept: c, mastery: m, remaining, depth: depths.get(c.id) ?? 0 };
        })
        .filter(
          (x) =>
            x.remaining.length > 0 &&
            x.mastery &&
            x.mastery.evidenceN < perKcTarget(x.concept.id) &&
            !skippedKcs.has(x.concept.id),
        );

      if (candidates.length === 0) return null;

      candidates.sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        const ma = masteryMean(a.mastery!);
        const mb = masteryMean(b.mastery!);
        if (Math.abs(ma - mb) > 1e-9) return ma - mb;
        return a.concept.id < b.concept.id ? -1 : 1;
      });

      const chosen = candidates[0];
      /*
       * 选「预测正确率最接近 0.65」的那道。
       * 0.65 是信息量较大的区间：太低多半在猜，太高测不出上限。
       * 用 predictCorrect 而不是 |d − 3|，弱学生出易题、强学生出难题才是显式规则。
       */
      const mean = masteryMean(chosen.mastery!);
      const byInfo = [...chosen.remaining].sort((a, b) => {
        const pa = Math.abs(predictCorrect(mean, a.difficulty) - 0.65);
        const pb = Math.abs(predictCorrect(mean, b.difficulty) - 0.65);
        if (Math.abs(pa - pb) > 1e-9) return pa - pb;
        return a.id < b.id ? -1 : 1;
      });

      const q = byInfo[0];
      const item = directionItems.find((i) => i.id === q.id);
      const checks = item?.checks ?? [];
      return {
        question: q,
        kcName: chosen.concept.name,
        depth: chosen.depth,
        origin: item?.source,
        practiceOnly: item ? item.status === "practice" : false,
        /*
         * 「提示：」开头的是未通过但值得提示的问题，「依据：」开头的是资料出处。
         * 两者都不是通过项，不能计入 N——否则用户会看到「已通过 4 项」而实际只过了 3 项。
         */
        checkCount: checks.filter(
          (c) => !c.startsWith("提示：") && !c.startsWith(MATERIAL_CHECK_PREFIX),
        ).length,
        checkNotes: checks.filter((c) => c.startsWith("提示：")).map((c) => c.slice(3)),
        materialLabel: checks.find((c) => c.startsWith(MATERIAL_CHECK_PREFIX)) ?? null,
        chapter: chosen.concept.chapter,
      };
    },
    [depths, graph, questionsByKc, targetId, directionItems, perKcTarget, skippedKcs],
  );

  /**
   * 找下一个「accepted 题不够门槛」的 KC，用于触发懒生成。
   *
   * 条件从「accepted === 0」放宽到「accepted < 门槛」：
   * 一个 KC 只有 1–3 道 accepted 题（其余被 L4 降级为 practice，或用户只手动录了几道）时，
   * 三个谓词会同时为假——pickNext 因 remaining 为空返回 null、
   * 旧版 kcNeedingItems 因 accepted !== 0 返回 null、canPickMore 因未达门槛返回 true，
   * 于是 done=false 却没有任何可渲染的卡片，页面空白死锁。
   *
   * 按先修深度升序，与 pickNext 的排序口径一致：
   * 方向图谱的 concepts 数组顺序不可信（LLM 与关键词拼装都不保证拓扑序）。
   */
  const kcNeedingItems = useCallback(
    (state: typeof learner): { id: string; name: string } | null => {
      if (!graph || !state) return null;
      // 同上：新方向的 subjects 键还不存在，必须走 progressOf
      const stateProgress = progressOf(state, targetId, graph);

      const sorted = [...graph.concepts].sort((a, b) => {
        const da = depths.get(a.id) ?? 0;
        const db = depths.get(b.id) ?? 0;
        if (da !== db) return da - db;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });

      for (const c of sorted) {
        if (skippedKcs.has(c.id)) continue;
        if (attemptedGenKcs.current.has(c.id)) continue;
        const m = stateProgress.mastery.find((x) => x.kcId === c.id);
        if (!m || m.evidenceN >= perKcTarget(c.id)) continue;

        const accepted = (questionsByKc.get(c.id) ?? []).filter((q) => {
          const item = directionItems.find((i) => i.id === q.id);
          return !item || item.status === "accepted";
        });
        // 门槛按来源算：accepted 里若有生成题就要 4 道，否则 3 道
        const needed = perKcTarget(c.id);
        if (accepted.length < needed) return { id: c.id, name: c.name };
      }
      return null;
    },
    [graph, depths, targetId, skippedKcs, questionsByKc, directionItems, perKcTarget],
  );

  /** 懒生成某 KC 的题。失败时进 failed 状态，由界面给降级选项。 */
  const generateFor = useCallback(
    async (kcId: string, kcNameText: string) => {
      if (!target || target.kind !== "direction") return;
      const concept = target.graph.concepts.find((c) => c.id === kcId);
      if (!concept) return;

      if (!provider) {
        setGen({ kind: "no-model", kcId, kcName: kcNameText });
        return;
      }

      const controller = new AbortController();
      genAbort.current = controller;
      setGen({ kind: "loading", kcId, kcName: kcNameText, done: 0, total: ITEMS_PER_KC });

      const materialContext = buildMaterialContext(materialPack, [concept], materialSelection);
      /*
       * 没有可引用的教材 / 讲义片段时（未内置资料、或只有模型说法）不传：
       * 空上下文只会让提示词多一个空小节，题卡也会多一行没有定位点的「依据」。
       * citations 只看真正摘录到的片段，所以「模型说法」天然被排除在外。
       */
      const material =
        materialContext.citations.length === 0
          ? undefined
          : {
              context: materialContext.text,
              checkLabel: materialCheckLabel(materialContext.citations),
            };

      const result = await ensureItems({
        directionId: target.id,
        concept,
        provider,
        cached: directionItems.filter((i) => i.kcId === kcId),
        signal: controller.signal,
        material,
      });

      if (controller.signal.aborted) {
        setGen({ kind: "idle" });
        return;
      }

      if (result.error && result.generated === 0) {
        setGen({ kind: "failed", kcId, kcName: kcNameText, error: result.error });
        return;
      }
      // 生成成功但题不够/双解没跑完：题照用，提示照显
      setGenNotice(result.error ? `「${kcNameText}」：${result.error}` : null);

      /*
       * 生成过一次的 KC 记为已尝试。
       * 否则「生成成功但通过校验的题仍不足 4 道」会让 effect 反复触发生成，
       * 用户在不知情的情况下被反复计费——这比生成失败更糟。
       */
      attemptedGenKcs.current.add(kcId);

      // 重新拉一遍：服务端可能改了 status（例如把 practice 落成 accepted）
      const fresh = await fetchItems(target.id, kcId);
      setDirectionItems((prev) => [...prev.filter((i) => i.kcId !== kcId), ...fresh]);
      setGen({ kind: "idle" });
    },
    [target, provider, directionItems, materialPack, materialSelection],
  );

  // 出题：没有 current 且还没答满上限时，先看要不要生成，再选题
  useEffect(() => {
    if (!learner || !target || !graph || current || answered.length >= HARD_CAP) return;

    const picked = pickNext(learner);
    if (picked) {
      setCurrent(picked);
      return;
    }

    // 方向目标：没有可出的题时，尝试为下一个 KC 懒生成
    if (target.kind === "direction" && gen.kind === "idle" && !itemsLoading) {
      const need = kcNeedingItems(learner);
      if (need) void generateFor(need.id, need.name);
    }
  }, [
    learner,
    target,
    graph,
    current,
    answered.length,
    pickNext,
    gen.kind,
    itemsLoading,
    kcNeedingItems,
    generateFor,
  ]);

  /**
   * 还有没有「可以继续测」的知识点。
   *
   * 用于 done 判定：只有「没题可出」和「全部跳过/答满」才算结束，
   * 不能因为当前题目为空就宣布诊断完成——那是旧实现把「没题」当「没考点」的根源。
   */
  const canPickMore = useCallback(
    (state: typeof learner): boolean => {
      if (!state || !graph) return false;
      const stateProgress = progressOf(state, targetId, graph);
      return graph.concepts.some((c) => {
        if (skippedKcs.has(c.id)) return false;
        const m = stateProgress.mastery.find((x) => x.kcId === c.id);
        return Boolean(m) && (m as { evidenceN: number }).evidenceN < perKcTarget(c.id);
      });
    },
    [graph, targetId, skippedKcs, perKcTarget],
  );

  const submit = () => {
    if (!learner || !current || selected === null || !graph) return;

    const correct = selected === current.question.answerIndex;
    const beforeState = progress?.mastery.find((m) => m.kcId === current.question.kcId);
    const before = beforeState ? masteryMean(beforeState) : 0;

    /*
     * 折扣按落库的 source 判断，不按 id 前缀猜：
     * 手动题的 id 也是 di- 开头，用前缀会把 manual 错当 generated 打 0.8 折。
     */
    const weightScale = current.practiceOnly
      ? 0
      : current.origin === "generated"
        ? GENERATED_WEIGHT_SCALE
        : 1;

    const next = recordAttempt(
      learner,
      targetId,
      current.question,
      correct,
      new Date().toISOString(),
      { graph, weightScale },
    );
    const afterState = next.subjects[targetId]?.mastery.find(
      (m) => m.kcId === current.question.kcId,
    );
    const after = afterState ? masteryMean(afterState) : 0;

    setLearner(next);
    setAnswered((prev) => [
      ...prev,
      { question: current.question, correct, before, after, practiceOnly: current.practiceOnly },
    ]);
    setRevealed(true);
  };

  const next = () => {
    setSelected(null);
    setRevealed(false);
    if (learner) setCurrent(pickNext(learner));
  };

  /**
   * 重置本次会话，保留 learner（掌握度与历史作答都不动）。
   *
   * 必须把 gen 归到 idle：failed / no-model 卡片的渲染条件是 `!done && gen.kind === …`，
   * 只清 current 的话，重新诊断后上一轮失败的生成卡会立刻重新出现，
   * 看起来像「重新诊断没生效」。已尝试生成的 KC 也要一起清空，否则 effect 不会再触发。
   */
  const restartSession = () => {
    genAbort.current?.abort();
    genAbort.current = null;
    attemptedGenKcs.current = new Set();
    setGen({ kind: "idle" });
    setGenNotice(null);
    setAnswered([]);
    setCurrent(null);
    setSelected(null);
    setRevealed(false);
    setSkippedKcs(new Set());
  };

  /** 清空当前目标的全部掌握度与作答记录。不可撤销，必须二次确认。 */
  const clearAll = () => {
    if (!window.confirm("确定清空当前目标记录的全部掌握度与作答记录？此操作不可撤销。")) return;
    resetSubject();
    restartSession();
  };

  /**
   * 跳过当前知识点。
   *
   * kcId 来源按优先级：正在答的题 → 正在生成/失败/无模型的 KC。
   * 旧写法 `current?.question.kcId ?? gen.kind === "failed" ? ... : ""`
   * 被解析成 `(a ?? b) ? c : d`，no-model 时取到空串，
   * setSkippedKcs 根本没执行——按钮点了没反应。
   */
  const skipCurrentKc = () => {
    const kcId =
      current?.question.kcId ??
      (gen.kind === "loading" || gen.kind === "failed" || gen.kind === "no-model"
        ? gen.kcId
        : "");

    /*
     * 无模型时一次性跳过所有缺题的 KC。
     *
     * 没有模型意味着每个缺题的 KC 都会以同样方式失败；让用户点 15 次「跳过」
     * 是把系统的问题变成用户的劳动。这里只在 no-model 时批量跳过，
     * 生成失败（failed）仍逐个处理——那种情况换个模型可能就好了。
     */
    if (gen.kind === "no-model" && graph) {
      const allMissing = new Set<string>();
      for (const c of graph.concepts) {
        const qs = questionsByKc.get(c.id) ?? [];
        const accepted = qs.filter((q) => {
          const item = directionItems.find((i) => i.id === q.id);
          return !item || item.status === "accepted";
        });
        if (accepted.length === 0) {
          allMissing.add(c.id);
          attemptedGenKcs.current.add(c.id);
        }
      }
      setSkippedKcs((prev) => new Set([...prev, ...allMissing]));
    } else if (kcId !== "") {
      setSkippedKcs((prev) => new Set(prev).add(kcId));
      // 显式跳过也算「已尝试」，避免 effect 立刻为它重新触发生成
      attemptedGenKcs.current.add(kcId);
    }

    setGen({ kind: "idle" });
    setGenNotice(null);
    setCurrent(null);
    setSelected(null);
    setRevealed(false);
  };

  /*
   * 「本次诊断结束」的判定。
   *
   * 只有两种情况算结束：
   *   1. 答满 HARD_CAP
   *   2. 没有可测的知识点（全部达门槛或全部被跳过）
   *
   * 有可测的点但当前出不了题时**不算结束**——那要显示一张「卡住」卡，
   * 让用户选择重试 / 手动补题 / 跳过 / 只规划路径。
   * 旧实现把这种情况算成 done 或什么都不渲染，页面会停在空白。
   */
  const generationInFlight = gen.kind === "loading" || itemsLoading;
  const hasWork = canPickMore(learner);
  const done = answered.length >= HARD_CAP || (!current && !generationInFlight && !hasWork);

  /**
   * 「有工作要做、但当前既出不了题也触发了不生成」的那个 KC。
   *
   * 典型来源：该 KC 已有 1–3 道 accepted 题但没到门槛，剩下的题被 L4 降级成 practice，
   * 或者已经生成过一次（attemptedGenKcs 拦住自动重试）。
   * 没有这张卡时，三个谓词同时为假，页面只剩进度卡与答题记录，用户不知道发生了什么。
   */
  // 用普通函数而不是 useMemo：这段要读 ref（attemptedGenKcs）与 gen 状态，
  // memo 依赖既写不全也不稳定，缓存收益远小于「读到旧值」的风险。
  const computeStuckKc = () => {
    if (!learner || !graph || current || done || generationInFlight) return null;

    const stateProgress = progressOf(learner, targetId, graph);
    const sorted = [...graph.concepts].sort((a, b) => {
      const da = depths.get(a.id) ?? 0;
      const db = depths.get(b.id) ?? 0;
      if (da !== db) return da - db;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    for (const c of sorted) {
      if (skippedKcs.has(c.id)) continue;
      const m = stateProgress.mastery.find((x) => x.kcId === c.id);
      if (!m || m.evidenceN >= perKcTarget(c.id)) continue;

      const qs = questionsByKc.get(c.id) ?? [];
      const accepted = qs.filter((q) => {
        const item = directionItems.find((i) => i.id === q.id);
        return !item || item.status === "accepted";
      });
      const remaining = qs.filter((q) => {
        const doneIds = attemptedQuestionIds(learner, targetId, c.id, graph);
        return !doneIds.has(q.id);
      });
      const needed = perKcTarget(c.id);

      // 还有可出的题 → 不算卡住（pickNext 会处理）
      if (remaining.length > 0) continue;
      // 题够了但已答满 → 正常结束该 KC
      if (accepted.length >= needed) continue;

      return {
        id: c.id,
        name: c.name,
        accepted: accepted.length,
        needed,
      };
    }
    return null;
  };
  const stuckKc = computeStuckKc();

  if (!ready || !learnerReady || !learner || !progress || !target || !graph) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 py-10">
          <p className="text-[var(--ink-soft)]">
            {loadingTarget ? "正在加载自定义方向…" : "正在读取你的学习记录…"}
          </p>
        </main>
      </>
    );
  }

  const correctCount = answered.filter((a) => a.correct).length;
  const directionId = target.kind === "direction" ? target.id : null;

  /*
   * 未决口径分歧：只提示，不替用户裁定。
   *
   * 只提示当前这道题涉及的分歧：整个资料包一次铺开，会把「栈顶指针」印在排序题上方。
   * 内置学科的题来自静态题库、根本不会生成回答，所以只对自定义方向显示。
   */
  const relevantConflicts =
    target.kind === "direction" && current
      ? unresolved.filter((c) => c.kcId === current.question.kcId)
      : [];
  const conflictLine =
    relevantConflicts.length > 0 ? (
      <p className="mb-5 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn)]">
        {`这道题的口径尚未选定：${relevantConflicts
          .map((c) => `${kcName.get(c.kcId) ?? c.kcId}「${c.topic}」`)
          .join("、")}（生成时会同时给出两种说法）`}
      </p>
    ) : null;

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">诊断测评</h1>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              按先修顺序出题，每答一题立即更新掌握度。每个知识点测够 3–4 题即可生成路径。
            </p>
          </div>
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm text-[var(--ink-soft)] hover:bg-[var(--line)]"
          >
            清空当前目标记录（含掌握度）
          </button>
        </div>

        {/* 目标切换 */}
        <Card className="mb-5">
          <p className="mb-2 text-sm font-medium">当前学习目标</p>
          <TargetPicker
            current={targetId}
            onChange={setTargetId}
            onNewDirection={() => setShowNewDirection((v) => !v)}
          />
          <p className="mt-2 text-xs text-[var(--ink-faint)]">{targetCaption(target)}</p>
          {targetError ? (
            <p className="mt-2 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2 text-xs text-[var(--warn)]">
              {targetError}
            </p>
          ) : null}
        </Card>

        {/* 内联新建方向 */}
        {showNewDirection ? (
          <NewDirectionPanel
            onCancel={() => setShowNewDirection(false)}
            onSaved={(id, name, g) => {
              setShowNewDirection(false);
              setTarget({ kind: "direction", id, name, graph: g });
              const url = new URL(window.location.href);
              url.searchParams.set("direction", id);
              url.searchParams.delete("subject");
              window.history.replaceState(null, "", url.toString());
            }}
          />
        ) : null}

        {/* 进度 */}
        <Card className="mb-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--ink-soft)]">
              本次已答{" "}
              <span className="tabular font-medium text-[var(--ink)]">{answered.length}</span> /{" "}
              {HARD_CAP} 题
            </span>
            <span className="text-[var(--ink-soft)]">
              正确 <span className="tabular font-medium text-[var(--ink)]">{correctCount}</span> 题
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-300"
              style={{ width: `${Math.min(100, (answered.length / HARD_CAP) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--ink-faint)]">
            {progress.attempts.length > 0
              ? `该目标历史累计作答 ${progress.attempts.length} 题 · `
              : ""}
            {synced ? "进度已同步到账号" : "进度仅存本浏览器"}
          </p>
        </Card>

        {/* 生成区上方的口径分歧提示 */}
        {!done && !current ? conflictLine : null}

        {/* 生成中 */}
        {!done && gen.kind === "loading" ? (
          <Card className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                <span>
                  正在为「{gen.kcName}」生成 {ITEMS_PER_KC} 道题
                  <span className="tabular ml-1 text-[var(--ink-faint)]">
                    （{gen.done}/{ITEMS_PER_KC}）
                  </span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  genAbort.current?.abort();
                  setGen({ kind: "idle" });
                  setSkippedKcs((prev) => new Set(prev).add(gen.kcId));
                }}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                取消并跳过
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--ink-faint)]">
              一次生成 4 题，再做两次独立批解校验（第二次反转选项顺序）。
              通过的题会落库，下次诊断不再重复生成。
            </p>
          </Card>
        ) : null}

        {/* 未配置模型 */}
        {!done && gen.kind === "no-model" && !stuckKc ? (
          <Card className="mb-5 border-[var(--warn)] bg-[var(--warn-soft)]">
            <p className="text-sm font-medium text-[var(--warn)]">
              「{gen.kcName}」还没有题目，且未配置模型供应商
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              没有题目就不做诊断，但路径规划不依赖题目——图谱在创建方向时已经生成并校验过。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/settings"
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent)]"
              >
                去配置模型
              </Link>
              <Link
                href={directionId ? `/path?direction=${directionId}` : "/path"}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                只规划路径（不诊断）
              </Link>
              <button
                type="button"
                onClick={skipCurrentKc}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                跳过这个知识点
              </button>
            </div>
          </Card>
        ) : null}

        {/* 生成失败 */}
        {!done && gen.kind === "failed" && !stuckKc ? (
          <Card className="mb-5 border-[var(--bad)] bg-[var(--bad-soft)]">
            <p className="text-sm font-medium text-[var(--bad)]">
              「{gen.kcName}」的题目生成失败
            </p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">{gen.error}</p>
            <p className="mt-2 text-xs text-[var(--ink-faint)]">
              题目生成失败不阻塞路径：图谱已存在，路径仍可规划。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={directionId ? `/path?direction=${directionId}` : "/path"}
                className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent)]"
              >
                只规划路径（不诊断）
              </Link>
              <Link
                href={directionId ? `/directions#${directionId}` : "/directions"}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                手动添加题目
              </Link>
              <button
                type="button"
                onClick={() => {
                  // 用户显式要求重试，清掉「已尝试」标记
                  attemptedGenKcs.current.delete(gen.kcId);
                  void generateFor(gen.kcId, gen.kcName);
                }}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                换模型重试
              </button>
              <button
                type="button"
                onClick={skipCurrentKc}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                跳过这个知识点
              </button>
            </div>
          </Card>
        ) : null}

        {/* 非阻塞提示 */}
        {genNotice ? (
          <Card className="mb-5 border-[var(--warn)] bg-[var(--warn-soft)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm text-[var(--warn)]">{genNotice}</p>
              <button
                type="button"
                onClick={() => setGenNotice(null)}
                className="shrink-0 rounded border border-[var(--warn)] px-2 py-0.5 text-xs text-[var(--warn)]"
              >
                知道了
              </button>
            </div>
          </Card>
        ) : null}

        {/*
          卡住卡：这个 KC 还有证据要补，但已没有可出的题。
          必须显式给出四个出口，否则页面只剩进度卡与答题记录，
          用户看不出「是题不够」还是「系统坏了」。
        */}
        {stuckKc ? (
          <Card className="mb-5 border-[var(--warn)] bg-[var(--warn-soft)]">
            <p className="text-sm font-medium text-[var(--warn)]">
              「{stuckKc.name}」的题目不够，无法继续测这个知识点
            </p>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              这个知识点已有 {stuckKc.accepted} 道可用题，需要 {stuckKc.needed} 道才能达到
              证据门槛。其余题可能因答案校验未通过而未采用，或已被你答完。
            </p>
            {gen.kind === "no-model" ? (
              <p className="mt-1 text-sm text-[var(--warn)]">
                当前没有配置模型供应商，无法自动出题。可以到设置页配置，
                或手动补题，也可以先只规划路径。
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {/*
                无模型时「再生成一批」只会把状态再设回 no-model，是静默空操作。
                这种情况下换成「去配置模型」的直达链接，避免用户点了没反应。
              */}
              {gen.kind === "no-model" ? (
                <Link
                  href="/settings"
                  className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent)]"
                >
                  去配置模型
                </Link>
              ) : null}
              {directionId ? (
                <>
                  {gen.kind !== "no-model" ? (
                    <button
                      type="button"
                      onClick={() => {
                        attemptedGenKcs.current.delete(stuckKc.id);
                        void generateFor(stuckKc.id, stuckKc.name);
                      }}
                      className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent)]"
                    >
                      再生成一批
                    </button>
                  ) : null}
                  <Link
                    href={`/directions#${directionId}`}
                    className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
                  >
                    手动补题
                  </Link>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  /*
                   * 一次跳过所有「没题且未达门槛」的 KC。
                   * 逐个跳过会让用户连点十几次——每个 KC 都会弹出同样的卡，
                   * 而原因（无模型 / 生成失败）对所有 KC 是一样的。
                   */
                  if (!learner || !graph) return;
                  const stateProgress = progressOf(learner, targetId, graph);
                  const all = new Set<string>();
                  for (const c of graph.concepts) {
                    if (skippedKcs.has(c.id)) continue;
                    const m = stateProgress.mastery.find((x) => x.kcId === c.id);
                    if (!m || m.evidenceN >= perKcTarget(c.id)) continue;
                    const qs = questionsByKc.get(c.id) ?? [];
                    const accepted = qs.filter((q) => {
                      const item = directionItems.find((i) => i.id === q.id);
                      return !item || item.status === "accepted";
                    });
                    const remaining = qs.filter(
                      (q) => !attemptedQuestionIds(learner, targetId, c.id, graph).has(q.id),
                    );
                    if (remaining.length === 0 && accepted.length < perKcTarget(c.id)) {
                      all.add(c.id);
                      attemptedGenKcs.current.add(c.id);
                    }
                  }
                  setSkippedKcs((prev) => new Set([...prev, ...all]));
                  setGen({ kind: "idle" });
                }}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                跳过所有缺题的知识点
              </button>
              <Link
                href={directionId ? `/path?direction=${directionId}` : "/path"}
                className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm"
              >
                只规划路径（不诊断）
              </Link>
            </div>
          </Card>
        ) : null}

        {/* 题卡上方的口径分歧提示 */}
        {current && !done ? conflictLine : null}

        {/* 当前题目 */}
        {current && !done ? (
          <Card className="mb-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Pill tone="accent">{current.kcName}</Pill>
              <Pill>难度 {current.question.difficulty}</Pill>
              <Pill>先修深度 {current.depth}</Pill>
              {current.origin === "generated" ? (
                <Pill tone="warn">
                  模型生成 · 已通过 {current.checkCount} 项校验
                </Pill>
              ) : current.origin === "manual" ? (
                <Pill tone="warn">手动录入 · 未做机器校验</Pill>
              ) : current.origin === "borrowed" ? (
                <Pill tone="warn">借用自内置题库</Pill>
              ) : null}
              {current.practiceOnly ? <Pill tone="warn">仅练习，不计入掌握度</Pill> : null}
            </div>
            <h2 className="text-base font-medium leading-relaxed">{current.question.stem}</h2>

            {/*
              出处：生成题显示落库的「依据：…」，内置题没有页级出处，只标明题库与章节。
              origin 为 undefined 只可能是内置题库题——方向题的 source 必为
              generated / manual / borrowed 三者之一。
            */}
            {current.materialLabel ? (
              <p className="mt-2 text-xs text-[var(--ink-soft)]">{current.materialLabel}</p>
            ) : current.origin === undefined ? (
              <p className="mt-2 text-xs text-[var(--ink-faint)]">
                {current.chapter} · 内置题库（无页级出处）
              </p>
            ) : null}

            <fieldset className="mt-4 space-y-2" disabled={revealed}>
              <legend className="sr-only">选择一个答案</legend>
              {current.question.options.map((opt, i) => {
                const isSelected = selected === i;
                const isCorrect = i === current.question.answerIndex;
                let tone = "border-[var(--line-strong)] hover:border-[var(--ink-faint)]";
                if (revealed && isCorrect)
                  tone = "border-[var(--good)] bg-[var(--good-soft)]";
                else if (revealed && isSelected && !isCorrect)
                  tone = "border-[var(--bad)] bg-[var(--bad-soft)]";
                else if (isSelected)
                  tone = "border-[var(--accent)] bg-[var(--accent-soft)]";

                return (
                  <label
                    key={i}
                    className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors ${tone} ${revealed ? "cursor-default" : "cursor-pointer"}`}
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
              <div className="mt-4 rounded-lg bg-[var(--canvas)] p-3 text-sm">
                <p className="font-medium">
                  {selected === current.question.answerIndex ? "回答正确" : "回答错误"}
                </p>
                <p className="mt-1 text-[var(--ink-soft)]">{current.question.explanation}</p>
                <p className="tabular mt-2 text-xs text-[var(--ink-faint)]">
                  该知识点掌握度：{Math.round((answered[answered.length - 1]?.before ?? 0) * 100)}
                  % → {Math.round((answered[answered.length - 1]?.after ?? 0) * 100)}%
                  {current.practiceOnly ? "（本题仅练习，掌握度未变）" : ""}
                </p>
                <button
                  type="button"
                  onClick={next}
                  className="mt-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]"
                >
                  下一题
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={selected === null}
                className="mt-4 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
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
            {answered.length === 0 ? (
              <p className="text-sm text-[var(--ink-soft)]">
                {target.kind === "direction"
                  ? "这个方向暂时没有可出的题（可能题目还没生成，或已全部作答）。可以先去看学习路径——路径规划不需要题目。"
                  : "该目标的题目已全部作答完毕。可以去查看学习路径，或切换学习目标继续。"}
              </p>
            ) : (
              <div className="space-y-3">
                {summarize(answered, progress, perKcTarget).map((row) => (
                  <MasteryBar
                    key={row.kcId}
                    mean={row.mean}
                    sd={row.sd}
                    evidenceN={row.n}
                    label={kcName.get(row.kcId) ?? row.kcId}
                    probabilityAbove={row.probAbove}
                    evidenceShortfall={row.shortfall}
                    evidenceTarget={row.target}
                  />
                ))}
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href={directionId ? `/path?direction=${directionId}` : "/path"}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]"
              >
                查看学习路径
              </Link>
              <button
                type="button"
                onClick={restartSession}
                className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
              >
                重新诊断
              </button>
              {directionId ? (
                <Link
                  href={`/directions#${directionId}`}
                  className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
                >
                  管理这个方向
                </Link>
              ) : null}
            </div>
          </Card>
        ) : null}

        {/* 已答题目回顾 */}
        {answered.length > 0 ? (
          <section>
            <SectionTitle>本次答题记录</SectionTitle>
            <div className="space-y-2">
              {answered.map((a, i) => (
                <Card key={`${a.question.id}-${i}`} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{a.question.stem}</p>
                      <p className="mt-0.5 text-xs text-[var(--ink-faint)]">
                        {kcName.get(a.question.kcId)} · 难度 {a.question.difficulty}
                        {a.practiceOnly ? " · 仅练习" : ""}
                      </p>
                    </div>
                    <Pill tone={a.correct ? "good" : "bad"}>{a.correct ? "对" : "错"}</Pill>
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

/** 把作答汇总成每个知识点的最新状态。用传入的 progress，不读存储。 */
function summarize(
  answered: AnsweredRow[],
  progress: {
    mastery: readonly { kcId: string; alpha: number; beta: number; evidenceN: number }[];
  },
  /** 该 KC 的实际证据门槛：内置/手动 3 题，生成题 4 题。 */
  targetOf: (kcId: string) => number,
): {
  kcId: string;
  mean: number;
  sd: number;
  n: number;
  probAbove: number;
  shortfall: "count" | "precision" | null;
  target: number;
}[] {
  const kcIds = [...new Set(answered.map((a) => a.question.kcId))];

  return kcIds.map((kcId) => {
    const m = progress.mastery.find((x) => x.kcId === kcId);
    const n = m?.evidenceN ?? 0;
    const target = targetOf(kcId);
    return {
      kcId,
      mean: m ? masteryMean(m) : 0,
      sd: m ? masterySd(m) : 1,
      n,
      probAbove: m ? masteryProbAbove(m, 0.6) : 0,
      /*
       * 把「为什么不算充分」拆开说。
       * 旧实现只说「未达 N 题门槛」，n 已经等于 N（内置题 3 题）时自相矛盾，
       * 而且题库每 KC 恰好 3 题、停测也在 3 题时停止，
       * 这类「对错分裂」的 KC 会永久显示一个无法消除的「不足」。
       */
      shortfall:
        n === 0
          ? null
          : n < target
            ? ("count" as const)
            : hasEnoughEvidence(m!, target)
              ? null
              : ("precision" as const),
      target,
    };
  });
}

/** 内联新建方向。不用 modal，避免焦点管理与 Esc 处理。 */
function NewDirectionPanel({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (id: string, name: string, graph: LearningTarget["graph"]) => void;
}) {
  const draftState = useDirectionDraft();
  const [publish, setPublish] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { user } = useAuth();

  const handleSave = async () => {
    setSaveError(null);
    const id = await draftState.save({ isPublic: publish });
    if (!id) {
      setSaveError(draftState.error ?? "保存失败");
      return;
    }
    // 保存成功后拉回完整图谱，交给上层切换目标
    const res = await fetch(`/api/directions?id=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      setSaveError("方向已保存，但加载失败。请刷新页面后从「我的方向」里选择。");
      return;
    }
    const data = (await res.json()) as {
      id: string;
      title: string;
      graph: LearningTarget["graph"];
    };
    onSaved(data.id, data.title, data.graph);
  };

  return (
    <Card className="mb-5">
      <SectionTitle
        hint={
          draftState.provider
            ? `将使用 ${draftState.provider.label} · ${draftState.provider.model} 生成`
            : "未配置模型，将从现有学科中挑选相关知识点"
        }
      >
        新建方向
      </SectionTitle>

      {!user ? (
        <p className="text-sm text-[var(--ink-soft)]">
          自定义方向需要账号才能保存（这样换设备也不会丢）。
          <Link href="/login" className="ml-1 underline">
            去登录
          </Link>
        </p>
      ) : (
        <>
          <label className="block">
            <span className="block text-sm font-medium">你想学什么</span>
            <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
              越具体越好。例如「我想搞懂数据库索引为什么用 B+ 树」
            </span>
            <textarea
              value={draftState.description}
              onChange={(e) => draftState.setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1.5 w-full resize-y rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
              placeholder="例如：我想系统学一遍树结构，从基本概念到平衡树"
            />
          </label>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void draftState.generate()}
              disabled={draftState.generating || draftState.description.trim() === ""}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {draftState.generating ? "生成中…" : "生成"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
            >
              取消
            </button>
          </div>

          {draftState.error ? (
            <div className="mt-3 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-3 text-sm">
              <p className="text-[var(--bad)]">{draftState.error}</p>
              {draftState.issues.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--ink-soft)]">
                  {draftState.issues.map((i) => (
                    <li key={i}>· {i}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {draftState.draft ? (
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Pill tone={draftState.source === "llm" ? "good" : "warn"}>
                  {draftState.source === "llm" ? "模型生成" : "从现有学科挑选"}
                </Pill>
                <span className="text-xs text-[var(--ink-faint)]">
                  {draftState.draft.concepts.length} 个知识点 ·{" "}
                  {draftState.draft.edges.length} 条先修关系
                </span>
              </div>

              <p className="font-medium">{draftState.draft.title}</p>
              <p className="mt-1 text-sm text-[var(--ink-soft)]">
                {draftState.draft.description}
              </p>

              <ol className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
                {draftState.draft.concepts.map((c, i) => (
                  <li key={c.id} className="flex gap-2 text-sm">
                    <span className="tabular shrink-0 text-[var(--ink-faint)]">{i + 1}.</span>
                    <span className="min-w-0">
                      <span className="font-medium">{c.name}</span>
                      {c.summary ? (
                        <span className="ml-1.5 text-[var(--ink-soft)]">— {c.summary}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>

              <label className="mt-4 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={publish}
                  onChange={(e) => setPublish(e.target.checked)}
                  className="mt-1"
                />
                <span>公开到方向市场</span>
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={draftState.saving}
                  className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
                >
                  {draftState.saving ? "保存中…" : "保存并开始诊断"}
                </button>
                <button
                  type="button"
                  onClick={draftState.reset}
                  className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
                >
                  重新生成
                </button>
              </div>
              {saveError ? <p className="mt-2 text-sm text-[var(--bad)]">{saveError}</p> : null}
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
