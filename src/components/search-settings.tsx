"use client";

/**
 * 设置页的「联网搜索」区块。
 *
 * 三家供应商的边界不同：
 * - 维基百科：零密钥，浏览器直连，两种调用模式都一样；
 * - Tavily：本机模式浏览器直连（BYOK）；服务端模式走 /api/search，密钥在账号里；
 * - DeepSeek 搜索：没有浏览器直连路径，恒走 /api/search，必须登录且保存密钥。
 *
 * 回退必须显式：未登录选 DeepSeek / Tavily 代理时会换成维基百科，
 * 并在 notice 里写清原因，不静默降级。
 */

import { useEffect, useRef, useState } from "react";

import { Card, Pill } from "@/components/ui";
import { SecretConfigForm, type SecretField } from "@/components/secret-config-form";
import {
  DEFAULT_SEARCH_CONFIG,
  clearSearchConfig,
  loadSearchConfig,
  resolveSearchProvider,
  saveSearchConfig,
  searchWeb,
  type SearchConfig,
  type SearchOutcome,
} from "@/lib/searchClient";
import type { CallMode } from "@/lib/serverConfig";
import { webProviderLabel, type WebProvider } from "@/lib/websearch";

/** 固定测试词：短、中文、各供应商都能命中，不花用户的额度太多。 */
const TEST_QUERY = "栈 后进先出";

const PROVIDERS: ReadonlyArray<{ id: WebProvider; label: string; note: string }> = [
  {
    id: "wikipedia",
    label: "维基百科",
    note: "零密钥，直连 zh.wikipedia.org；结果按 CC BY-SA 4.0 署名",
  },
  {
    id: "deepseek",
    label: "DeepSeek 搜索",
    note: "恒走本项目代理；需要登录并在账号里保存搜索密钥，按 DeepSeek 规则计费",
  },
  {
    id: "tavily",
    label: "Tavily",
    note: "本机模式浏览器直连（自带 Key）；服务端模式登录后由代理转发",
  },
];

const DEEPSEEK_FIELDS: readonly SecretField[] = [
  {
    name: "apiKey",
    label: "DeepSeek 搜索密钥",
    type: "password",
    required: true,
    hint: "加密存在账号里，浏览器只看到掩码；与聊天模型密钥可以不是同一个账号",
    placeholder: "sk-…",
  },
  {
    name: "baseUrl",
    label: "中转地址（可选）",
    type: "url",
    hint: "只作记录；搜索请求固定发往官方 api.deepseek.com，密钥不会被带到中转域",
    placeholder: "https://api.deepseek.com/v1",
  },
];

const TAVILY_FIELDS: readonly SecretField[] = [
  {
    name: "apiKey",
    label: "Tavily API Key",
    type: "password",
    required: true,
    hint: "加密存在账号里；检索时由本项目服务端发给 api.tavily.com",
    placeholder: "tvly-…",
  },
];

type TestState =
  | { readonly status: "idle" }
  | { readonly status: "testing" }
  | { readonly status: "done"; readonly outcome: SearchOutcome };

export function SearchSettings({
  mode,
  loggedIn,
}: {
  readonly mode: CallMode;
  readonly loggedIn: boolean;
}) {
  const [config, setConfig] = useState<SearchConfig>(DEFAULT_SEARCH_CONFIG);
  const [ready, setReady] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [cleared, setCleared] = useState(false);
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
    setCleared(false);
  }

  const resolved = resolveSearchProvider(config, { mode, loggedIn });
  const serverTavily = config.provider === "tavily" && mode === "server";
  const deepseek = config.provider === "deepseek";
  const localTavily = config.provider === "tavily" && mode === "local";

  async function runTest() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setTest({ status: "testing" });
    const outcome = await searchWeb(TEST_QUERY, config, current.signal, { mode, loggedIn });
    if (current.signal.aborted) return;
    controller.current = null;
    setTest({ status: "done", outcome });
  }

  function clearAll() {
    clearSearchConfig();
    setConfig({ ...DEFAULT_SEARCH_CONFIG });
    setTest({ status: "idle" });
    setCleared(true);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">搜索供应商</p>
          <Pill tone={resolved.provider === "wikipedia" ? "neutral" : "accent"}>
            {webProviderLabel(resolved.provider)}
          </Pill>
          <span className="text-xs text-[var(--ink-faint)]">
            {mode === "server" ? "服务端模式" : "本机模式"}
          </span>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
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

        {resolved.notice !== null ? (
          <p className="mt-2 rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] p-2 text-xs text-[var(--warn)]">
            {resolved.notice}
          </p>
        ) : null}

        {localTavily ? (
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

        {serverTavily && !loggedIn ? (
          <p className="mt-3 rounded-lg border border-[var(--line-strong)] p-2 text-xs text-[var(--ink-soft)]">
            服务端模式下的 Tavily 需要登录后保存密钥。登录后可在这里填写；未登录时检索会明确改用维基百科。
          </p>
        ) : null}

        {deepseek && !loggedIn ? (
          <p className="mt-3 rounded-lg border border-[var(--line-strong)] p-2 text-xs text-[var(--ink-soft)]">
            DeepSeek 搜索没有浏览器直连路径：需要登录并在账号里保存搜索密钥。未登录时检索会明确改用维基百科。
          </p>
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
          <button
            type="button"
            onClick={clearAll}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm text-[var(--bad)]"
          >
            清除搜索配置
          </button>
          <span className="text-xs text-[var(--ink-faint)]">
            用「{TEST_QUERY}」检索一次，会消耗一次额度（若选了需要计费的供应商）。
          </span>
        </div>

        {cleared ? (
          <p className="mt-2 rounded-lg border border-[var(--good)] bg-[var(--good-soft)] p-2 text-xs text-[var(--good)]">
            已清除：本机的搜索配置（alp.search.v1）与当前标签页里缓存的检索结果（alp.websearch.v1:*）。
          </p>
        ) : null}

        {test.status === "done" ? <SearchReport outcome={test.outcome} /> : null}

        <ul className="mt-3 space-y-1 text-xs text-[var(--ink-faint)]">
          <li>· 本机模式的 Tavily 密钥只存本浏览器 localStorage（alp.search.v1），不上传本项目服务器。</li>
          <li>· 服务端模式的密钥加密存在账号里，浏览器只看到掩码；检索由本项目转发。</li>
          <li>· 维基百科免密钥，两种模式下都由浏览器直连；查询词会发送给该站点。</li>
          <li>· 结果在当前标签页缓存 30 分钟（sessionStorage），失败不缓存；「清除搜索配置」会一并清掉。</li>
          <li>· 搜索失败不会阻塞回答：导师照常作答，只显示一条非阻塞提示。</li>
        </ul>
      </Card>

      {deepseek && loggedIn ? (
        <SecretConfigForm
          kind="search-deepseek"
          title="DeepSeek 搜索（账号）"
          description="DeepSeek 搜索没有浏览器直连路径，必须由本项目代发；密钥只在服务端解密。"
          fields={DEEPSEEK_FIELDS}
          statusHint="保存后，选中 DeepSeek 的检索会走 /api/search；未保存时会明确报「未配置」。"
        />
      ) : null}

      {serverTavily && loggedIn ? (
        <SecretConfigForm
          kind="search-tavily"
          title="Tavily 搜索（账号）"
          description="服务端模式下检索走本项目代理，浏览器不接触 Tavily 密钥。"
          fields={TAVILY_FIELDS}
          statusHint="如果想用浏览器直连自己的 Tavily 密钥，请把上面的调用模式切到「本机」。"
        />
      ) : null}
    </div>
  );
}

function SearchReport({ outcome }: { outcome: SearchOutcome }) {
  const providerLabel = webProviderLabel(outcome.provider);

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
