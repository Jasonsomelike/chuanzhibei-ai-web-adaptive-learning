"use client";

/**
 * 设置页的「语音朗读」区块。
 *
 * 与供应商配置不同，TTS 配置是独立的一份（alp.tts.v1），改动即保存：
 * 它不参与出题或评分，单独保存不会产生「改了一半」的风险。
 *
 * 密钥边界写死在界面上：key 只进本浏览器 localStorage，朗读时回答正文
 * 由浏览器直接发往用户填的语音端点；本项目后端不转发、不记录。
 */

import { useEffect, useState } from "react";
import { Card, Pill } from "@/components/ui";
import {
  DEFAULT_TTS_CONFIG,
  RATE_MAX,
  RATE_MIN,
  SPEECH_MAX_CHARS,
  listBrowserVoices,
  loadTtsConfig,
  saveTtsConfig,
  speakBrowser,
  speakRemote,
  stopSpeaking,
  subscribeBrowserVoices,
  ttsConfigIssues,
  type TtsConfig,
  type TtsEngine,
} from "@/lib/tts";

const PREVIEW_TEXT = "这是语音试听。栈是后进先出结构，队是先进先出结构。";

const ENGINES: ReadonlyArray<{ id: TtsEngine; label: string; note: string }> = [
  {
    id: "browser",
    label: "浏览器内置语音",
    note: "免费、无需密钥，音色由操作系统决定",
  },
  {
    id: "openai-compatible",
    label: "OpenAI 兼容语音",
    note: "需要端点允许浏览器直连（CORS），按字符计费",
  },
];

type Notice = { readonly tone: "good" | "warn" | "bad"; readonly text: string };

export function TtsSettings() {
  const [config, setConfig] = useState<TtsConfig>(DEFAULT_TTS_CONFIG);
  const [ready, setReady] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // localStorage 只能在挂载后读，否则服务端渲染与首次客户端渲染不一致
  useEffect(() => {
    setConfig(loadTtsConfig());
    setReady(true);
  }, []);

  useEffect(() => {
    const refresh = () => setVoices(listBrowserVoices());
    refresh();
    // 系统音色列表可能异步就绪；不订阅的话下拉框会一直是空的
    return subscribeBrowserVoices(refresh);
  }, []);

  useEffect(() => () => stopSpeaking(), []);

  function update(patch: Partial<TtsConfig>) {
    const next: TtsConfig = { ...config, ...patch };
    setConfig(next);
    saveTtsConfig(next);
    setNotice(null);
  }

  const remote = config.engine === "openai-compatible";
  const issues = ttsConfigIssues(config);
  const canPreview = ready && (!remote || issues.length === 0);

  async function preview() {
    if (playing) {
      stopSpeaking();
      setPlaying(false);
      return;
    }
    setNotice(null);
    setPlaying(true);
    try {
      if (remote) {
        const result = await speakRemote(PREVIEW_TEXT, config);
        if (result.fallbackReason !== undefined) {
          setNotice({ tone: "warn", text: result.fallbackReason });
        } else if (!result.ok) {
          setNotice({ tone: "bad", text: "试听被中止（可能已切换页面或点击了停止）" });
        }
      } else {
        await speakBrowser(PREVIEW_TEXT, config);
      }
    } finally {
      setPlaying(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">朗读引擎</p>
        <Pill tone={remote ? "accent" : "neutral"}>
          {remote ? "在线语音" : "浏览器语音"}
        </Pill>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {ENGINES.map((engine) => (
          <button
            key={engine.id}
            type="button"
            onClick={() => update({ engine: engine.id })}
            aria-pressed={config.engine === engine.id}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              config.engine === engine.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line-strong)] hover:bg-[var(--line)]"
            }`}
          >
            <span className="block font-medium">{engine.label}</span>
            <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">{engine.note}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {remote ? null : (
          <Field label="系统音色" hint="列表由操作系统提供；为空时使用默认音色">
            <select
              value={config.browserVoice ?? ""}
              onChange={(e) =>
                update({ browserVoice: e.target.value === "" ? undefined : e.target.value })
              }
              className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <option value="">系统默认</option>
              {voices.map((voice) => (
                <option key={`${voice.voiceURI}-${voice.name}`} value={voice.name}>
                  {voice.name}（{voice.lang}）
                </option>
              ))}
            </select>
          </Field>
        )}

        {remote ? (
          <>
            <Field
              label="API 地址（Base URL）"
              hint="填到 /v1 为止，会自动拼接 /audio/speech"
            >
              <input
                value={config.baseUrl ?? ""}
                onChange={(e) => update({ baseUrl: e.target.value })}
                className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                placeholder="https://api.openai.com/v1"
                spellCheck={false}
              />
            </Field>

            <Field label="API Key" hint="只保存在本浏览器，朗读时随请求发往你填的语音服务">
              <div className="flex gap-2">
                <input
                  value={config.apiKey ?? ""}
                  onChange={(e) => update({ apiKey: e.target.value })}
                  type={showKey ? "text" : "password"}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                  placeholder="sk-…"
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

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="模型名" hint="例如 tts-1">
                <input
                  value={config.model ?? ""}
                  onChange={(e) => update({ model: e.target.value })}
                  className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                  placeholder="tts-1"
                  spellCheck={false}
                />
              </Field>
              <Field label="音色" hint="例如 alloy / nova">
                <input
                  value={config.voice ?? ""}
                  onChange={(e) => update({ voice: e.target.value })}
                  className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 font-mono text-sm"
                  placeholder="alloy"
                  spellCheck={false}
                />
              </Field>
            </div>
          </>
        ) : null}

        <Field label={`语速 ${config.rate.toFixed(2)}×`} hint={`${RATE_MIN}–${RATE_MAX}，默认 1.0`}>
          <input
            type="range"
            min={RATE_MIN}
            max={RATE_MAX}
            step={0.05}
            value={config.rate}
            onChange={(e) => update({ rate: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={preview}
          disabled={!canPreview}
          className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
        >
          {playing ? "停止" : "试听"}
        </button>
        {!canPreview ? (
          <span className="text-xs text-[var(--ink-faint)]">
            还缺：{issues.join("、")}
          </span>
        ) : (
          <span className="text-xs text-[var(--ink-faint)]">
            朗读时只念回答正文，引用标记与代码块会被跳过；单段最多 {SPEECH_MAX_CHARS} 字。
          </span>
        )}
      </div>

      {notice ? (
        <p
          className={`mt-2 rounded-lg border p-2 text-xs ${
            notice.tone === "warn"
              ? "border-[var(--warn)] bg-[var(--warn-soft)] text-[var(--warn)]"
              : notice.tone === "bad"
                ? "border-[var(--bad)] bg-[var(--bad-soft)] text-[var(--bad)]"
                : "border-[var(--good)] bg-[var(--good-soft)] text-[var(--good)]"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <ul className="mt-3 space-y-1 text-xs text-[var(--ink-faint)]">
        <li>· 配置与密钥只存本浏览器 localStorage，不上传本项目服务器，也不写入日志。</li>
        <li>
          · 在线语音由浏览器直接请求你填的端点；回答正文会随朗读请求发送到该服务。
          端点不允许浏览器直连时会自动回退浏览器语音，并在这里说明原因。
        </li>
        <li>· 语音密钥与聊天供应商密钥分开保存，不会互相复用。</li>
        <li>· 聊天页不会自动播放，每条回答需要手动点「朗读」。</li>
      </ul>
    </Card>
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
