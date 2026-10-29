"use client";

/**
 * 设置页的「语音朗读」区块。
 *
 * 与供应商配置不同，TTS 的本机配置是独立的一份（alp.tts.v1），改动即保存。
 * 服务端模式下真正的端点 / 密钥 / 模型在账号的 tts 行里，这里只选择引擎与协议，
 * 并给出保存入口；不要把本机空密钥当成「配置不完整」而回退。
 *
 * 两套在线协议：
 * - OpenAI 兼容：POST {baseUrl}/audio/speech；
 * - 小米 mimo：POST {baseUrl}/chat/completions + modalities:["audio"]（/audio/speech 会 404）。
 */

import { useEffect, useState } from "react";

import {
  DangerButton,
  FormGrid,
  FormRow,
  Pill,
  SettingsGroup,
  inputClass,
  monoInputClass,
} from "@/components/ui";
import { SecretConfigForm, type SecretField } from "@/components/secret-config-form";
import type { CallMode } from "@/lib/serverConfig";
import {
  DEFAULT_TTS_CONFIG,
  MIMO_PRESET,
  RATE_MAX,
  RATE_MIN,
  SPEECH_MAX_CHARS,
  clearTtsConfig,
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
    label: "在线语音",
    note: "本机模式浏览器直连；服务端模式由本项目代发，密钥在账号里",
  },
];

/** 服务端 tts 行的字段；只是契约字段的子集，不暴露任何密钥明文。 */
const TTS_FIELDS: readonly SecretField[] = [
  {
    name: "engine",
    label: "引擎",
    width: "half",
    type: "select",
    options: [
      { value: "openai-compatible", label: "在线语音（服务端代发）" },
      { value: "browser", label: "浏览器语音（不需要服务端）" },
    ],
  },
  {
    name: "protocol",
    label: "协议",
    width: "half",
    type: "select",
    options: [
      { value: "speech", label: "OpenAI 兼容：/audio/speech" },
      { value: "chat-audio", label: "小米 mimo：/chat/completions 音频" },
    ],
  },
  {
    name: "rate",
    label: "语速",
    type: "number",
    hint: `${RATE_MIN}–${RATE_MAX}，默认 1.0`,
  },
  {
    name: "baseUrl",
    label: "API 地址",
    type: "url",
    hint: "服务端会做 SSRF 校验：只接受公网 https，内网 / 环回地址会被拒绝",
    placeholder: "https://api.openai.com/v1",
  },
  {
    name: "apiKey",
    label: "API Key（加密保存）",
    type: "password",
    hint: "在线合成必须有；选浏览器语音时可留空",
    placeholder: "sk-…",
  },
  {
    name: "model",
    label: "模型名",
    width: "half",
    hint: "mimo 例如 mimo-v1；OpenAI 兼容例如 tts-1",
    placeholder: "tts-1",
  },
  {
    name: "voice",
    label: "音色",
    width: "half",
    hint: "mimo 用茉莉；OpenAI 兼容例如 alloy / nova",
    placeholder: "alloy",
  },
];

type Notice = { readonly tone: "good" | "warn" | "bad"; readonly text: string };

export function TtsSettings({
  mode,
  loggedIn,
}: {
  readonly mode: CallMode;
  readonly loggedIn: boolean;
}) {
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

  /** mimo 预设只锁协议与音色：地址与模型因账号而异，留空提示必填。 */
  function applyMimoPreset() {
    update({
      protocol: MIMO_PRESET.protocol,
      voice: MIMO_PRESET.voice,
      format: MIMO_PRESET.format,
      baseUrl: undefined,
      model: undefined,
    });
  }

  function applySpeechPreset() {
    update({ protocol: "speech", format: "mp3" });
  }

  const remote = config.engine === "openai-compatible";
  const serverMode = mode === "server";
  const localRemote = remote && !serverMode;
  const issues = ttsConfigIssues(config, mode);
  const canPreview = ready && (!remote || (serverMode ? loggedIn : issues.length === 0));
  const mimo = (config.protocol ?? "speech") === "chat-audio";

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
        // 服务端模式不要求本机 apiKey/model：它们来自账号里的 tts 行。
        const result = await speakRemote(PREVIEW_TEXT, config, { mode });
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

  function clearAll() {
    clearTtsConfig();
    setConfig({ ...DEFAULT_TTS_CONFIG });
    setPlaying(false);
    setNotice({
      tone: "good",
      text: "已清除本机语音配置（alp.tts.v1），并停止正在播放的声音。账号里的语音配置需在上方表单删除。",
    });
  }

  return (
    <div className="space-y-6">
      <SettingsGroup
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            朗读引擎
            <Pill tone={remote ? "accent" : "neutral"}>
              {remote
                ? serverMode
                  ? "在线语音 · 服务端代发"
                  : "在线语音 · 浏览器直连"
                : "浏览器语音"}
            </Pill>
          </span>
        }
        hint="浏览器语音免费；在线语音在本机模式直连、服务端模式由本项目代发。"
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {ENGINES.map((engine) => (
            <button
              key={engine.id}
              type="button"
              onClick={() => update({ engine: engine.id })}
              aria-pressed={config.engine === engine.id}
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                config.engine === engine.id
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line-strong)] hover:bg-[var(--line)]"
              }`}
            >
              <span className="block font-medium">{engine.label}</span>
              <span className="mt-1 block max-w-[42ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                {engine.note}
              </span>
            </button>
          ))}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="语音参数"
        hint="改动即时保存到本浏览器（alp.tts.v1），不需要再点保存。"
      >
        <div className="max-w-2xl space-y-4">
          {remote ? null : (
            <FormRow label="系统音色" hint="列表由操作系统提供；为空时使用默认音色">
              <select
                value={config.browserVoice ?? ""}
                onChange={(e) =>
                  update({ browserVoice: e.target.value === "" ? undefined : e.target.value })
                }
                className={inputClass}
              >
                <option value="">系统默认</option>
                {voices.map((voice) => (
                  <option key={`${voice.voiceURI}-${voice.name}`} value={voice.name}>
                    {voice.name}（{voice.lang}）
                  </option>
                ))}
              </select>
            </FormRow>
          )}

          {localRemote ? (
            <>
              <div>
                <p className="text-sm font-medium">在线协议</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={applySpeechPreset}
                    aria-pressed={!mimo}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      !mimo
                        ? "bg-[var(--accent)] text-[var(--on-accent)]"
                        : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                    }`}
                  >
                    OpenAI 兼容（/audio/speech）
                  </button>
                  <button
                    type="button"
                    onClick={applyMimoPreset}
                    aria-pressed={mimo}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      mimo
                        ? "bg-[var(--accent)] text-[var(--on-accent)]"
                        : "border border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
                    }`}
                  >
                    小米 mimo（chat/completions 音频）
                  </button>
                </div>
                {mimo ? (
                  <p className="mt-1 max-w-[64ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                    mimo 的 /audio/speech 返回 404，必须走聊天接口的音频模态。
                    地址与模型名必填：地址填到 /v1 为止，模型名以供应商文档为准；音频固定 mp3。
                  </p>
                ) : null}
              </div>

              <FormRow
                label="API 地址（Base URL）"
                hint={
                  mimo
                    ? "填到 /v1 为止，会自动拼接 /chat/completions（必填）"
                    : "填到 /v1 为止，会自动拼接 /audio/speech"
                }
              >
                <input
                  value={config.baseUrl ?? ""}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  className={monoInputClass}
                  placeholder={mimo ? "https://api.xiaomimimo.com/v1" : "https://api.openai.com/v1"}
                  spellCheck={false}
                />
              </FormRow>

              <FormRow label="API Key" hint="只保存在本浏览器，朗读时随请求发往你填的语音服务">
                <div className="flex gap-2">
                  <input
                    value={config.apiKey ?? ""}
                    onChange={(e) => update({ apiKey: e.target.value })}
                    type={showKey ? "text" : "password"}
                    className={`min-w-0 flex-1 ${monoInputClass}`}
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
              </FormRow>

              <FormGrid>
                <FormRow label="模型名" hint={mimo ? "必填，例如 mimo-v1" : "例如 tts-1"}>
                  <input
                    value={config.model ?? ""}
                    onChange={(e) => update({ model: e.target.value })}
                    className={monoInputClass}
                    placeholder={mimo ? "mimo-v1" : "tts-1"}
                    spellCheck={false}
                  />
                </FormRow>
                <FormRow label="音色" hint={mimo ? "默认茉莉" : "例如 alloy / nova"}>
                  <input
                    value={config.voice ?? ""}
                    onChange={(e) => update({ voice: e.target.value })}
                    className={monoInputClass}
                    placeholder={mimo ? "茉莉" : "alloy"}
                    spellCheck={false}
                  />
                </FormRow>
              </FormGrid>
            </>
          ) : null}

          {serverMode && remote ? (
            <p className="max-w-[64ch] rounded-lg border-l-2 border-[var(--line-strong)] bg-[var(--line)] px-3 py-2 text-xs leading-relaxed text-[var(--ink-soft)]">
              服务端模式下，端点、密钥、模型与音色都来自账号里的语音配置；浏览器不保存这些字段。
              在下面的表单保存一次后，朗读会走 POST /api/tts。
            </p>
          ) : null}

          <FormRow
            label={`语速 ${config.rate.toFixed(2)}×`}
            hint={`${RATE_MIN}–${RATE_MAX}，默认 1.0`}
          >
            <input
              type="range"
              min={RATE_MIN}
              max={RATE_MAX}
              step={0.05}
              value={config.rate}
              onChange={(e) => update({ rate: Number(e.target.value) })}
              className="w-full accent-[var(--accent)]"
            />
          </FormRow>
        </div>
      </SettingsGroup>

      <SettingsGroup title="试听与清理" hint="试听只念固定示例句；聊天页不会自动播放。">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={preview}
            disabled={!canPreview}
            className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {playing ? "停止" : "试听"}
          </button>
          {!canPreview && serverMode && !loggedIn && remote ? (
            <span className="text-xs text-[var(--warn)]">
              登录后才能使用服务端语音；未登录可先用浏览器语音。
            </span>
          ) : !canPreview ? (
            <span className="text-xs text-[var(--ink-faint)]">还缺：{issues.join("、")}</span>
          ) : (
            <span className="max-w-[52ch] text-xs leading-relaxed text-[var(--ink-faint)]">
              朗读时只念回答正文，引用标记与代码块会被跳过；单段最多 {SPEECH_MAX_CHARS} 字。
            </span>
          )}
        </div>

        {notice ? (
          <p
            role="status"
            className={`mt-2 max-w-[68ch] rounded-lg border px-3 py-2 text-xs leading-relaxed ${
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

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] pt-3">
          <p className="max-w-[56ch] text-xs leading-relaxed text-[var(--ink-faint)]">
            清除会删掉本浏览器的 alp.tts.v1 并停止播放；账号里的语音配置请在下方表单删除。
          </p>
          <DangerButton onClick={clearAll}>清除本机语音配置</DangerButton>
        </div>

        <ul className="mt-3 max-w-[68ch] space-y-1 text-xs leading-relaxed text-[var(--ink-faint)]">
          {serverMode ? (
            <>
              <li>· 服务端模式：语音密钥加密存在账号里，浏览器只看到掩码；朗读由本项目转发。</li>
              <li>· 端点会被服务端做 SSRF 校验（公网 https，禁内网）；失败自动回退浏览器语音并说明原因。</li>
            </>
          ) : (
            <>
              <li>· 本机模式：配置与密钥只存本浏览器 localStorage（alp.tts.v1），不上传本项目服务器。</li>
              <li>· 在线语音由浏览器直接请求你填的端点；端点不允许直连时会自动回退浏览器语音，并说明原因。</li>
            </>
          )}
          <li>· 语音配置与聊天 / 搜索密钥分开保存，不会互相复用。</li>
          <li>· 聊天页不会自动播放，每条回答需要手动点「朗读」。</li>
        </ul>
      </SettingsGroup>

      {serverMode ? (
        <SettingsGroup
          title="账号里的语音配置"
          hint="服务端代发使用账号里的端点与密钥；浏览器不保存这些字段。"
        >
          <SecretConfigForm
            kind="tts"
            title="语音配置（账号）"
            description="服务端代发时需要端点与密钥；保存后浏览器不再保存这些字段。"
            fields={TTS_FIELDS}
            statusHint="mimo 协议保存为 chat-audio；OpenAI 兼容保存为 speech。删除这份配置后，服务端朗读会明确报未配置。"
          />
        </SettingsGroup>
      ) : null}
    </div>
  );
}
