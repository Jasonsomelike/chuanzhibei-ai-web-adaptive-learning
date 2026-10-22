"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useSubject, SubjectPicker } from "@/lib/subject";
import { loadLearner, progressOf, type LearnerState } from "@/lib/learner";
import { loadProvider, maskKey, type ProviderConfig } from "@/lib/provider";
import { search, buildIndex, type Bm25Index } from "@/lib/rag";
import { masteryMean, masterySd } from "@/lib/mastery";
import type { MasteryState } from "@/lib/mastery";

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
}

const SYSTEM_PROMPT = `你是一门大学课程的助教。回答必须遵守：

1. 只依据提供的「知识点资料」作答。资料里没有的，直接说「资料里没有这一条」，不要凭记忆补充。
2. 每个结论后用 [知识点ID] 标注依据，例如「栈是后进先出 [c09]」。
3. 学生问「为什么给我排这一步」时，用他的掌握度数值解释，不要编造他没做过的题。
4. 不要许诺系统没有的功能。
5. 中文回答，200 字以内，不要用「首先/其次/最后」这种套话。`;

export default function TutorPage() {
  const { subject, subjectId, setSubject, ready } = useSubject();
  const [learner, setLearner] = useState<LearnerState | null>(null);
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // 按学科建检索索引（学科切换时重建）
  const [index, setIndex] = useState<Bm25Index | null>(null);

  useEffect(() => {
    setLearner(loadLearner());
    setProvider(loadProvider());
  }, []);

  useEffect(() => {
    // 每个知识点一篇文档：名称 + 章节 + 要掌握什么 + 题目解析
    const docs = subject.graph.concepts.map((c) => {
      const qs = subject.questions.filter((q) => q.kcId === c.id);
      const qa = qs
        .map((q, i) => `第${i + 1}题（难度${q.difficulty}）：${q.stem} 解析：${q.explanation}`)
        .join(" ");
      return {
        kcId: c.id,
        title: c.name,
        text: `${c.chapter}。${c.summary}。常见考点与解析：${qa}`,
      };
    });
    setIndex(buildIndex(docs));
    setMessages([]);
  }, [subject]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const masteryOf = (): readonly MasteryState[] => {
    if (!learner) return [];
    return progressOf(learner, subjectId).mastery;
  };

  const send = async (text: string) => {
    const question = text.trim();
    if (question.length === 0 || busy || !index) return;

    setError(null);
    setBusy(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: question, citations: [], generatedByLlm: false },
    ]);

    const mastery = masteryOf();
    const docs = search(index, question, 3);

    // 未配置供应商：直接走结构化拼装
    if (!provider) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: composeDeterministic(question, docs, mastery),
          citations: docs.map((d) => ({ kcId: d.kcId, title: d.title })),
          generatedByLlm: false,
          note: "未配置模型供应商，本次由知识库检索拼装",
        },
      ]);
      setBusy(false);
      return;
    }

    // 配置了供应商：浏览器直连
    try {
      const reply = await callProvider(provider, question, docs, mastery);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: reply,
          citations: docs.map((d) => ({ kcId: d.kcId, title: d.title })),
          generatedByLlm: true,
          note: `${provider.label} · ${provider.model}`,
        },
      ]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: composeDeterministic(question, docs, mastery),
          citations: docs.map((d) => ({ kcId: d.kcId, title: d.title })),
          generatedByLlm: false,
          note: `模型调用失败（${reason}），已退回检索拼装`,
        },
      ]);
      setError(`模型调用失败：${reason}。可以到设置页测试连通性。`);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 py-10">
          <p className="text-[var(--ink-soft)]">正在加载…</p>
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

        {/* 学科切换 */}
        <Card className="mb-4">
          <p className="mb-2 text-sm font-medium">当前学科</p>
          <SubjectPicker current={subjectId} onChange={setSubject} />
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
                  `${subject.graph.concepts[0]?.name ?? ""}是什么`,
                  `${subject.graph.concepts[1]?.name ?? ""}的重点是什么`,
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

/** 无模型时的回答：检索结果 + 掌握度数值 + 题库解析。 */
function composeDeterministic(
  question: string,
  docs: { kcId: string; title: string; snippet: string }[],
  mastery: readonly MasteryState[],
): string {
  const byId = new Map(mastery.map((m) => [m.kcId, m]));

  if (docs.length === 0) {
    return (
      `课程资料里没有检索到与「${question}」直接相关的内容。\n\n` +
      `当前学科的知识点都已在知识图谱里，可以换个说法，或者告诉我你在看哪一章。`
    );
  }

  const lines = docs.map((d) => {
    const m = byId.get(d.kcId);
    const state = m
      ? `你目前在这个知识点上已测 ${m.evidenceN} 题，掌握度 ${Math.round(masteryMean(m) * 100)}%（±${Math.round(masterySd(m) * 100)}）。`
      : "你还没有测过这个知识点。";
    return `**${d.title}** [${d.kcId}]\n${d.snippet}\n${state}`;
  });

  return (
    lines.join("\n\n") +
    `\n\n（当前未配置模型供应商，以上内容由课程知识库直接检索拼装。` +
    `到设置页配置后可得自然语言讲解，检索依据不变。）`
  );
}

/** 浏览器直连供应商。失败时抛错，由调用方降级。 */
async function callProvider(
  provider: ProviderConfig,
  question: string,
  docs: { kcId: string; title: string; snippet: string }[],
  mastery: readonly MasteryState[],
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

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.kind === "anthropic") {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  if (provider.extraHeaders) {
    try {
      Object.assign(headers, JSON.parse(provider.extraHeaders) as Record<string, string>);
    } catch {
      /* 忽略非法 JSON */
    }
  }

  const isAnthropic = provider.kind === "anthropic";
  const endpoint = isAnthropic
    ? `${provider.baseUrl}/messages`
    : `${provider.baseUrl}/chat/completions`;

  const userPrompt = `学生的问题：${question}\n\n可用资料：\n${context}`;

  const body = isAnthropic
    ? {
        model: provider.model,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }
    : {
        model: provider.model,
        temperature: 0.3,
        max_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${t ? ` · ${t.slice(0, 120)}` : ""}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      content?: { text?: string }[];
    };
    const text = json.choices?.[0]?.message?.content ?? json.content?.[0]?.text ?? "";
    if (!text.trim()) throw new Error("模型返回空内容");
    return text.trim();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("请求超时（45 秒）");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
