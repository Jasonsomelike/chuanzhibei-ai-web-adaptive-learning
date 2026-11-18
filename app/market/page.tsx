"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Search } from "lucide-react";
import { SUBJECTS } from "@/data/subjects";
import { useAuth } from "@/lib/useAuth";
import { authStore } from "@/lib/authStore";
import { MARKET_RETRY_LABEL, marketStatusOf } from "@/components/market-status";

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
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);

  const load = useCallback(async (value: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setAppliedQuery(value.trim());
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ scope: "market" });
      if (value.trim()) params.set("q", value.trim());
      const response = await fetch("/api/directions?" + params, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("公开课程暂时无法读取");
      const data = (await response.json()) as { directions?: MarketItem[] };
      if (!controller.signal.aborted) setItems(data.directions ?? []);
    } catch {
      if (!controller.signal.aborted) {
        setItems([]);
        setError(true);
      }
    } finally {
      if (request.current === controller) setLoading(false);
    }
  }, []);

  // 首次拉取推迟到宏任务：load 的同步前缀会 setState，直接在 effect 里调用触发级联渲染告警
  useEffect(() => {
    const timer = window.setTimeout(() => void load(""), 0);
    return () => {
      window.clearTimeout(timer);
      request.current?.abort();
    };
  }, [load]);

  const visible = subject
    ? items.filter((item) => item.subjectId === subject)
    : items;
  const subjectName = SUBJECTS.find((item) => item.id === subject)?.name ?? "";
  const status = marketStatusOf({
    loading,
    error,
    count: visible.length,
    query: appliedQuery || subjectName,
  });

  const copy = async (id: string) => {
    if (!user) {
      setMessage({ kind: "err", text: "登录后可将方向加入自己的课程。" });
      return;
    }
    const owner = user.id;
    setCopying(id);
    setMessage(null);
    try {
      const response = await fetch("/api/directions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ copyFrom: id }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (authStore.getSnapshot().user?.id !== owner) return;
      if (!response.ok || !data.ok)
        throw new Error(data.error ?? "加入失败，请重试。");
      setMessage({ kind: "ok", text: "已加入我的课程，可继续学习和管理。" });
    } catch (failure) {
      if (authStore.getSnapshot().user?.id === owner)
        setMessage({
          kind: "err",
          text:
            failure instanceof Error ? failure.message : "加入失败，请重试。",
        });
    } finally {
      setCopying(null);
    }
  };

  const reset = () => {
    setQuery("");
    setSubject("");
    void load("");
  };
  return (
    <main id="main" className="market-page">
      <nav className="course-page-tabs" aria-label="课程入口">
        <Link href="/directions">我的课程</Link>
        <Link href="/market" aria-current="page">
          课程探索
        </Link>
      </nav>
      <header className="market-heading">
        <div>
          <h1>课程探索</h1>
          <p>查找公开的学习方向，加入后按自己的节奏学习。</p>
        </div>
        <Link href="/directions">
          <ArrowLeft size={18} />
          返回我的课程
        </Link>
      </header>
      <form
        className="market-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
      >
        <label className="market-search">
          <Search size={20} />
          <input
            type="search"
            aria-label="搜索方向"
            placeholder="搜索课程或学习方向"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="筛选课程"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        >
          <option value="">全部课程</option>
          {SUBJECTS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button type="submit" className="market-search-submit">
          搜索
        </button>
        {query || subject ? (
          <button type="button" className="market-clear" onClick={reset}>
            清除筛选
          </button>
        ) : null}
      </form>
      {message ? (
        <div
          role={message.kind === "err" ? "alert" : "status"}
          className={"market-notice " + message.kind}
        >
          <p>{message.text}</p>
          {message.kind === "ok" ? (
            <Link href="/directions">
              查看我的课程
              <ArrowRight size={16} />
            </Link>
          ) : !user ? (
            <Link href="/login?next=%2Fmarket">登录</Link>
          ) : null}
        </div>
      ) : null}
      <section aria-label="公开学习方向" aria-busy={loading}>
        {status.kind === "loading" ? (
          <div
            className="market-loading"
            role="status"
            aria-label="正在读取公开方向"
          >
            <i />
            <i />
            <i />
          </div>
        ) : status.kind === "error" ? (
          <div className="market-empty market-load-error">
            <BookOpen size={86} aria-hidden="true" />
            <div>
              <h2>公开课程暂时无法读取</h2>
              <p role="alert">{status.message}</p>
              <button type="button" onClick={() => void load(appliedQuery)}>
                {MARKET_RETRY_LABEL}
              </button>
            </div>
          </div>
        ) : status.kind === "empty" ? (
          <div className="market-empty">
            <BookOpen size={100} aria-hidden="true" />
            <div>
              <h2>
                {appliedQuery || subject
                  ? "没有找到匹配的学习方向"
                  : "还没有公开的学习方向"}
              </h2>
              <p>
                {appliedQuery || subject
                  ? "可以换个关键词，或清除筛选查看全部方向。"
                  : "你可以先学习内置课程，或创建自己的学习方向。"}
              </p>
              <div className="market-empty-actions action-row">
                <Link href="/directions" className="is-primary">
                  查看课程目录
                </Link>
                <Link href="/directions?create=1">创建学习方向</Link>
                {appliedQuery || subject ? (
                  <button type="button" onClick={reset}>
                    清除筛选
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <>
            <p className="market-result-count">{status.hint}</p>
            <div className="market-results">
              {visible.map((item) => (
                <article key={item.id}>
                  <div>
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                    <small>
                      {item.conceptCount} 个知识点 · {item.edgeCount} 条先修关系
                      · 更新于 {item.updatedAt.slice(0, 10)}
                    </small>
                  </div>
                  <div className="market-result-actions action-row">
                    <Link
                      href={"/path?direction=" + encodeURIComponent(item.id)}
                    >
                      查看图谱
                      <ArrowRight size={16} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => void copy(item.id)}
                      disabled={copying !== null}
                    >
                      {copying === item.id ? "正在加入…" : "加入我的课程"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
      <section
        className="market-starter-courses"
        aria-labelledby="starter-title"
      >
        <h2 id="starter-title">可直接开始的课程</h2>
        <ul>
          {SUBJECTS.slice(0, 3).map((item) => (
            <li key={item.id}>
              <h3>{item.name}</h3>
              <p>{item.tagline}</p>
              <Link href={"/path?subject=" + item.id}>
                进入课程
                <ArrowRight size={17} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
