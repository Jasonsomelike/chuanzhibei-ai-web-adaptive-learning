import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TTS_CONFIG,
  RATE_MAX,
  RATE_MIN,
  SPEECH_MAX_CHARS,
  TTS_STORAGE_KEY,
  cleanTextForSpeech,
  isSpeaking,
  listBrowserVoices,
  loadTtsConfig,
  parseTtsConfig,
  prepareSpeechText,
  saveTtsConfig,
  speakBrowser,
  speakRemote,
  stopSpeaking,
  subscribeBrowserVoices,
  ttsConfigIssues,
  ttsEndpoint,
  type TtsConfig,
} from "@/lib/tts";

// ── 测试替身 ──────────────────────────────────────────────────────

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
  };
}

class FakeUtterance {
  text: string;
  lang = "";
  rate = 1;
  voice: SpeechSynthesisVoice | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

interface SynthHarness {
  readonly synth: {
    speaking: boolean;
    pending: boolean;
    cancel: ReturnType<typeof vi.fn>;
    getVoices: () => SpeechSynthesisVoice[];
    speak: ReturnType<typeof vi.fn>;
  };
  readonly utterances: FakeUtterance[];
}

/** autoEnd=false 时朗读保持「进行中」，供停止测试使用。 */
function installSpeech(options: { autoEnd?: boolean; voices?: SpeechSynthesisVoice[] } = {}): SynthHarness {
  const utterances: FakeUtterance[] = [];
  const autoEnd = options.autoEnd !== false;
  const synth = {
    speaking: false,
    pending: false,
    cancel: vi.fn(() => {
      synth.speaking = false;
      synth.pending = false;
    }),
    getVoices: () => options.voices ?? [],
    speak: vi.fn((utterance: FakeUtterance) => {
      utterances.push(utterance);
      synth.speaking = true;
      if (autoEnd) {
        queueMicrotask(() => {
          synth.speaking = false;
          utterance.onend?.();
        });
      }
    }),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  return { synth, utterances };
}

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  paused = true;
  ended = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  removeAttribute = vi.fn();
  load = vi.fn();

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
}

function installAudio(): { instances: FakeAudio[] } {
  FakeAudio.instances = [];
  vi.stubGlobal("Audio", FakeAudio);
  return { instances: FakeAudio.instances };
}

function installObjectUrl() {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:tts-test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  return { create, revoke };
}

const REMOTE: TtsConfig = {
  engine: "openai-compatible",
  rate: 1,
  baseUrl: "https://api.example.com/v1/",
  apiKey: "sk-test",
  model: "tts-1",
  voice: "alloy",
};

const AUDIO_RESPONSE = (): Response =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });

beforeEach(() => {
  FakeAudio.instances = [];
});

afterEach(() => {
  stopSpeaking();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── 配置 ──────────────────────────────────────────────────────────

describe("TtsConfig 读写", () => {
  it("没有存档或 SSR 下返回默认配置，save 不抛错", () => {
    expect(loadTtsConfig()).toEqual(DEFAULT_TTS_CONFIG);
    expect(() => saveTtsConfig(REMOTE)).not.toThrow();
  });

  it("保存到 alp.tts.v1 并可原样读回", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    saveTtsConfig(REMOTE);

    expect(JSON.parse(storage.getItem(TTS_STORAGE_KEY) ?? "null")).toMatchObject({
      engine: "openai-compatible",
      rate: 1,
      baseUrl: "https://api.example.com/v1/",
      apiKey: "sk-test",
      model: "tts-1",
      voice: "alloy",
    });
    expect(loadTtsConfig()).toEqual(REMOTE);
  });

  it("坏 JSON 退回默认配置，不抛错", () => {
    const storage = memoryStorage();
    storage.setItem(TTS_STORAGE_KEY, "{不是 JSON");
    vi.stubGlobal("window", { localStorage: storage });

    expect(loadTtsConfig()).toEqual(DEFAULT_TTS_CONFIG);
  });

  it("不认识的引擎退回 browser，语速夹到 0.8–1.2，字符串数字也接受", () => {
    expect(parseTtsConfig({ engine: "elevenlabs", rate: 9 })).toEqual({
      engine: "browser",
      rate: RATE_MAX,
    });
    expect(parseTtsConfig({ engine: "openai-compatible", rate: 0.1 })).toEqual({
      engine: "openai-compatible",
      rate: RATE_MIN,
    });
    expect(parseTtsConfig('{"engine":"openai-compatible","rate":"1.1"}')).toEqual({
      engine: "openai-compatible",
      rate: 1.1,
    });
  });

  it("空白字段归一化为 undefined，非对象输入退回默认", () => {
    expect(parseTtsConfig({ engine: "openai-compatible", browserVoice: "  ", apiKey: "  " })).toEqual({
      engine: "openai-compatible",
      rate: 1,
    });
    expect(parseTtsConfig(null)).toEqual(DEFAULT_TTS_CONFIG);
    expect(parseTtsConfig([1, 2])).toEqual(DEFAULT_TTS_CONFIG);
    expect(parseTtsConfig('"字符串"')).toEqual(DEFAULT_TTS_CONFIG);
  });

  it("ttsEndpoint 不重复拼 /audio/speech", () => {
    expect(ttsEndpoint("https://api.openai.com/v1/")).toBe("https://api.openai.com/v1/audio/speech");
    expect(ttsEndpoint("https://api.siliconflow.cn/v1/audio/speech")).toBe(
      "https://api.siliconflow.cn/v1/audio/speech",
    );
  });

  it("在线配置缺项逐条列出，浏览器引擎不需要在线字段", () => {
    expect(ttsConfigIssues({ engine: "browser", rate: 1 })).toEqual([]);
    expect(ttsConfigIssues({ engine: "openai-compatible", rate: 1 })).toEqual([
      "API 地址",
      "API Key",
      "模型名",
      "音色",
    ]);
    expect(ttsConfigIssues({ ...REMOTE, baseUrl: "不是地址" })).toContain("API 地址（格式不合法）");
    expect(ttsConfigIssues(REMOTE)).toEqual([]);
  });
});

// ── 文本清洗 ──────────────────────────────────────────────────────

describe("cleanTextForSpeech", () => {
  it("去掉 kcId、教材/讲义、资料与网络引用标记", () => {
    const text =
      "栈是后进先出[stack]。队列先进先出[c02]。" +
      "[教材·《数据结构》·第3章·第45页] [讲义·《讲义.pdf》·上传资料·第3页] [资料1] [网络2]";

    expect(cleanTextForSpeech(text)).toBe("栈是后进先出。队列先进先出。");
    expect(cleanTextForSpeech("见[教材]与[讲义]。")).toBe("见 与。");
  });

  it("支持全角引用标记", () => {
    const text = "结论见【资料3】，另有【网络 4】。";

    const cleaned = cleanTextForSpeech(text);
    expect(cleaned).toBe("结论见，另有。");
    expect(cleaned).not.toContain("资料");
    expect(cleaned).not.toContain("网络");
  });

  it("去掉 Markdown 标题、强调、行内代码、代码块、列表与引用", () => {
    const text = [
      "## 栈",
      "**重点**：`LIFO` 与 [链接](https://example.com/a)",
      "```js",
      "const a = 1;",
      "```",
      "- 第一项",
      "- 第二项",
      "> 引用",
    ].join("\n");

    expect(cleanTextForSpeech(text)).toBe("栈 重点：LIFO 与 链接 第一项 第二项 引用");
  });

  it("图片保留 alt、裸链接不朗读、下划线标识符不被当成强调", () => {
    expect(cleanTextForSpeech("图 ![栈示意图](https://x/y.png) 结束")).toBe("图 栈示意图 结束");
    expect(cleanTextForSpeech("见 https://example.com/a?b=1。后续")).toBe("见。后续");
    expect(cleanTextForSpeech("变量 snake_case_name 保持不变")).toBe("变量 snake_case_name 保持不变");
    expect(cleanTextForSpeech("乘法 2*3*4 不受影响")).toBe("乘法 2*3*4 不受影响");
  });

  it("表格分隔线不朗读，单元格用顿号连接", () => {
    const text = ["| 名称 | 说明 |", "| --- | --- |", "| 栈 | 后进先出 |"].join("\n");

    expect(cleanTextForSpeech(text)).toBe("名称，说明 栈，后进先出");
  });

  it("超过 2000 字按码点截断，并给出 truncated 标记", () => {
    const long = "甲".repeat(SPEECH_MAX_CHARS + 120);

    const prepared = prepareSpeechText(long);
    expect(Array.from(prepared.text)).toHaveLength(SPEECH_MAX_CHARS);
    expect(prepared.truncated).toBe(true);
    expect(Array.from(cleanTextForSpeech(long))).toHaveLength(SPEECH_MAX_CHARS);

    const short = prepareSpeechText("短文本");
    expect(short).toEqual({ text: "短文本", truncated: false });
  });

  it("空白与只有引用标记的文本得到空串，不截断", () => {
    expect(cleanTextForSpeech("   \n\t ")).toBe("");
    expect(cleanTextForSpeech("[stack] [资料1]")).toBe("");
    expect(prepareSpeechText("", 10)).toEqual({ text: "", truncated: false });
  });
});

// ── 浏览器语音 ────────────────────────────────────────────────────

describe("浏览器语音", () => {
  it("listBrowserVoices 在无语音 API 时返回空数组", () => {
    expect(listBrowserVoices()).toEqual([]);
  });

  it("subscribeBrowserVoices 在 voiceschanged 时通知并在取消后解绑", () => {
    const listeners = new Set<() => void>();
    const synth = {
      speaking: false,
      pending: false,
      cancel: vi.fn(),
      getVoices: () => [],
      speak: vi.fn(),
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "voiceschanged") listeners.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === "voiceschanged") listeners.delete(listener);
      }),
    };
    vi.stubGlobal("speechSynthesis", synth);

    const onChange = vi.fn();
    const unsubscribe = subscribeBrowserVoices(onChange);
    for (const listener of listeners) listener();
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });

  it("按 name 选音色并应用夹紧后的语速，只朗读清洗后的正文", async () => {
    const voice = {
      name: "Microsoft Xiaoxiao",
      lang: "zh-CN",
      voiceURI: "ms-xiaoxiao",
      default: false,
      localService: true,
    } as SpeechSynthesisVoice;
    const { utterances } = installSpeech({ voices: [voice] });

    await speakBrowser("你好[stack]。**重点**", {
      engine: "browser",
      rate: 2,
      browserVoice: "Microsoft Xiaoxiao",
    });

    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("你好。重点");
    expect(utterances[0].voice).toBe(voice);
    expect(utterances[0].lang).toBe("zh-CN");
    expect(utterances[0].rate).toBe(RATE_MAX);
  });

  it("找不到指定音色时用默认音色与中文 lang", async () => {
    const { utterances } = installSpeech();

    await speakBrowser("正文", { engine: "browser", rate: 1, browserVoice: "不存在" });

    expect(utterances[0].voice).toBeNull();
    expect(utterances[0].lang).toBe("zh-CN");
  });

  it("stopSpeaking 会 cancel 浏览器朗读并让 Promise 结束", async () => {
    const { synth } = installSpeech({ autoEnd: false });
    const pending = speakBrowser("一段很长的正文", { engine: "browser", rate: 1 });

    expect(isSpeaking()).toBe(true);
    stopSpeaking();
    await pending;

    expect(synth.cancel).toHaveBeenCalled();
    expect(isSpeaking()).toBe(false);
  });

  it("没有 speechSynthesis 时安静结束，不抛错", async () => {
    await expect(speakBrowser("正文", { engine: "browser", rate: 1 })).resolves.toBeUndefined();
  });
});

// ── 在线语音与失败回退 ────────────────────────────────────────────

describe("speakRemote", () => {
  it("成功：POST /audio/speech、blob 播放，结束后 revokeObjectURL", async () => {
    installSpeech();
    const { instances } = installAudio();
    const { create, revoke } = installObjectUrl();
    const fetchMock = vi.fn(async () => AUDIO_RESPONSE());
    vi.stubGlobal("fetch", fetchMock);

    const pending = speakRemote("正文[stack]。", REMOTE);

    await vi.waitFor(() => expect(instances).toHaveLength(1));
    const audio = instances[0];
    expect(audio.src).toBe("blob:tts-test");
    expect(audio.play).toHaveBeenCalled();

    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://api.example.com/v1/audio/speech");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: "tts-1",
      voice: "alloy",
      input: "正文。",
      response_format: "mp3",
      speed: 1,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);

    audio.onended?.();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(revoke).toHaveBeenCalledWith("blob:tts-test");
    expect(audio.pause).toHaveBeenCalled();
  });

  it("CORS 失败：自动回退浏览器语音并返回中文原因", async () => {
    const { utterances } = installSpeech();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await speakRemote("正文", REMOTE);

    expect(result.ok).toBe(false);
    expect(result.fallbackReason).toContain("不允许浏览器直连");
    expect(result.fallbackReason).toContain("已改用浏览器内置语音");
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("正文");
  });

  it("HTTP 401：回退并说明密钥问题", async () => {
    const { utterances } = installSpeech();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 })),
    );

    const result = await speakRemote("正文", REMOTE);

    expect(result.ok).toBe(false);
    expect(result.fallbackReason).toContain("HTTP 401");
    expect(result.fallbackReason).toContain("密钥无效");
    expect(utterances).toHaveLength(1);
  });

  it("200 但返回 JSON 错误：不把 JSON 当音频播放，回退浏览器语音", async () => {
    const { utterances } = installSpeech();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"error":"model not found"}', {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const result = await speakRemote("正文", REMOTE);

    expect(result.ok).toBe(false);
    expect(result.fallbackReason).toContain("不是音频");
    expect(utterances).toHaveLength(1);
  });

  it("播放中出错：回退浏览器语音并返回原因", async () => {
    const { utterances } = installSpeech();
    const { instances } = installAudio();
    installObjectUrl();
    vi.stubGlobal("fetch", vi.fn(async () => AUDIO_RESPONSE()));

    const pending = speakRemote("正文", REMOTE);
    await vi.waitFor(() => expect(instances).toHaveLength(1));

    instances[0].onerror?.();
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.fallbackReason).toContain("播放失败");
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe("正文");
  });

  it("缺少在线配置时不发请求，直接回退并指出缺项", async () => {
    const { utterances } = installSpeech();
    const fetchMock = vi.fn(async () => AUDIO_RESPONSE());
    vi.stubGlobal("fetch", fetchMock);

    const result = await speakRemote("正文", { ...REMOTE, apiKey: "" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.fallbackReason).toContain("API Key");
    expect(utterances).toHaveLength(1);
  });

  it("没有 Audio 时回退浏览器语音，不静默失败", async () => {
    const { utterances } = installSpeech();
    installObjectUrl();
    vi.stubGlobal("fetch", vi.fn(async () => AUDIO_RESPONSE()));
    vi.stubGlobal("Audio", undefined);

    const result = await speakRemote("正文", REMOTE);

    expect(result.ok).toBe(false);
    expect(result.fallbackReason).toContain("不支持音频播放");
    expect(utterances).toHaveLength(1);
  });

  it("stopSpeaking 同时停浏览器与在线播放，在线 Promise 以 ok=false 结束且不再回退", async () => {
    const { synth, utterances } = installSpeech({ autoEnd: false });
    const { instances } = installAudio();
    const { revoke } = installObjectUrl();
    vi.stubGlobal("fetch", vi.fn(async () => AUDIO_RESPONSE()));

    const pending = speakRemote("正文", REMOTE);
    await vi.waitFor(() => expect(instances).toHaveLength(1));
    const audio = instances[0];

    stopSpeaking();
    const result = await pending;

    expect(synth.cancel).toHaveBeenCalled();
    expect(audio.pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:tts-test");
    expect(result).toEqual({ ok: false });
    expect(utterances).toHaveLength(0);
  });

  it("调用方 abort 会停止在线播放，不触发浏览器回退", async () => {
    const { utterances } = installSpeech();
    const { instances } = installAudio();
    const { revoke } = installObjectUrl();
    vi.stubGlobal("fetch", vi.fn(async () => AUDIO_RESPONSE()));

    const controller = new AbortController();
    const pending = speakRemote("正文", REMOTE, controller.signal);
    await vi.waitFor(() => expect(instances).toHaveLength(1));

    controller.abort();
    const result = await pending;

    expect(result).toEqual({ ok: false });
    expect(instances[0].pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:tts-test");
    expect(utterances).toHaveLength(0);
  });

  it("传入已 abort 的 signal 时直接结束，不发请求", async () => {
    const { utterances } = installSpeech();
    const fetchMock = vi.fn(async () => AUDIO_RESPONSE());
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const result = await speakRemote("正文", REMOTE, controller.signal);

    expect(result).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(utterances).toHaveLength(0);
  });

  it("浏览器引擎直接朗读，不发在线请求", async () => {
    const { utterances } = installSpeech();
    const fetchMock = vi.fn(async () => AUDIO_RESPONSE());
    vi.stubGlobal("fetch", fetchMock);

    const result = await speakRemote("正文", { engine: "browser", rate: 1 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
    expect(utterances[0].text).toBe("正文");
  });

  it("清洗后为空时不发请求也不朗读", async () => {
    const { utterances } = installSpeech();
    const fetchMock = vi.fn(async () => AUDIO_RESPONSE());
    vi.stubGlobal("fetch", fetchMock);

    const result = await speakRemote(" [stack] [资料1] ", REMOTE);

    expect(result).toEqual({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(utterances).toHaveLength(0);
  });
});
