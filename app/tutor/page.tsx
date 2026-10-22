"use client";

import { useEffect, useRef, useState } from "react";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { loadLearner, type LearnerState } from "@/lib/learner";

/**
 * 导师对话。
 *
 * 两个刻意的设计：
 * 1. 界面上如实标注当前是「大模型模式」还是「检索模式」，
 *    不假装有 AI 在说话——这是「AI 安全与可控」里可解释性的一部分。
 * 2. 每条回答都列出引用的知识点，可点开看该点的掌握度。
 *    引用来自检索结果，不依赖模型自述。
 */

interface Message {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly citations: { kcId: string; title: string }[];
  readonly generatedByLlm: boolean;
  readonly fallbackReason?: string;
}

interface TutorStatus {
  provider: string;
  model: string | null;
  documents: number;
}

const SUGGESTIONS = [
  "为什么给我排这一步？",
  "栈和队列的区别是什么",
  "快速排序最坏情况为什么会退化成 O(n²)",
  "哈希冲突怎么处理",
];

export default function TutorPage() {
  const [learner, setLearner] = useState<LearnerState | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLearner(loadLearner());

    // 读一次 AI 层状态，让界面如实显示当前模式
    fetch("/api/tutor")
      .then((r) => r.json())
      .then((d: TutorStatus) => setStatus(d))
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async (text: string) => {
    const question = text.trim();
    if (question.length === 0 || busy) return;

    setError(null);
    setBusy(true);
    setInput("");
    setMessages((prev) => [
      ...prev,
      { role: "user", text: question, citations: [], generatedByLlm: false },
    ]);

    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          mastery: learner?.mastery ?? [],
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `请求失败（${res.status}）`);
      }

      const data = (await res.json()) as {
        answer: string;
        citations: { kcId: string; title: string }[];
        generatedByLlm: boolean;
        fallbackReason?: string;
      };

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
          citations: data.citations,
          generatedByLlm: data.generatedByLlm,
          fallbackReason: data.fallbackReason,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">课程导师</h1>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            回答只依据课程知识库。没配大模型时，系统仍会用检索结果回答，并如实标注。
          </p>
        </div>

        {/* 当前模式：如实展示，不假装 */}
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--color-ink-soft)]">当前模式</span>
            {status ? (
              status.provider === "none" ? (
                <>
                  <Pill tone="warn">知识库检索</Pill>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    未配置大模型 API，回答由 {status.documents} 篇知识点文档检索拼装
                  </span>
                </>
              ) : (
                <>
                  <Pill tone="good">大模型 + 检索</Pill>
                  <span className="text-xs text-[var(--color-ink-faint)]">
                    {status.provider} / {status.model}
                  </span>
                </>
              )
            ) : (
              <Pill>读取中…</Pill>
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
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm text-[var(--color-ink-soft)] hover:bg-[var(--color-line)]"
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
                  ? "ml-8 border-[var(--color-accent-line)] bg-[var(--color-accent-soft)]"
                  : "mr-8"
              }
            >
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>

              {m.role === "assistant" ? (
                <div className="mt-3 space-y-2 border-t border-[var(--color-line)] pt-3">
                  {m.citations.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-[var(--color-ink-faint)]">引用</span>
                      {m.citations.map((c) => (
                        <Pill key={c.kcId} tone="accent">
                          {c.title} [{c.kcId}]
                        </Pill>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-[var(--color-ink-faint)]">
                    {m.generatedByLlm
                      ? "由大模型生成，依据为上方引用"
                      : `检索模式生成${m.fallbackReason ? `（${m.fallbackReason}）` : ""}`}
                  </p>
                </div>
              ) : null}
            </Card>
          ))}

          {busy ? (
            <Card className="mr-8">
              <div className="flex items-center gap-2 text-sm text-[var(--color-ink-soft)]">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
                正在检索课程知识库…
              </div>
            </Card>
          ) : null}

          {error ? (
            <Card className="border-[var(--color-bad)] bg-[var(--color-bad-soft)]">
              <p className="text-sm text-[var(--color-bad)]">{error}</p>
              <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
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
            className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={busy || input.trim().length === 0}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            发送
          </button>
        </form>
      </main>
    </>
  );
}
