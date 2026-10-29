"use client";

/**
 * 设置页的「联网搜索」区块。
 *
 * 只有两家能在浏览器里直连：Tavily（用户自带 key）与维基百科（零密钥）。
 * Brave / Exa / DuckDuckGo 与任意网页抓取都过不了 CORS，这里不做入口，
 * 避免用户填了 key 才发现永远失败。
 *
 * 配置改动即保存：搜索开关不影响出题与评分，单独落盘没有半途状态问题。
 */

import { useEffect, useRef, useState } from "react";
import { Card, Pill } from "@/components/ui";
import {
  DEFAULT_SEARCH_CONFIG,
  loadSearchConfig,
  resolveSearchProvider,
  saveSearchConfig,
  searchWeb,
  type SearchConfig,
  type SearchOutcome,
} from "@/lib/searchClient";
import type { WebProvider } from "@/lib/websearch";

/** 固定测试词：短、中文、两个供应商都能命中，不花用户的 Tavily 额度太多。 */
const TEST_QUERY = "栈 后进先出";

const PROVIDERS: ReadonlyArray<{ id: WebProvider; label: string; note: string }> = [
  {
    id: "wikipedia",
    label: "维基百科",
    note: "零密钥，直连 zh.wikipedia.org；结果按 CC BY-SA 4.0 署名",
  },
  {
    id: "tavily",
    label: "Tavily",
    note: "需要自己的 API Key；每次检索按 Tavily 的规则计费",
  },
];

type TestState =
  | { readonly status: "idle" }
  | { readonly status: "testing" }
  | { readonly status: "done"; readonly outcome: SearchOutcome };

export function SearchSettings() {
  const [config, setConfig] = useState<SearchConfig>(DEFAULT_SEARCH_CONFIG);
  const [ready, setReady] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    setConfig(loadSearchConfig());
    setReady(true);
    return () => controller.current?.abort();
  }, []);

  function update(patch: Partial<SearchConfig>) {
    const next: SearchConfig = { ...config, ...patch };
    setConfig(next);
    saveSearchConfig(next);
    setTest({ status: "idle" });
  }

  const fallback = resolveSearchProvider(config);
  const tavilyMissingKey = config.provider === "tavily" && config.tavilyApiKey.trim() === "";

  async function runTest() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setTest({ status: "testing" });
    const outcome = await searchWeb(TEST_QUERY, config, current.signal);
    if (current.signal.aborted) return;
    controller.current = null;
    setTest({ status: "done", outcome });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">搜索供应商</p>
        <Pill tone={fallback.provider === "tavily" ? "accent" : "neutral"}>
          {fallback.provider === "tavily" ? "Tavily" : "维基百科"}
        </Pill>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {PROVIDERS.map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => update({ provider: provider.id })}
            aria-pressed={config.provider === provider.id}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              config.provider === provider.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line-strong)] hover:bg-[var(--line)]"
            }`}
          >
            <span className="block font-medium">{provider.label}</span>
            <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">{provider.note}</span>
          </button>
        ))}
      </div>

      {tavilyMissingKey ? (
        <p className="mt-2 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] p-2 text-xs text-[var(--warn)]">
          {fallback.notice}。填入密钥后才会真正调用 Tavily。
        </p>
      ) : null}

      {config.provider === "tavily" ? (
        <div className="mt-4">
          <Field label="Tavily API Key" hint="只保存在本浏览器，检索时只发往 api.tavily.com">
            <div className="flex gap-2">
              <input
                value={config.tavilyApiKey}
                onChange={(e) => update({ tavilyApiKey: e.target.value })}
                type={showKey ? "text" : "password"}
                className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                placeholder="tvly-…"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="shrink-0 rounded-lg border border-[var(--line-strong)] px-3 py-2 text-sm text-[var(--ink-soft)]"
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </Field>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">导师页默认开启「联网补充」</p>
        <button
          type="button"
          onClick={() => update({ defaultOn: !config.defaultOn })}
          aria-pressed={config.defaultOn}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
            config.defaultOn
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
          }`}
        >
          {config.defaultOn ? "默认开" : "默认关"}
        </button>
        <span className="text-xs text-[var(--ink-faint)]">
          {config.defaultOn
            ? "默认开；每次提问仍可在输入区临时关掉。"
            : "默认关；每次提问仍可在输入区临时开启。"}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-4">
        <button
          type="button"
          onClick={runTest}
          disabled={!ready || test.status === "testing"}
          className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {test.status === "testing" ? "测试中…" : "测试搜索"}
        </button>
        <span className="text-xs text-[var(--ink-faint)]">
          用「{TEST_QUERY}」检索一次，会消耗一次 Tavily 额度（若选了 Tavily）。
        </span>
      </div>

      {test.status === "done" ? <SearchReport outcome={test.outcome} /> : null}

      <ul className="mt-3 space-y-1 text-xs text-[var(--ink-faint)]">
        <li>· 密钥只存本浏览器 localStorage（alp.search.v1），不上传本项目服务器，也不写入日志。</li>
        <li>· 检索由浏览器直接请求供应商，不经过本项目后端；查询词会发送给该供应商。</li>
        <li>· 结果在当前标签页缓存 30 分钟（sessionStorage），失败不缓存。</li>
        <li>· 搜索失败不会阻塞回答：导师照常作答，只显示一条非阻塞提示。</li>
        <li>· 支持浏览器直连的只有 Tavily 与维基百科；Brave / Exa / DuckDuckGo 与任意网页抓取因 CORS 不可用。</li>
      </ul>
    </Card>
  );
}

function SearchReport({ outcome }: { outcome: SearchOutcome }) {
  const providerLabel = outcome.provider === "tavily" ? "Tavily" : "维基百科";

  if (outcome.error !== null) {
    return (
      <div className="mt-3 rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-3 text-sm">
        <p className="font-medium text-[var(--bad)]">搜索失败（{providerLabel}）</p>
        <p className="mt-1 text-[var(--ink-soft)]">{outcome.error}</p>
        {outcome.notice !== null ? (
          <p className="mt-1 text-xs text-[var(--ink-faint)]">{outcome.notice}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--good)] bg-[var(--good-soft)] p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2 font-medium text-[var(--good)]">
        搜索成功
        <span className="text-xs font-normal text-[var(--ink-faint)]">
          {providerLabel} · {outcome.results.length} 条
          {outcome.fromCache ? " · 来自会话缓存" : ""}
        </span>
      </p>
      {outcome.notice !== null ? (
        <p className="mt-1 text-xs text-[var(--ink-faint)]">{outcome.notice}</p>
      ) : null}
      <ul className="mt-1 space-y-1 text-xs text-[var(--ink-soft)]">
        {outcome.results.slice(0, 3).map((result) => (
          <li key={result.url} className="truncate">
            · 《{result.title}》
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">{hint}</span> : null}
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
