"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Nav,
  Pill,
  SettingsSection,
  SettingsGroup,
  FormRow,
  Collapse,
  DangerButton,
  inputClass,
  monoInputClass,
} from "@/components/ui";
import {
  PRESETS,
  loadProvider,
  saveProvider,
  clearProvider,
  maskKey,
  testConnection,
  checkBaseUrl,
  isLocalAddress,
  // chat.ts 按 ProviderConfig.mode 选直连或服务端代发；切模式时必须同步写回
  hydrateProviderFromServer as hydrateProviderConfigFromServer,
  type ProviderConfig,
  type ProviderKind,
  type TestResult,
  type ThinkingStatus,
} from "@/lib/provider";
import { probeThinking } from "@/lib/chat";
import type { ThinkingStrength } from "@/lib/reasoning";
import { THEMES, MODES } from "@/lib/themes";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/lib/useAuth";
import {
  DEFAULT_CALL_MODE,
  hydrateProviderFromServer,
  loadCallMode,
  saveCallMode,
  type CallMode,
  type ServerProviderState,
} from "@/lib/serverConfig";
import { MaterialSourcePanel } from "@/components/material-source-panel";
import { ThinkingSettings, type ProbeState } from "@/components/thinking-settings";
import { TtsSettings } from "@/components/tts-settings";
import { SearchSettings } from "@/components/search-settings";
import {
  SecretConfigForm,
  confirmPulse,
  useMotionSafe,
  type SecretField,
} from "@/components/secret-config-form";
import { useStaggerIn, useSwapIn } from "@/components/motion";

/*
 * 三个新分区的交互代码放在 sections.tsx，按需加载。
 * 静态 import 会把 MCP / 模型检查 / 向量重建整块打进首屏；这里用 next/dynamic
 * 拆到独立 chunk，首次切到该分区时再解析。
 * 面板外框、标题与 aria 仍留在本文件，隐藏面板的草稿在首次挂载后保留。
 */
const ToneSection = dynamic(() => import("./sections").then((mod) => mod.ToneSection), {
  ssr: false,
  loading: () => <SectionLoading label="语气" />,
});
const McpSection = dynamic(() => import("./sections").then((mod) => mod.McpSection), {
  ssr: false,
  loading: () => <SectionLoading label="智能体与工具" />,
});
const VectorSection = dynamic(() => import("./sections").then((mod) => mod.VectorSection), {
  ssr: false,
  loading: () => <SectionLoading label="向量检索" />,
});

function SectionLoading({ label }: { readonly label: string }) {
  return <p className="text-xs text-[var(--ink-faint)]">正在加载「{label}」…</p>;
}

/**
 * 设置页：左侧分区导航 + 右侧内容。
 *
 * 两种调用模式必须同时讲清楚，界面上不能只写其中一种：
 * - 服务端模式（默认）：密钥用 AES-GCM 加密存进账号，对话 / 搜索 / 语音由本项目代发；
 * - 本机模式：地址、密钥、模型名全部用户自填，密钥只存 localStorage，浏览器直连。
 *
 * 关键的安全与成本说明必须写在界面上，不能只写在文档里：
 * - 三类密钥（聊天 / 搜索 / 语音）位置不同，各有各的存储键与清除入口
 * - 服务端模式需要登录；未登录时界面按本机模式工作，不假装保存成功
 * - 思考档会抬高 max_tokens，费用显著增加；关档不增加预算
 * - HTTPS 页面不能请求 HTTP 地址（混合内容），这是浏览器硬限制
 *
 * 动效只做进入 / 切换 / 保存确认，不做滚动视差与循环动画。
 */

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "done"; result: TestResult };

const THINKING_LABEL: Record<ThinkingStrength, string> = {
  off: "关",
  standard: "标准",
  deep: "深入",
};

const SECTIONS = [
  { id: "mode", label: "调用模式" },
  { id: "provider", label: "模型供应商" },
  { id: "thinking", label: "思考与核对" },
  { id: "tone", label: "语气" },
  { id: "tts", label: "语音朗读" },
  { id: "search", label: "联网搜索" },
  { id: "materials", label: "知识口径" },
  { id: "agent", label: "智能体与工具" },
  { id: "vector", label: "向量检索" },
  { id: "appearance", label: "外观" },
  { id: "privacy", label: "密钥与隐私" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

const panelAttrs = (id: SectionId, active: SectionId) => ({
  role: "tabpanel" as const,
  id: `settings-panel-${id}`,
  "aria-labelledby": `settings-tab-${id}`,
  hidden: active !== id,
});

const MATERIAL_NOTES: ReadonlyArray<{ readonly term: string; readonly detail: string }> = [
  {
    term: "只存本浏览器。",
    detail:
      "来源选择、口径裁定与讲义正文都保存在 localStorage，不上传本项目服务器，也不写入任何日志。",
  },
  {
    term: "出题与讲解会把摘录发给模型供应商。",
    detail:
      "命中的教材 / 讲义 / 上传段落会随请求发到你配置的供应商：本机模式由浏览器直连，服务端模式由本项目转发到你保存在账号里的端点。这是让模型按你的口径作答的前提，不配置模型时不外发。",
  },
  {
    term: "公开方向会带上解析与出处。",
    detail:
      "基于摘录生成的题目解析与「依据：」标注会随方向保存；方向设为公开后任何访问者都能看到，讲义正文原文不入库。",
  },
  {
    term: "登出与换号都会清空。",
    detail: "退出登录、或在本浏览器换另一个账号登录，都会删除上一位用户的资料存档。",
  },
  {
    term: "支持 Markdown / TXT / PDF。",
    detail:
      "PDF 在浏览器里用 pdfjs-dist 抽取文本，需要文件自带文本层；扫描件不做 OCR，PPT / DOCX 不解析。",
  },
  {
    term: "上传资料只存在本浏览器。",
    detail:
      "抽取后的文本按方向存进 IndexedDB，不保存原始文件、不上传本项目服务器；换浏览器或换设备需要重新上传，方向市场里的副本默认是空库。",
  },
];

const PRIVACY_NOTES: ReadonlyArray<{ readonly term: string; readonly detail: string }> = [
  {
    term: "两种模式，密钥位置不同。",
    detail:
      "服务端模式：密钥用 AES-GCM 加密存进账号数据库，浏览器只看到掩码，对话 / 搜索 / 语音由本项目代发；本机模式：密钥只存这个浏览器的 localStorage，请求由浏览器直连供应商，本项目不经手。",
  },
  {
    term: "服务端模式需要登录。",
    detail:
      "未登录界面按本机模式工作；登录后可在「调用模式」里切换并保存到账号。服务端缺少主密钥（ALP_SECRET_KEY）时会拒绝保存并明确报错，不会明文落库。",
  },
  {
    term: "清除位置。",
    detail:
      "本机模式：模型供应商的「清除本机配置」删除 alp.provider.v1；搜索分区的「清除本机搜索配置」删除 alp.search.v1 与 alp.websearch.v1:*；语音分区的「清除本机语音配置」删除 alp.tts.v1 并停止播放。服务端模式：各账号表单里的「删除账号配置」删除服务端那一行。",
  },
  {
    term: "上传资料不随请求整份外发。",
    detail:
      "只有检索命中的段落会随出题或问答请求发给你配置的模型；原文本身留在本浏览器的 IndexedDB。",
  },
  {
    term: "图片只在当轮存在，不落库。",
    detail:
      "本机模式下图片由浏览器直连供应商；服务端模式下图片会经本项目转发给你配置的模型供应商，只在该次请求的内存里存在，不写入数据库、不写日志，刷新即失。",
  },
  {
    term: "MCP 鉴权头只显示掩码。",
    detail:
      "自建 MCP 服务器的鉴权头用账号主密钥加密存库，设置页与任何响应只显示末 4 位掩码；服务器地址与工具白名单是可公开配置，但同样只存在你的账号里。",
  },
  {
    term: "语气与向量索引存在哪。",
    detail:
      "语气选择目前只存这个浏览器（alp.tutor.tone.v1）；本地向量索引写在账号的 kb_chunk_vectors 表，原始片段仍按知识库同步规则上传。",
  },
  {
    term: "费用由填 key 的人承担。",
    detail: "调用计入你的账户额度；思考档会抬高 max_tokens，开思考前先看成本说明。",
  },
  {
    term: "HTTPS 站点不能请求 HTTP 地址。",
    detail:
      "这是本机模式下的浏览器混合内容策略，无法在页面内绕过；服务端模式由本项目代发，端点只需通过服务端的 SSRF 校验（公网 https）。",
  },
  {
    term: "公共电脑上用完请点「清除」。",
    detail:
      "localStorage 在同一浏览器内共享；搜索与语音密钥需在对应分区单独清除，账号里的配置请在登录状态下用各表单的删除按钮。",
  },
  {
    term: "路径功能不依赖任何密钥。",
    detail: "即使不配置，诊断与路径仍完整可用——这是本项目的核心设计。",
  },
];

/**
 * 账号里的 llm 行字段。
 *
 * 字段列表必须是模块常量：SecretConfigForm 用它的引用作为「只加载一次」的依据，
 * 在组件里每次渲染新建数组会导致反复请求 /api/config。
 * width: "half" 只影响排版（成对字段两列），不影响提交体。
 */
const LLM_FIELDS: readonly SecretField[] = [
  { name: "label", label: "显示名", width: "half", hint: "只用于界面标识", placeholder: "我的 DeepSeek" },
  {
    name: "kind",
    label: "协议",
    width: "half",
    type: "select",
    options: [
      { value: "openai-compatible", label: "OpenAI 兼容：/chat/completions" },
      { value: "anthropic", label: "Anthropic Messages：/messages" },
    ],
  },
  {
    name: "baseUrl",
    label: "API 地址（Base URL）",
    type: "url",
    required: true,
    hint: "填到 /v1 为止；服务端会做 SSRF 校验，只接受公网 https，内网地址会被拒绝",
    placeholder: "https://api.deepseek.com/v1",
  },
  {
    name: "apiKey",
    label: "API Key",
    type: "password",
    required: true,
    hint: "加密存在账号里，浏览器只看到掩码；已保存后留空表示不修改",
    placeholder: "sk-…",
  },
  { name: "model", label: "模型名", required: true, placeholder: "deepseek-chat" },
  {
    name: "extraHeaders",
    label: "额外请求头（可选）",
    hint: 'JSON 字符串，例如 {"X-Org":"xxx"}，加密保存',
    placeholder: '{"X-Custom":"value"}',
  },
  {
    name: "thinking",
    label: "思考强度",
    width: "half",
    type: "select",
    options: [
      { value: "off", label: "关" },
      { value: "standard", label: "标准" },
      { value: "deep", label: "深入" },
    ],
  },
  {
    name: "verification",
    label: "依据核对",
    width: "half",
    type: "select",
    options: [
      { value: "true", label: "开" },
      { value: "false", label: "关" },
    ],
  },
  {
    name: "embeddingBaseUrl",
    label: "向量模型地址（可选）",
    type: "url",
    hint: "留空表示不做向量检索，只走 BM25",
    placeholder: "https://api.siliconflow.cn/v1",
  },
  {
    name: "embeddingModel",
    label: "向量模型名（可选）",
    width: "half",
    placeholder: "BAAI/bge-m3",
  },
  {
    name: "embeddingApiKey",
    label: "向量模型 Key（可选）",
    width: "half",
    type: "password",
    hint: "留空复用上面的聊天密钥；只有向量服务是另一个账号时才需要填",
    placeholder: "sk-…",
  },
];

export default function SettingsPage() {
  const { theme, mode, setTheme, setMode } = useTheme();
  const { user, loading: authLoading } = useAuth();

  // 分区导航：同一时刻只展示一个面板；所有面板保持挂载，避免切走再回来丢草稿
  const [active, setActive] = useState<SectionId>("mode");
  const mainRef = useRef<HTMLElement | null>(null);

  /*
   * ?panel=<id> 深链必须在挂载后读：用 useState 初始化时读 window 会让
   * 服务端渲染成 "mode"、客户端水合不再重跑，深链失效并报 hydration 不一致。
   */
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("panel");
    if (param !== null && SECTIONS.some((s) => s.id === param)) {
      setActive(param as SectionId);
    }
  }, []);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const runMotion = useMotionSafe();

  /*
   * 展示层动效：标题 / 状态栏 / 分区导航做一次性 stagger；分区内容在
   * active 变化时淡入 8px 上移（useSwapIn 自动跳过首次挂载）。
   * reduced-motion 下两者都不建 tween，保存确认的脉冲由 useMotionSafe 跳过。
   */
  useStaggerIn(mainRef);
  useSwapIn(panelRef, active);

  // 调用模式与账号配置；未登录时按本机模式工作（服务端模式按钮禁用）
  const [callMode, setCallMode] = useState<CallMode>(DEFAULT_CALL_MODE);
  const [serverState, setServerState] = useState<ServerProviderState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(false);
  const [hydrateTick, setHydrateTick] = useState(0);

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

  // 思考强度与依据核对属于供应商配置，跟其余字段一起「保存配置」落盘
  const [thinking, setThinking] = useState<ThinkingStrength>("off");
  const [thinkingStatus, setThinkingStatus] = useState<ThinkingStatus>("unknown");
  const [verification, setVerification] = useState(true);
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });
  const probeController = useRef<AbortController | null>(null);

  // 三个新分区按需挂载；首次进入后保持挂载，切走再回来不丢草稿。
  // 分开三个标记是为了「点语气」不会顺带触发 MCP 请求与模型文件检查。
  const [toneMounted, setToneMounted] = useState(false);
  const [agentMounted, setAgentMounted] = useState(false);
  const [vectorMounted, setVectorMounted] = useState(false);

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
      setThinking(p.thinking ?? "off");
      setThinkingStatus(p.thinkingStatus ?? "unknown");
      setVerification(p.verification !== false);
      // 匹配到预设就选中它，否则落到对应协议的自定义
      const matched = PRESETS.find(
        (x) => x.baseUrl === p.baseUrl && x.kind === p.kind,
      );
      setPresetId(matched?.id ?? (p.kind === "anthropic" ? "custom-anthropic" : "custom-openai"));
    } else {
      applyPreset("deepseek");
    }
    // 只在挂载时回显一次；applyPreset 是稳定的纯 setter，放进依赖会重复覆盖用户输入
    return () => probeController.current?.abort();
  }, []);

  // 回显上次选择的调用模式；服务端默认值在 serverConfig 里
  useEffect(() => {
    setCallMode(loadCallMode());
  }, []);

  // 第一次进入某个新分区时才加载对应内容；之后保持挂载
  useEffect(() => {
    if (active === "tone") setToneMounted(true);
    else if (active === "agent") setAgentMounted(true);
    else if (active === "vector") setVectorMounted(true);
  }, [active]);

  /**
   * 生效模式：未登录时服务端模式没有意义（保存不了、代理也会 401），
   * 界面与调用链一律按本机模式工作，但不改写用户存下的选择。
   */
  const effectiveMode: CallMode = user === null ? "local" : callMode;

  // 登录后（以及表单保存后）把账号里的 llm 行读回来；未登录时清空，不显示假状态
  useEffect(() => {
    if (authLoading) return;
    if (user === null) {
      setServerState(null);
      setServerError(null);
      setHydrating(false);
      return;
    }

    const controller = new AbortController();
    setHydrating(true);
    void (async () => {
      const result = await hydrateProviderFromServer(effectiveMode, controller.signal);
      if (controller.signal.aborted) return;
      setHydrating(false);
      setServerState(result.state);
      setServerError(result.ok ? null : result.error.message);

      /*
       * 对话链路读的是 provider.ts 的 ProviderConfig.mode（alp.provider.v1），
       * 这里把模式对齐，界面选择才真正影响调用：
       * - server：从 /api/config 水合（无 llm 行时记成「服务端未配置」）；
       * - local：登录后 provider.ts 可能已自动水合成服务端配置。此时界面跟随实际
       *   调用链切到服务端，而不是显示「本机」却由服务端代发；用户手动点「本机」
       *   才会显式降级（见 chooseMode）。
       */
      if (effectiveMode === "server") {
        void hydrateProviderConfigFromServer();
      } else {
        const local = loadProvider();
        if (local !== null && local.mode === "server") {
          setCallMode("server");
          saveCallMode("server");
          setExisting(null);
        } else {
          setExisting(local);
        }
      }
    })();

    return () => controller.abort();
  }, [authLoading, user, effectiveMode, hydrateTick]);

  /*
   * 分区切换的动效已交给 useSwapIn(panelRef, active)（见组件顶部）：
   * 0.28s 淡入 + 8px 上移，首次挂载不播，reduced-motion 下不建 tween。
   */

  function chooseMode(next: CallMode) {
    if (next === "server" && user === null) return;
    setCallMode(next);
    saveCallMode(next);

    // 只改 alp.callmode.v1 不够：真正发请求的 chat.ts 读的是 ProviderConfig.mode。
    if (next === "server") {
      void hydrateProviderConfigFromServer();
    } else {
      const current = loadProvider();
      if (current !== null) saveProvider({ ...current, mode: "local" });
      setExisting(loadProvider());
    }
  }

  function refreshServerState() {
    void hydrateProviderConfigFromServer();
    setHydrateTick((value) => value + 1);
  }

  /**
   * 换了预设、协议、地址或模型后，上一个端点的探测结论不再成立。
   * 不重置的话，unsupported 会一直把新端点的思考档锁在置灰状态。
   */
  function resetThinkingStatus() {
    probeController.current?.abort();
    probeController.current = null;
    setThinkingStatus("unknown");
    setProbe({ status: "idle" });
  }

  function applyPreset(id: string) {
    setPresetId(id);
    resetThinkingStatus();
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
    // 本机表单保存的永远是直连配置；不写 mode 会被旧存档的 server 值带偏
    mode: "local",
    kind,
    baseUrl: baseUrl.trim().replace(/\/+$/, ""),
    apiKey: apiKey.trim(),
    model: model.trim(),
    extraHeaders: extraHeaders.trim() || undefined,
    // 三项必须带上：save() 调它，漏掉就会「保存 → 刷新 → 再读」丢字段
    thinking,
    thinkingStatus,
    verification,
  });

  const canTest = baseUrl.trim() !== "" && apiKey.trim() !== "" && model.trim() !== "";
  const urlCheck = baseUrl.trim() === "" ? null : checkBaseUrl(baseUrl);
  const localAddr = isLocalAddress(baseUrl);

  /** 探测思考参数。结论写回表单状态，仍要点「保存配置」才落盘。 */
  async function runProbe() {
    if (!canTest || thinking === "off") return;
    probeController.current?.abort();
    const controller = new AbortController();
    probeController.current = controller;

    setProbe({ status: "running" });
    const result = await probeThinking(currentConfig(), controller.signal);
    if (controller.signal.aborted) return;
    probeController.current = null;
    setProbe({ status: "done", result });
    setThinkingStatus(result.status);
  }

  async function runTest() {
    setTest({ status: "testing" });
    const result = await testConnection(currentConfig());
    setTest({ status: "done", result });
    // 连得上不代表端点接受思考字段；思考档非「关」时顺带探测一次
    if (result.ok && thinking !== "off") await runProbe();
  }

  function save() {
    saveProvider(currentConfig());
    setExisting(currentConfig());
    setSaved(true);
    // 按钮短暂确认态；reduced-motion 下 useMotionSafe 会直接跳过
    runMotion(() => confirmPulse(saveButtonRef.current));
    setTimeout(() => setSaved(false), 2500);
  }

  function remove() {
    clearProvider();
    setExisting(null);
    setApiKey("");
    setTest({ status: "idle" });
    resetThinkingStatus();
  }

  const preset = PRESETS.find((p) => p.id === presetId);

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = (index + 1) % SECTIONS.length;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = (index - 1 + SECTIONS.length) % SECTIONS.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = SECTIONS.length - 1;
    }
    const target = SECTIONS[next];
    if (target === undefined) return;
    setActive(target.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <>
      <Nav />
      <main id="main" ref={mainRef} className="mx-auto max-w-6xl px-5 py-8 sm:py-10">
        <div className="mb-6 max-w-[62ch]" data-motion="hero">
          <h1 className="text-2xl font-semibold tracking-tight">设置</h1>
          <p className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">
            按左侧分区逐项配置。调用模式决定请求由谁发出；其余分区各自保存，互不覆盖。
          </p>
        </div>

        {/* ── 当前状态：只读摘要，不参与编辑 ── */}
        <div
          data-motion="status"
          className="mb-8 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--line)] pb-5 text-sm"
        >
          <span className="text-[var(--ink-soft)]">当前状态</span>
          {effectiveMode === "server" ? (
            serverState?.serverConfigured ? (
              <>
                <Pill tone="good">已配置（账号）</Pill>
                <span className="max-w-[70ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                  {serverState.label} · {serverState.model} ·{" "}
                  {serverState.api === "anthropic" ? "Anthropic 协议" : "OpenAI 兼容"} ·
                  密钥加密存服务端 · 思考 {THINKING_LABEL[serverState.options.thinking]} · 依据核对{" "}
                  {serverState.options.verification ? "开" : "关"}
                </span>
              </>
            ) : hydrating ? (
              <span className="text-xs text-[var(--ink-faint)]">正在读取账号配置…</span>
            ) : (
              <>
                <Pill tone="warn">未配置（账号）</Pill>
                <span className="max-w-[70ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                  在「模型供应商」保存一次模型配置；在此之前导师页使用知识库检索模式
                </span>
              </>
            )
          ) : existing ? (
            <>
              <Pill tone="good">已配置（本机）</Pill>
              <span className="max-w-[70ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                {existing.label} · {existing.model} ·{" "}
                {existing.kind === "anthropic" ? "Anthropic 协议" : "OpenAI 兼容"} · key{" "}
                <span className="font-mono">{maskKey(existing.apiKey)}</span> · 思考{" "}
                {THINKING_LABEL[existing.thinking ?? "off"]} · 依据核对{" "}
                {existing.verification !== false ? "开" : "关"}
              </span>
            </>
          ) : (
            <>
              <Pill tone="warn">未配置（本机）</Pill>
              <span className="max-w-[70ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                导师页将使用知识库检索模式，路径功能不受影响
              </span>
            </>
          )}
        </div>
        {effectiveMode === "server" && serverError !== null ? (
          <p className="mb-8 max-w-[70ch] text-xs leading-relaxed text-[var(--warn)]">{serverError}</p>
        ) : null}

        <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-10">
          {/* 窄屏：顶部横向 scroll 的分区标签；lg 以上改为左侧竖向导航 */}
          <nav aria-label="设置分区" data-motion="nav" className="lg:sticky lg:top-8 lg:self-start">
            <div
              role="tablist"
              aria-orientation="vertical"
              className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-2 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0"
            >
              {SECTIONS.map((section, index) => {
                const selected = active === section.id;
                return (
                  <button
                    key={section.id}
                    ref={(element) => {
                      tabRefs.current[index] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`settings-tab-${section.id}`}
                    aria-selected={selected}
                    aria-controls={`settings-panel-${section.id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setActive(section.id)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                    className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors lg:w-full ${
                      selected
                        ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                        : "text-[var(--ink-soft)] hover:bg-[var(--line)] hover:text-[var(--ink)]"
                    }`}
                  >
                    {section.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div
            ref={panelRef}
            data-motion="settings-panel"
            data-motion-manual
            className="mt-6 min-w-0 lg:mt-0"
          >
            {/* ── 调用模式 ── */}
            <div {...panelAttrs("mode", active)}>
              <SettingsSection
                title="调用模式"
                hint="先决定请求由谁发出：服务端代发省心，本机直连不用登录。"
              >
                <SettingsGroup
                  title="生效方式"
                  hint="两种模式随时切换；切换只影响这台设备的调用链，账号里的配置不会因此被删除。"
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => chooseMode("server")}
                      disabled={user === null}
                      aria-pressed={effectiveMode === "server"}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        effectiveMode === "server"
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--line-strong)] hover:bg-[var(--line)]"
                      }`}
                    >
                      <span className="block font-medium">服务端（默认）</span>
                      <span className="mt-1 block max-w-[46ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                        密钥 AES-GCM 加密存进账号，换设备也能用；对话 / 搜索 / 语音由本项目代发
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseMode("local")}
                      aria-pressed={effectiveMode === "local"}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                        effectiveMode === "local"
                          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                          : "border-[var(--line-strong)] hover:bg-[var(--line)]"
                      }`}
                    >
                      <span className="block font-medium">本机</span>
                      <span className="mt-1 block max-w-[46ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                        密钥只存这个浏览器，请求由浏览器直连供应商；无需登录
                      </span>
                    </button>
                  </div>

                  {user === null ? (
                    <p className="mt-4 max-w-[64ch] text-xs leading-relaxed text-[var(--ink-soft)]">
                      {authLoading
                        ? "正在确认登录状态…"
                        : "未登录：服务端模式需要先登录，登录后可保存到账号；当前按本机模式工作。"}
                      {authLoading ? null : (
                        <>
                          {" "}
                          <a href="/login" className="underline">
                            去登录
                          </a>
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="mt-4 max-w-[64ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                      已登录 {user.email}。切换只影响这台设备的调用链，账号里的配置不会因切换被删除。
                    </p>
                  )}
                </SettingsGroup>
              </SettingsSection>
            </div>

            {/* ── 模型供应商 ── */}
            <div {...panelAttrs("provider", active)}>
              <SettingsSection
                title="模型供应商"
                hint={
                  effectiveMode === "server"
                    ? "服务端模式：配置加密存在账号里，浏览器不保存密钥。"
                    : "选一个预设，或填任何兼容端点。地址、密钥、模型名填齐后才能测试。"
                }
              >
                {effectiveMode === "server" ? (
                  <SecretConfigForm
                    kind="llm"
                    title="账号里的模型配置"
                    description="保存后对话与出题由本项目代发（POST /api/llm/chat）；密钥只在服务端解密，浏览器只看到掩码。"
                    fields={LLM_FIELDS}
                    statusHint="删除这份配置后，服务端代发会明确报「还没有保存模型配置」，不会静默换成知识库回答。"
                    onChanged={refreshServerState}
                  />
                ) : (
                  <>
                    <SettingsGroup
                      title="预设"
                      hint="选预设会自动填好地址与模型名，之后仍可逐项修改。"
                    >
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

                      <p className="mt-4 text-xs font-medium text-[var(--ink-soft)]">自定义端点</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                        <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                          {preset.note}
                        </p>
                      ) : null}
                    </SettingsGroup>

                    <SettingsGroup
                      title="连接参数"
                      hint="本机模式的密钥只保存在这个浏览器；地址填到 /v1 为止。"
                    >
                      <div className="max-w-2xl space-y-4">
                        <FormRow label="显示名" hint="只用于界面标识">
                          <input
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            className={inputClass}
                            placeholder="例如：我的 DeepSeek"
                          />
                        </FormRow>

                        <FormRow
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
                              resetThinkingStatus();
                            }}
                            className={monoInputClass}
                            placeholder={
                              kind === "anthropic"
                                ? "https://api.anthropic.com/v1"
                                : "https://api.deepseek.com/v1"
                            }
                            spellCheck={false}
                          />
                        </FormRow>

                        {/* 地址问题就地提示，不等用户点测试 */}
                        {urlCheck && urlCheck.kind !== "ok" ? (
                          <div className="rounded-lg border-l-2 border-[var(--warn)] bg-[var(--warn-soft)] px-3 py-2.5 text-sm">
                            <p className="font-medium text-[var(--warn)]">
                              {urlCheck.kind === "mixed-content"
                                ? "HTTPS 页面不能请求 HTTP 地址"
                                : "地址有问题"}
                            </p>
                            <p className="mt-1 text-[var(--ink-soft)]">{urlCheck.detail}</p>
                            {urlCheck.kind === "mixed-content" ? (
                              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--ink-soft)]">
                                <li>· 这是浏览器的安全策略，无法在页面内绕过</li>
                                <li>· 给该服务配 HTTPS 域名（推荐，前面挂一层反向代理 + 证书）</li>
                                <li>· 或在本机跑本项目（http://localhost:3000）再连这个内网地址</li>
                              </ul>
                            ) : null}
                          </div>
                        ) : null}

                        {localAddr && urlCheck?.kind === "ok" ? (
                          <p className="max-w-[62ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                            检测到本地或内网地址。只有在同网络环境下的浏览器才能访问；
                            若本项目部署在公网，请改用可公网访问的地址。
                          </p>
                        ) : null}

                        <FormRow
                          label="API Key"
                          hint="本机模式：只保存在本浏览器，不上传到任何服务器；服务端模式的密钥在账号里加密保存"
                        >
                          <div className="flex gap-2">
                            <input
                              value={apiKey}
                              onChange={(e) => setApiKey(e.target.value)}
                              type={showKey ? "text" : "password"}
                              className={`min-w-0 flex-1 ${monoInputClass}`}
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
                        </FormRow>

                        <FormRow label="模型名" hint="必须是供应商实际支持的模型 id">
                          <input
                            value={model}
                            onChange={(e) => {
                              setModel(e.target.value);
                              resetThinkingStatus();
                            }}
                            className={monoInputClass}
                            placeholder={kind === "anthropic" ? "claude-sonnet-4-5-20250929" : "deepseek-chat"}
                            spellCheck={false}
                          />
                        </FormRow>

                        <Collapse title="高级：协议类型与额外请求头">
                          <div className="space-y-4">
                            <FormRow
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
                                  resetThinkingStatus();
                                }}
                                className={inputClass}
                              >
                                <option value="openai-compatible">OpenAI 兼容</option>
                                <option value="anthropic">Anthropic Messages</option>
                              </select>
                            </FormRow>
                            <FormRow label="额外请求头" hint='JSON 格式，例如 {"X-Org":"xxx"}'>
                              <input
                                value={extraHeaders}
                                onChange={(e) => setExtraHeaders(e.target.value)}
                                className={monoInputClass}
                                placeholder='{"X-Custom":"value"}'
                                spellCheck={false}
                              />
                            </FormRow>
                          </div>
                        </Collapse>
                      </div>
                    </SettingsGroup>

                    <SettingsGroup
                      title="保存与测试"
                      hint="思考强度与依据核对也随「保存配置」写入本浏览器。"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          ref={saveButtonRef}
                          type="button"
                          onClick={save}
                          disabled={!canTest}
                          className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {saved ? "已保存" : "保存配置"}
                        </button>
                        <button
                          type="button"
                          onClick={runTest}
                          disabled={!canTest || test.status === "testing"}
                          className="rounded-lg border border-[var(--line-strong)] px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {test.status === "testing" ? "测试中…" : "测试连通性"}
                        </button>
                        <span role="status" className="max-w-[52ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                          {saved
                            ? "已保存到本浏览器"
                            : !canTest
                              ? "填齐地址、密钥、模型名后才能测试与保存"
                              : "保存后导师页立即使用这份配置"}
                        </span>
                      </div>

                      {test.status === "done" ? <TestReport result={test.result} /> : null}

                      {existing ? (
                        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[var(--line)] pt-3">
                          <p className="max-w-[56ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                            清除只删除本浏览器的 alp.provider.v1；导师页会回到知识库检索模式。
                          </p>
                          <DangerButton onClick={remove}>清除本机配置</DangerButton>
                        </div>
                      ) : null}
                    </SettingsGroup>
                  </>
                )}
              </SettingsSection>
            </div>

            {/* ── 思考与核对 ── */}
            <div {...panelAttrs("thinking", active)}>
              <SettingsSection
                title="思考与核对"
                hint="思考强度只影响导师回答；依据核对只给引用打标记，不改写回答。"
              >
                {effectiveMode === "server" ? (
                  <p className="max-w-[68ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                    服务端模式下思考档随账号配置保存；「探测端点是否接受思考参数」需要浏览器直连，
                    请切到本机模式后再探测。探测结论不影响服务端代发。
                  </p>
                ) : null}
                <ThinkingSettings
                  thinking={thinking}
                  thinkingStatus={thinkingStatus}
                  verification={verification}
                  providerReady={effectiveMode === "local" && canTest}
                  probe={probe}
                  onThinkingChange={setThinking}
                  onVerificationChange={setVerification}
                  onProbe={runProbe}
                />
              </SettingsSection>
            </div>

            {/* ── 语气 ── */}
            <div {...panelAttrs("tone", active)}>
              <SettingsSection
                title="语气"
                hint="同一套安全规则下换口吻：陪伴、学长、严格三选一。语气不改依据优先级，也不放宽引用与不确定协议。"
              >
                {toneMounted ? <ToneSection /> : <SectionLoading label="语气" />}
              </SettingsSection>
            </div>

            {/* ── 语音朗读 ── */}
            <div {...panelAttrs("tts", active)}>
              <SettingsSection
                title="语音朗读"
                hint="把导师回答念出来。浏览器语音免费；在线语音在本机模式直连、服务端模式由本项目代发。"
              >
                <TtsSettings mode={effectiveMode} loggedIn={user !== null} />
              </SettingsSection>
            </div>

            {/* ── 联网搜索 ── */}
            <div {...panelAttrs("search", active)}>
              <SettingsSection
                title="联网搜索"
                hint="导师提问时可补充外部网页；结果会标为「未核对」，与教材 / 上传资料分开显示。"
              >
                <SearchSettings mode={effectiveMode} loggedIn={user !== null} />
              </SettingsSection>
            </div>

            {/* ── 知识口径 ── */}
            <div {...panelAttrs("materials", active)}>
              <SettingsSection
                title="知识口径与出处"
                hint="决定生成时引用哪本教材 / 哪份讲义，以及同一知识点出现口径分歧时按谁的说法。"
              >
                <MaterialSourcePanel />
                <SettingsGroup
                  title="资料如何保存与外发"
                  hint="这些边界不随界面折叠隐藏，避免误以为资料会上传。"
                >
                  <dl className="divide-y divide-[var(--line)]">
                    {MATERIAL_NOTES.map((note) => (
                      <div key={note.term} className="py-3 first:pt-0">
                        <dt className="text-sm font-medium">{note.term}</dt>
                        <dd className="mt-0.5 max-w-[68ch] text-sm leading-relaxed text-[var(--ink-soft)]">
                          {note.detail}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </SettingsGroup>
              </SettingsSection>
            </div>

            {/* ── 智能体与工具 ── */}
            <div {...panelAttrs("agent", active)}>
              <SettingsSection
                title="智能体与工具"
                hint="给服务端 Agent 接自建 MCP 服务器；工具默认拒绝，只有白名单里的只读工具会被调用。"
              >
                {agentMounted ? (
                  <McpSection
                    userId={user?.id ?? null}
                    effectiveMode={effectiveMode}
                    serverConfigured={serverState === null ? null : serverState.serverConfigured}
                    authLoading={authLoading}
                  />
                ) : (
                  <SectionLoading label="智能体与工具" />
                )}
              </SettingsSection>
            </div>

            {/* ── 向量检索 ── */}
            <div {...panelAttrs("vector", active)}>
              <SettingsSection
                title="向量检索"
                hint="本地 bge-small-zh-v1.5 给上传资料建 512 维索引；模型或索引不可用时自动退回 BM25，主流程不受影响。"
              >
                {vectorMounted ? (
                  <VectorSection userId={user?.id ?? null} />
                ) : (
                  <SectionLoading label="向量检索" />
                )}
              </SettingsSection>
            </div>

            {/* ── 外观 ── */}
            <div {...panelAttrs("appearance", active)}>
              <SettingsSection
                title="外观"
                hint="5 套配色 × 明暗两种模式，选择会保存在本浏览器。"
              >
                <SettingsGroup title="明暗模式" hint="跟随系统时会实时响应系统的切换。">
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
                </SettingsGroup>

                <SettingsGroup
                  title="配色主题"
                  hint="5 套配色全部通过 WCAG AAA 正文对比度（≥7:1），可随时切换。"
                >
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
                            : "border-[var(--line-strong)] hover:bg-[var(--line)]"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{t.name}</span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--ink-faint)]">
                            {t.note}
                          </span>
                        </span>
                        {theme === t.id ? <Pill tone="accent">当前</Pill> : null}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 max-w-[62ch] text-xs leading-relaxed text-[var(--ink-faint)]">
                    主题与明暗是两个独立维度，5 × 2 = 10 个组合。
                  </p>
                </SettingsGroup>
              </SettingsSection>
            </div>

            {/* ── 密钥与隐私 ── */}
            <div {...panelAttrs("privacy", active)}>
              <SettingsSection
                title="密钥与隐私"
                hint="只把边界说清楚：密钥存在哪、什么会外发、怎么彻底删除。"
              >
                <SettingsGroup
                  title="存储与删除位置"
                  hint="三类密钥位置不同，各有各的存储键与清除入口。"
                >
                  <dl className="divide-y divide-[var(--line)]">
                    {PRIVACY_NOTES.map((note) => (
                      <div key={note.term} className="py-3 first:pt-0">
                        <dt className="text-sm font-medium">{note.term}</dt>
                        <dd className="mt-0.5 max-w-[68ch] text-sm leading-relaxed text-[var(--ink-soft)]">
                          {note.detail}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </SettingsGroup>
              </SettingsSection>
            </div>
          </div>
        </div>
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
    <div className={`mt-3 max-w-[68ch] rounded-lg border p-3 text-sm ${tone}`} role="status">
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
        <ul className="mt-2 space-y-1 text-xs leading-relaxed text-[var(--ink-soft)]">
          {result.hints.map((h) => (
            <li key={h}>· {h}</li>
          ))}
        </ul>
      ) : null}
      {result.ok ? (
        <p className="mt-1 text-xs leading-relaxed text-[var(--ink-faint)]">
          支持流式回答。导师页会使用此配置；思考强度只影响导师回答，出题仍是非思考模式。
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
