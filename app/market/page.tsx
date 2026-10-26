"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import { useAuth } from "@/lib/useAuth";

/**
 * 方向市场。
 *
 * 展示用户公开的自定义方向，其他人可以浏览、搜索、复制到自己名下。
 *
 * 设计取舍：
 * - 未登录也能浏览（降低门槛），但复制需要登录（要有归属）
 * - 只展示摘要，不返回完整图谱，避免响应体过大
 * - 没有「点赞」之类的社交功能——本期只需要「发现 + 选用」两件事
 */

interface MarketItem {
  id: string;
  title: string;
  description: string;
  subjectId: string;
  conceptCount: number;
  edgeCount: number;
  updatedAt: string;
}

export default function MarketPage() {
  const { user } = useAuth();

  const [items, setItems] = useState<MarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copying, setCopying] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ scope: "market" });
      if (query.trim() !== "") params.set("q", query.trim());
      const res = await fetch(`/api/directions?${params.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { directions: MarketItem[] };
        setItems(data.directions ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  const copy = async (id: string) => {
    if (!user) {
      setMessage({ kind: "err", text: "请先登录再选用方向" });
      return;
    }
    setCopying(id);
    setMessage(null);
    try {
      const res = await fetch("/api/directions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copyFrom: id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (res.ok && data.ok) {
        setMessage({ kind: "ok", text: "已复制到「我的方向」，可在那里设为公开或用于规划" });
      } else {
        setMessage({ kind: "err", text: data.error ?? "复制失败" });
      }
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setCopying(null);
    }
  };

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">方向市场</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            其他人公开的学习方向。选用后会复制一份到你名下，可以自己改。
          </p>
        </div>

        {/* 搜索 */}
        <Card className="mb-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(q);
            }}
            className="flex gap-2"
          >
            <label htmlFor="q" className="sr-only">
              搜索方向
            </label>
            <input
              id="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题或描述，例如「树结构」「进程」"
              className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]"
            >
              搜索
            </button>
            {q !== "" ? (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  void load("");
                }}
                className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-2 text-sm"
              >
                清除
              </button>
            ) : null}
          </form>
        </Card>

        {message ? (
          <Card
            className={`mb-5 ${
              message.kind === "ok"
                ? "border-[var(--good)] bg-[var(--good-soft)]"
                : "border-[var(--bad)] bg-[var(--bad-soft)]"
            }`}
          >
            <p
              className={`text-sm ${
                message.kind === "ok" ? "text-[var(--good)]" : "text-[var(--bad)]"
              }`}
            >
              {message.text}
            </p>
            {message.kind === "ok" ? (
              <Link href="/directions" className="mt-2 inline-block text-sm underline">
                去看我的方向
              </Link>
            ) : null}
          </Card>
        ) : null}

        {/* 列表 */}
        <section>
          <SectionTitle hint={loading ? "加载中…" : `共 ${items.length} 个公开方向`}>
            公开方向
          </SectionTitle>

          {!loading && items.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--ink-soft)]">
                {q.trim() !== ""
                  ? `没有匹配「${q}」的方向。`
                  : "还没有人公开方向。你可以先创建并公开一个。"}
              </p>
              <Link
                href="/directions"
                className="mt-3 inline-flex rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm"
              >
                创建方向
              </Link>
            </Card>
          ) : (
            <div className="space-y-2">
              {items.map((d) => (
                <Card key={d.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.title}</span>
                        <span className="tabular text-xs text-[var(--ink-faint)]">
                          {d.conceptCount} 点 / {d.edgeCount} 边
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">{d.description}</p>
                      <p className="mt-1 text-xs text-[var(--ink-faint)]">
                        更新于 {d.updatedAt.slice(0, 10)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copy(d.id)}
                      disabled={copying === d.id}
                      className="shrink-0 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent)] disabled:opacity-40"
                    >
                      {copying === d.id ? "复制中…" : "选用"}
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          {user ? (
            <Link href="/directions" className="underline">
              管理我的方向
            </Link>
          ) : (
            <>
              <Pill tone="warn">未登录</Pill>
              <Link href="/login" className="underline">
                登录后可选方向
              </Link>
            </>
          )}
        </div>
      </main>
    </>
  );
}
