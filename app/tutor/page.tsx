"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useSubject } from "@/lib/subject";
import { TargetPicker, targetCaption } from "@/components/target-picker";
import { loadLearner, progressOf, type LearnerState } from "@/lib/learner";
import { loadProvider, maskKey, type ProviderConfig } from "@/lib/provider";
import { callChat } from "@/lib/chat";
import { search, buildIndex, type Bm25Index } from "@/lib/rag";
import { masteryMean, masterySd } from "@/lib/mastery";
import type { MasteryState } from "@/lib/mastery";
import { useMaterialPack } from "@/lib/materialStore";
import {
  MAX_CONTEXT_CHARS,
  buildMaterialContext,
  citationLabel,
  excerptFor,
  type MaterialConflict,
  type MaterialExcerpt,
  type MaterialPack,
  type MaterialSelection,
} from "@/lib/materials";
import type { KnowledgeConcept } from "@/lib/graph";

/**
 * 导师对话。
 *
 * 两条路径，界面上必须如实区分：
 *   1. 配置了供应商 → 浏览器直连该供应商，检索结果作为上下文
 *   2. 未配置 → 知识库检索 + 题库解析的结构化拼装
 *
 * 为什么在浏览器直连而不是走本项目后端：
 * 用户的 key 不该经过我们的服务器。这样部署在 Vercel 上也不需要保管任何密钥。
 * 代价是受 CORS 约束——所以设置页里明确提示了这一点。
 */

interface Message {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly citations: { kcId: string; title: string }[];
  readonly generatedByLlm: boolean;
  readonly note?: string;
  /** 教材 / 讲义出处抬头，元素是 citationLabel 的输出，原样展示。 */
  readonly sources: string[];
  /** 本次回答涉及的未决口径分歧，已格式化成可直接展示的一行。 */
  readonly conflicts: string[];
}

const SYSTEM_PROMPT = `你是一门大学课程的助教。回答必须遵守：

1. 只依据提供的「知识点资料」作答。资料里没有的，直接说「资料里没有这一条」，不要凭记忆补充。
2. 每个结论后用 [知识点ID] 标注依据，例如「栈是后进先出 [c09]」。
3. 学生问「为什么给我排这一步」时，用他的掌握度数值解释，不要编造他没做过的题。
4. 不要许诺系统没有的功能。
5. 提供了「教材 / 讲义摘录」时，以摘录为准；摘录里没有的说法不要当成教材结论。
6. 摘录与「知识点资料」说法不一致时，明确说出分歧，并分别标注两边出处，不要合成一种说法。
7. 不得编造页码：只引用摘录中出现的章节与页码，摘录没有页码就不写。
8. 中文回答，200 字以内，不要用「首先/其次/最后」这种套话。`;

/** 有摘录时展示的口径说明。没有摘录就不显示，避免暗示回答有教材依据。 */
const MATERIAL_BASIS_NOTE =
  "口径：有教材 / 讲义摘录时以摘录为准；摘录与知识点资料不一致处分别标注出处，页码只取自摘录，没标页码就不推断。";

export default function TutorPage() {
  const { target, targetId, setTargetId, ready, loadingTarget } = useSubject();
  const [learner, setLearner] = useState<LearnerState | null>(null);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // 按学科建检索索引（学科切换时重建）
  const [index, setIndex] = useState<Bm25Index | null>(null);

  /*
   * 教材 / 讲义口径。graph 传进去是为了让笔记按绑定知识点继承章节，
   * 自定义方向没有内置资料包，返回的是空包，界面不会凭空出现出处。
   */
  const { pack: materialPack, selection: materialSelection } = useMaterialPack(
    targetId,
    target?.graph,
  );

  useEffect(() => {
    setLearner(loadLearner());
    setProvider(loadProvider());
  }, []);

  useEffect(() => {
    if (!target) return;
    /*
     * 每个知识点一篇文档：名称 + 章节 + 要掌握什么 + 题目解析。
     * 自定义方向没有内置题库（题目要按需生成），所以只用名称与摘要建索引，
     * 界面会如实标注「该方向暂无题库解析」。
     */
    const questions = target.kind === "subject" ? target.questions : [];
    const docs = target.graph.concepts.map((c) => {
      const qs = questions.filter((q) => q.kcId === c.id);
      const qa = qs
        .map((q, i) => `第${i + 1}题（难度${q.difficulty}）：${q.stem} 解析：${q.explanation}`)
        .join(" ");
      return {
        kcId: c.id,
        title: c.name,
        text: `${c.chapter}。${c.summary}。${qa ? `常见考点与解析：${qa}` : ""}`,
      };
    });
    setIndex(buildIndex(docs));
    setMessages([]);
  }, [target]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const masteryOf = (): readonly MasteryState[] => {
    if (!learner) return [];
    return progressOf(learner, targetId, target?.graph).mastery;
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (question.length === 0 || busy || !index || !target) return;

    setError(null);
    setBusy(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        text: question,
        citations: [],
        generatedByLlm: false,
        sources: [],
        conflicts: [],
      },
    ]);

    const mastery = masteryOf();
    const docs = search(index, question, 3);

    /*
     * 检索命中的 kcId 才是要查教材的知识点。
     * 检索分数高但图谱里没有的 id 不查——那说明索引与图谱不同步，
     * 凭空多出一段摘录会让学生以为教材里真写了。
     */
    const conceptById = new Map(target.graph.concepts.map((c) => [c.id, c] as const));
    const concepts = docs
      .map((d) => conceptById.get(d.kcId))
      .filter((c): c is KnowledgeConcept => c !== undefined);
    const material = materialForAnswer(materialPack, materialSelection, concepts);
    const conflicts = material.conflicts.map((c) => describeConflict(materialPack, c));

    // 未配置供应商：直接走结构化拼装
    if (!provider) {
      const composed = composeDeterministic(question, docs, mastery, material.excerpts);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: composed.text,
          citations: docs.map((d) => ({ kcId: d.kcId, title: d.title })),
          generatedByLlm: false,
          note: "未配置模型供应商，本次由知识库检索拼装",
          sources: composed.sources,
          conflicts,
        },
      ]);
      setBusy(false);
      return;
    }

    // 配置了供应商：浏览器直连
    try {
      const reply = await callProvider(provider, question, docs, mastery, material.promptContext);
      /*
       * 引用不是「检索到了什么」，而是「回复里真的引用了什么」。
       * 旧实现把 docs 全部列为 citations，模型不引用或引错时界面仍显示 3 个知识点，
       * 等于把提示词里的要求当成已满足的事实。
       */
      const cited = extractCitedKcIds(reply, docs);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: reply,
          citations: cited,
          generatedByLlm: true,
          note:
            cited.length === 0
              ? `${provider.label} · ${provider.model} · 本次回复未包含可核对的 [知识点ID] 引用`
              : `${provider.label} · ${provider.model}`,
          /*
           * sources 是「本次注入的摘录」，不是「模型声称引用了这些」。
           * 模型一个 [知识点ID] 都没引用时，note 会如实说明；
           * 出处行仍然列出可核对的原文，方便学生自己比对模型有没有照摘录说。
           */
          sources: material.sources,
          conflicts,
        },
      ]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const composed = composeDeterministic(question, docs, mastery, material.excerpts);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: composed.text,
          citations: docs.map((d) => ({ kcId: d.kcId, title: d.title })),
          generatedByLlm: false,
          note: `模型调用失败（${reason}），已退回检索拼装`,
          sources: composed.sources,
          conflicts,
        },
      ]);
      setError(`模型调用失败：${reason}。可以到设置页测试连通性。`);
    } finally {
      setBusy(false);
    }
  };

  if (!ready || !target) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 py-10">
          <p className="text-[var(--ink-soft)]">
            {loadingTarget ? "正在加载自定义方向…" : "正在加载…"}
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">课程导师</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            回答只依据课程知识库。没配供应商时用检索结果回答，并如实标注。
          </p>
        </div>

        {/* 目标切换 */}
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium">当前学习目标</p>
          <TargetPicker current={targetId} onChange={setTargetId} />
          {target ? (
            <p className="mt-2 text-xs text-[var(--ink-faint)]">{targetCaption(target)}</p>
          ) : null}
        </Card>

        {/* 当前模式 */}
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--ink-soft)]">当前模式</span>
            {provider ? (
              <>
                <Pill tone="good">大模型 + 检索</Pill>
                <span className="text-xs text-[var(--ink-faint)]">
                  {provider.label} · {provider.model} · key {maskKey(provider.apiKey)}
                </span>
              </>
            ) : (
              <>
                <Pill tone="warn">知识库检索</Pill>
                <span className="text-xs text-[var(--ink-faint)]">
                  未配置供应商，回答由知识点文档检索拼装 ·{" "}
                  <Link href="/settings" className="underline">
                    去配置
                  </Link>
                </span>
              </>
            )}
          </div>
        </Card>

        {/* 对话区 */}
        <div className="mb-4 space-y-3">
          {messages.length === 0 ? (
            <Card>
              <SectionTitle hint="点一个试试，或者直接输入你的问题。">
                可以这样问
              </SectionTitle>
              <div className="flex flex-wrap gap-2">
                {[
                  "为什么给我排这一步？",
                  `${target?.graph.concepts[0]?.name ?? ""}是什么`,
                  `${target?.graph.concepts[1]?.name ?? ""}的重点是什么`,
                  "我现在的薄弱点在哪",
                ].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </Card>
          ) : null}

          {messages.map((m, i) => (
            <Card
              key={i}
              className={
                m.role === "user"
                  ? "ml-8 border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "mr-8"
              }
            >
              {m.role === "assistant" && m.conflicts.length > 0 ? (
                <div className="mb-3 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2">
                  <p className="text-xs font-medium text-[var(--warn)]">口径未定，先看两说</p>
                  {m.conflicts.map((c) => (
                    <p key={c} className="mt-1 text-xs leading-relaxed text-[var(--warn)]">
                      {c}
                    </p>
                  ))}
                </div>
              ) : null}

              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>

              {m.role === "assistant" ? (
                <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
                  {m.citations.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-[var(--ink-faint)]">引用</span>
                      {m.citations.map((c) => (
                        <Pill key={c.kcId} tone="accent">
                          {c.title} [{c.kcId}]
                        </Pill>
                      ))}
                    </div>
                  ) : null}
                  {m.sources.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
                        出处：{m.sources.join("；")}
                      </p>
                      <p className="text-xs leading-relaxed text-[var(--ink-faint)]">
                        {MATERIAL_BASIS_NOTE}
                      </p>
                    </div>
                  ) : null}
                  {m.note ? (
                    <p className="text-xs text-[var(--ink-faint)]">{m.note}</p>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ))}

          {busy ? (
            <Card className="mr-8">
              <div className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" />
                正在检索课程知识库…
              </div>
            </Card>
          ) : null}

          {error ? (
            <Card className="border-[var(--bad)] bg-[var(--bad-soft)]">
              <p className="text-sm text-[var(--bad)]">{error}</p>
              <p className="mt-1 text-xs text-[var(--ink-soft)]">
                路径功能不受影响——它不依赖网络与大模型。
              </p>
            </Card>
          ) : null}

          <div ref={endRef} />
        </div>

        {/* 输入 */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex gap-2"
        >
          <label htmlFor="q" className="sr-only">
            输入你的问题
          </label>
          <input
            id="q"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder="问点什么，比如「为什么给我排这一步」"
            className="flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
          >
            发送
          </button>
        </form>
      </main>
    </>
  );
}

/**
 * 从模型回复里抽出真正被引用的知识点。
 *
 * 只保留「回复里出现过 [kcId]、且该 kcId 确实在本次检索结果里」的项：
 * 前者防止把没引用说成引用，后者防止模型编造一个不在资料里的 id。
 * 顺序按回复里首次出现的顺序，不按检索得分——引用列表应当复现回复的结构。
 */
function extractCitedKcIds(
  reply: string,
  docs: readonly { kcId: string; title: string }[],
): { kcId: string; title: string }[] {
  const byId = new Map(docs.map((d) => [d.kcId, d]));
  const seen = new Set<string>();
  const out: { kcId: string; title: string }[] = [];

  for (const match of reply.matchAll(/\[([a-z][a-z0-9_]{0,15})\]/gi)) {
    const id = match[1].toLowerCase();
    if (seen.has(id)) continue;
    const doc = byId.get(id);
    if (!doc) continue;
    seen.add(id);
    out.push({ kcId: doc.kcId, title: doc.title });
  }

  return out;
}

/** 无模型时的回答：检索结果 + 教材摘录 + 掌握度数值。 */
function composeDeterministic(
  question: string,
  docs: { kcId: string; title: string; snippet: string }[],
  mastery: readonly MasteryState[],
  excerpts: ReadonlyMap<string, MaterialExcerpt>,
): { text: string; sources: string[] } {
  const byId = new Map(mastery.map((m) => [m.kcId, m]));

  if (docs.length === 0) {
    return {
      text:
        `课程资料里没有检索到与「${question}」直接相关的内容。\n\n` +
        `当前学科的知识点都已在知识图谱里，可以换个说法，或者告诉我你在看哪一章。`,
      sources: [],
    };
  }

  const sources: string[] = [];
  const lines = docs.map((d) => {
    const m = byId.get(d.kcId);
    const state = m
      ? `你目前在这个知识点上已测 ${m.evidenceN} 题，掌握度 ${Math.round(masteryMean(m) * 100)}%（±${Math.round(masterySd(m) * 100)}）。`
      : "你还没有测过这个知识点。";

    /*
     * 每条都先给出处再给原文：摘录才是教材口径，
     * 检索摘要只是知识点文档，两者不能混在一起让学生分不清哪句是书上的。
     * 没有摘录时如实说没有，不拿知识点摘要冒充教材原文。
     */
    const excerpt = excerpts.get(d.kcId);
    const sourceLine = excerpt
      ? `出处：${citationLabel(excerpt)}`
      : "出处：教材 / 讲义里没有这个知识点的摘录";
    if (excerpt) {
      const label = citationLabel(excerpt);
      if (!sources.includes(label)) sources.push(label);
    }
    const body = excerpt ? excerpt.text : d.snippet;

    return `**${d.title}** [${d.kcId}]\n${sourceLine}\n${body}\n${state}`;
  });

  return {
    text:
      lines.join("\n\n") +
      `\n\n（以上内容由课程知识库与教材 / 讲义原文直接拼装。` +
      `到设置页配置后可得自然语言讲解，检索依据不变。）`,
    sources,
  };
}

/**
 * 一次回答要用的教材 / 讲义材料。
 *
 * promptContext 是按全部命中知识点共享 2400 字预算裁剪后的整段摘录，注入模型；
 * excerpts 按 kcId 拆开，给无模型拼装逐条标出处。
 * 两者都出自同一条排序规则（materials.ts 的 chunksForConcept），页码口径不会分叉。
 */
interface AnswerMaterial {
  readonly promptContext: string;
  readonly excerpts: ReadonlyMap<string, MaterialExcerpt>;
  /** 实际注入模型的出处抬头，去重后保持首次出现顺序。 */
  readonly sources: string[];
  readonly conflicts: readonly MaterialConflict[];
}

function materialForAnswer(
  pack: MaterialPack,
  selection: MaterialSelection,
  concepts: readonly KnowledgeConcept[],
): AnswerMaterial {
  const combined = buildMaterialContext(pack, concepts, selection, MAX_CONTEXT_CHARS);

  const excerpts = new Map<string, MaterialExcerpt>();
  for (const concept of concepts) {
    const excerpt = excerptFor(pack, concept, selection);
    if (excerpt) excerpts.set(concept.id, excerpt);
  }

  return {
    promptContext: combined.text,
    excerpts,
    sources: [...new Set(combined.citations.map((c) => c.label))],
    conflicts: combined.unresolved,
  };
}

/**
 * 未决分歧的提示语：把每种说法和它的出处都摆出来，不替用户选边。
 *
 * 书目名只从数据包里取；没有实体来源的说法标成「模型」，
 * 不能给它编一个《…》——那会变成假书目。
 */
function describeConflict(pack: MaterialPack, conflict: MaterialConflict): string {
  const titles = new Map(pack.sources.map((s) => [s.id, s.title] as const));
  const parts = conflict.claims.map((claim) => {
    const title = claim.sourceId ? titles.get(claim.sourceId) : undefined;
    return `${title ? `《${title}》` : "模型"}称「${claim.statement}」`;
  });
  return `「${conflict.topic}」尚未选定口径：${parts.join("，")}。两种说法都保留，不替你决定。`;
}

/** 浏览器直连供应商。失败时抛错，由调用方降级。 */
async function callProvider(
  provider: ProviderConfig,
  question: string,
  docs: { kcId: string; title: string; snippet: string }[],
  mastery: readonly MasteryState[],
  materialContext: string,
): Promise<string> {
  const byId = new Map(mastery.map((m) => [m.kcId, m]));

  const context =
    docs.length > 0
      ? docs
          .map((d) => {
            const m = byId.get(d.kcId);
            const state = m
              ? `学生当前：已测 ${m.evidenceN} 题，掌握度 ${Math.round(masteryMean(m) * 100)}%（±${Math.round(masterySd(m) * 100)}）`
              : "学生当前：未测评";
            return `[${d.kcId}] ${d.title}\n资料：${d.snippet}\n${state}`;
          })
          .join("\n\n")
      : "（没有检索到相关资料，请直接说明资料里没有）";

  /*
   * 摘录单独成段，且明确写出「引用只能使用这里出现的书目、章节与页码」：
   * 混进知识点资料里，模型会把知识点摘要也当成教材原文去编页码。
   */
  const trimmedMaterial = materialContext.trim();
  const materialBlock =
    trimmedMaterial === ""
      ? ""
      : `\n\n教材 / 讲义摘录（有摘录时以此为准；引用只能使用这里出现的书目、章节与页码）：\n${trimmedMaterial}`;

  const { text } = await callChat(provider, {
    system: SYSTEM_PROMPT,
    user: `学生的问题：${question}\n\n可用资料：\n${context}${materialBlock}`,
    maxTokens: 600,
    temperature: 0.3,
    timeoutMs: 45000,
  });
  return text;
}
