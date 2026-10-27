"use client";

import { useEffect, useState } from "react";
import { Nav, Card, SectionTitle, Pill } from "@/components/ui";
import {
  PRESETS,
  loadProvider,
  saveProvider,
  clearProvider,
  maskKey,
  testConnection,
  checkBaseUrl,
  isLocalAddress,
  type ProviderConfig,
  type ProviderKind,
  type TestResult,
} from "@/lib/provider";
import { THEMES, MODES } from "@/lib/themes";
import { useTheme } from "@/lib/theme";

/**
 * 设置页：模型供应商 + 外观主题。
 *
 * 供应商配置的设计参考主流 agent 工具（Cursor / Continue / Open WebUI）：
 * 地址、密钥、模型名全部用户自填，两种协议分别支持。
 *
 * 关键的安全与成本说明必须写在界面上，不能只写在文档里：
 * - key 只存在本浏览器，不上传
 * - 请求由浏览器直连供应商，不经过本项目服务器
 * - HTTPS 页面不能请求 HTTP 地址（混合内容），这是浏览器硬限制
 */

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "done"; result: TestResult };

export default function SettingsPage() {
  const { theme, mode, setTheme, setMode } = useTheme();

  const [presetId, setPresetId] = useState<string>("deepseek");
  const [label, setLabel] = useState("DeepSeek");
  const [kind, setKind] = useState<ProviderKind>("openai-compatible");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [extraHeaders, setExtraHeaders] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [saved, setSaved] = useState(false);
  const [existing, setExisting] = useState<ProviderConfig | null>(null);

  // 首次挂载：回显已保存的配置
  useEffect(() => {
    const p = loadProvider();
    if (p) {
      setExisting(p);
      setLabel(p.label);
      setKind(p.kind);
      setBaseUrl(p.baseUrl);
      setApiKey(p.apiKey);
      setModel(p.model);
      setExtraHeaders(p.extraHeaders ?? "");
      // 匹配到预设就选中它，否则落到对应协议的自定义
      const matched = PRESETS.find(
        (x) => x.baseUrl === p.baseUrl && x.kind === p.kind,
      );
      setPresetId(matched?.id ?? (p.kind === "anthropic" ? "custom-anthropic" : "custom-openai"));
    } else {
      applyPreset("deepseek");
    }
    // 只在挂载时回显一次；applyPreset 是稳定的纯 setter，放进依赖会重复覆盖用户输入
  }, []);

  function applyPreset(id: string) {
    setPresetId(id);
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setLabel(p.label);
    setKind(p.kind);
    setBaseUrl(p.baseUrl);
    setModel(p.model);
    setTest({ status: "idle" });
  }

  const currentConfig = (): ProviderConfig => ({
    label: label.trim() || "自定义",
    kind,
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    apiKey: apiKey.trim(),
    model: model.trim(),
    extraHeaders: extraHeaders.trim() || undefined,
  });

  const canTest = baseUrl.trim() !== "" && apiKey.trim() !== "" && model.trim() !== "";
  const urlCheck = baseUrl.trim() === "" ? null : checkBaseUrl(baseUrl);
  const localAddr = isLocalAddress(baseUrl);

  async function runTest() {
    setTest({ status: "testing" });
    const result = await testConnection(currentConfig());
    setTest({ status: "done", result });
  }

  function save() {
    saveProvider(currentConfig());
    setExisting(currentConfig());
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  function remove() {
    clearProvider();
    setExisting(null);
    setApiKey("");
    setTest({ status: "idle" });
  }

  const preset = PRESETS.find((p) => p.id === presetId);

  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-3xl px-5 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            配置自己的模型供应商，以及界面外观。
          </p>
        </div>

        {/* ── 当前状态 ── */}
        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--ink-soft)]">当前状态</span>
            {existing ? (
              <>
                <Pill tone="good">已配置</Pill>
                <span className="text-xs text-[var(--ink-faint)]">
                  {existing.label} · {existing.model} ·{" "}
                  {existing.kind === "anthropic" ? "Anthropic 协议" : "OpenAI 兼容"} · key{" "}
                  {maskKey(existing.apiKey)}
                </span>
              </>
            ) : (
              <>
                <Pill tone="warn">未配置</Pill>
                <span className="text-xs text-[var(--ink-faint)]">
                  导师页将使用知识库检索模式，路径功能不受影响
                </span>
              </>
            )}
          </div>
        </Card>

        {/* ── 供应商 ── */}
        <section className="mb-8">
          <SectionTitle hint="选一个预设，或填任何兼容端点。">
            模型供应商
          </SectionTitle>

          <Card className="mb-4">
            <p className="mb-2 text-sm font-medium">预设</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.filter((p) => !p.id.startsWith("custom")).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  aria-pressed={presetId === p.id}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    presetId === p.id
                      ? "bg-[var(--accent)] text-[var(--on-accent)]"
                      : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <p className="mb-2 mt-4 text-sm font-medium">自定义端点</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.filter((p) => p.id.startsWith("custom")).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  aria-pressed={presetId === p.id}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    presetId === p.id
                      ? "bg-[var(--accent)] text-[var(--on-accent)]"
                      : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {preset ? (
              <p className="mt-3 text-xs text-[var(--ink-faint)]">{preset.note}</p>
            ) : null}
          </Card>

          <Card>
            <div className="space-y-4">
              <Field label="显示名" hint="只用于界面标识">
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                  placeholder="例如：我的 DeepSeek"
                />
              </Field>

              <Field
                label="API 地址（Base URL）"
                hint={
                  kind === "anthropic"
                    ? "填到 /v1 为止，会自动拼接 /messages"
                    : "填到 /v1 为止，会自动拼接 /chat/completions"
                }
              >
                <input
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setTest({ status: "idle" });
                  }}
                  className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                  placeholder={
                    kind === "anthropic"
                      ? "https://api.anthropic.com/v1"
                      : "https://api.deepseek.com/v1"
                  }
                  spellCheck={false}
                />
              </Field>

              {/* 地址问题就地提示，不等用户点测试 */}
              {urlCheck && urlCheck.kind !== "ok" ? (
                <div className="rounded-lg border border-[var(--warn)] bg-[var(--warn-soft)] p-3 text-sm">
                  <p className="font-medium text-[var(--warn)]">
                    {urlCheck.kind === "mixed-content"
                      ? "HTTPS 页面不能请求 HTTP 地址"
                      : "地址有问题"}
                  </p>
                  <p className="mt-1 text-[var(--ink-soft)]">{urlCheck.detail}</p>
                  {urlCheck.kind === "mixed-content" ? (
                    <ul className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
                      <li>· 这是浏览器的安全策略，无法在页面内绕过</li>
                      <li>· 给该服务配 HTTPS 域名（推荐，前面挂一层反向代理 + 证书）</li>
                      <li>· 或在本机跑本项目（http://localhost:3000）再连这个内网地址</li>
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {localAddr && urlCheck?.kind === "ok" ? (
                <p className="text-xs text-[var(--ink-faint)]">
                  检测到本地或内网地址。只有在同网络环境下的浏览器才能访问；
                  若本项目部署在公网，请改用可公网访问的地址。
                </p>
              ) : null}

              <Field label="API Key" hint="只保存在本浏览器，不上传到任何服务器">
                <div className="flex gap-2">
                  <input
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    type={showKey ? "text" : "password"}
                    className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                    placeholder={kind === "anthropic" ? "sk-ant-…" : "sk-…"}
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

              <Field label="模型名" hint="必须是供应商实际支持的模型 id">
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                  placeholder={kind === "anthropic" ? "claude-sonnet-4-5-20250929" : "deepseek-chat"}
                  spellCheck={false}
                />
              </Field>

              <details className="text-sm">
                <summary className="cursor-pointer text-[var(--ink-soft)]">
                  高级：协议类型与额外请求头
                </summary>
                <div className="mt-3 space-y-3 pl-1">
                  <Field
                    label="协议"
                    hint={
                      kind === "anthropic"
                        ? "Anthropic Messages：POST /messages，密钥走 x-api-key"
                        : "OpenAI 兼容：POST /chat/completions，密钥走 Authorization"
                    }
                  >
                    <select
                      value={kind}
                      onChange={(e) => {
                        setKind(e.target.value as ProviderKind);
                        setTest({ status: "idle" });
                      }}
                      className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                    >
                      <option value="openai-compatible">OpenAI 兼容</option>
                      <option value="anthropic">Anthropic Messages</option>
                    </select>
                  </Field>
                  <Field label="额外请求头" hint='JSON 格式，例如 {"X-Org":"xxx"}'>
                    <input
                      value={extraHeaders}
                      onChange={(e) => setExtraHeaders(e.target.value)}
                      className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                      placeholder='{"X-Custom":"value"}'
                      spellCheck={false}
                    />
                  </Field>
                </div>
              </details>

              {/* ── 连通性测试 ── */}
              <div className="border-t border-[var(--line)] pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={!canTest || test.status === "testing"}
                    className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {test.status === "testing" ? "测试中…" : "测试连通性"}
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!canTest}
                    className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saved ? "已保存" : "保存配置"}
                  </button>
                  {existing ? (
                    <button
                      type="button"
                      onClick={remove}
                      className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm text-[var(--bad)]"
                    >
                      清除
                    </button>
                  ) : null}
                </div>
                {!canTest ? (
                  <p className="mt-2 text-xs text-[var(--ink-faint)]">
                    填齐地址、密钥、模型名后才能测试
                  </p>
                ) : null}

                {test.status === "done" ? (
                  <TestReport result={test.result} />
                ) : null}
              </div>
            </div>
          </Card>
        </section>

        {/* ── 外观 ── */}
        <section className="mb-8">
          <SectionTitle hint="5 套配色全部通过 WCAG AAA 正文对比度（≥7:1），可随时切换。">
            外观主题
          </SectionTitle>
          <Card>
            <p className="mb-2 text-sm font-medium">明暗模式</p>
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={`rounded-lg px-3 py-1.5 text-sm ${
                    mode === m.id
                      ? "bg-[var(--accent)] text-[var(--on-accent)]"
                      : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <p className="mb-2 mt-5 text-sm font-medium">配色主题</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  aria-pressed={theme === t.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left ${
                    theme === t.id
                      ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                      : "border border-[var(--line-strong)] hover:bg-[var(--line)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t.name}</span>
                    <span className="block text-xs text-[var(--ink-faint)]">{t.note}</span>
                  </span>
                  {theme === t.id ? <Pill tone="accent">当前</Pill> : null}
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--ink-faint)]">
              主题与明暗是两个独立维度，5 × 2 = 10 个组合。选择会保存在本浏览器。
            </p>
          </Card>
        </section>

        {/* ── 安全说明 ── */}
        <section>
          <SectionTitle>密钥与隐私</SectionTitle>
          <Card>
            <ul className="space-y-2 text-sm text-[var(--ink-soft)]">
              <li>
                <strong className="text-[var(--ink)]">密钥只存在本浏览器。</strong>
                保存在 localStorage，不上传到本项目服务器，也不写入任何日志。
              </li>
              <li>
                <strong className="text-[var(--ink)]">请求由浏览器直连供应商。</strong>
                调用链是「浏览器 → 你填的地址」，本项目后端不参与转发，
                因此部署在公网也无需保管任何密钥。
              </li>
              <li>
                <strong className="text-[var(--ink)]">费用由填 key 的人承担。</strong>
                调用直接计入你的账户额度。
              </li>
              <li>
                <strong className="text-[var(--ink)]">HTTPS 站点不能请求 HTTP 地址。</strong>
                这是浏览器的混合内容策略，无法在页面内绕过。内网服务需要配 HTTPS 或在本地运行本项目。
              </li>
              <li>
                <strong className="text-[var(--ink)]">公共电脑上用完请点「清除」。</strong>
                localStorage 在同一浏览器内共享。
              </li>
              <li>
                <strong className="text-[var(--ink)]">路径功能不依赖任何密钥。</strong>
                即使不配置，诊断与路径仍完整可用——这是本项目的核心设计。
              </li>
            </ul>
          </Card>
        </section>
      </main>
    </>
  );
}

/** 测试结果报告：区分失败原因，给对应的修复步骤。 */
function TestReport({ result }: { result: TestResult }) {
  const tone = result.ok
    ? "border-[var(--good)] bg-[var(--good-soft)]"
    : "border-[var(--bad)] bg-[var(--bad-soft)]";

  const title = result.ok ? "✓ 连接成功" : "✗ 连接失败";

  return (
    <div className={`mt-3 rounded-lg border p-3 text-sm ${tone}`} role="status">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <span className={result.ok ? "text-[var(--good)]" : "text-[var(--bad)]"}>{title}</span>
        {result.latencyMs > 0 ? (
          <span className="tabular text-xs text-[var(--ink-faint)]">{result.latencyMs} ms</span>
        ) : null}
        {!result.ok && result.failure ? (
          <span className="rounded bg-[var(--surface)] px-1.5 py-0.5 text-xs text-[var(--ink-soft)]">
            {FAILURE_LABEL[result.failure]}
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-[var(--ink-soft)]">{result.detail}</p>
      {result.hints && result.hints.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-[var(--ink-soft)]">
          {result.hints.map((h) => (
            <li key={h}>· {h}</li>
          ))}
        </ul>
      ) : null}
      {result.ok ? (
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          支持对话与流式输出。导师页会使用此配置。
        </p>
      ) : null}
    </div>
  );
}

const FAILURE_LABEL: Record<string, string> = {
  precheck: "配置问题",
  "mixed-content": "混合内容拦截",
  cors: "跨域拦截",
  auth: "鉴权失败",
  "not-found": "地址或模型名错",
  "rate-limit": "限流或余额",
  server: "供应商故障",
  timeout: "超时",
  network: "网络错误",
  response: "响应异常",
};

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
