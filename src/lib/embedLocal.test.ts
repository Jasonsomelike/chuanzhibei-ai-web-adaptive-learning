import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BGE_QUERY_INSTRUCTION,
  LOCAL_EMBED_DIM,
  __resetEmbedLocalForTests,
  embedLocal,
  embedLocalQuery,
  type EmbedWorkerLike,
} from "@/lib/embedLocal";

interface FakeWorker extends EmbedWorkerLike {
  readonly messages: { id: number; texts: string[] }[];
  terminated: boolean;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

function makeWorker(): FakeWorker {
  const worker: FakeWorker = {
    messages: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message: unknown) {
      worker.messages.push(message as { id: number; texts: string[] });
    },
    terminate() {
      worker.terminated = true;
    },
  };
  return worker;
}

function vec(fill: number): number[] {
  return Array.from({ length: LOCAL_EMBED_DIM }, (_, index) => fill + index / 100_000);
}

function answer(worker: FakeWorker, index: number, data: Record<string, unknown>): void {
  const message = worker.messages[index];
  worker.onmessage?.({ data: { id: message.id, ...data } });
}

afterEach(() => {
  __resetEmbedLocalForTests();
  vi.unstubAllGlobals();
});

describe("embedLocal 降级", () => {
  it("没有 Worker 时返回 vectors:null + reason=unsupported，不抛异常", async () => {
    vi.stubGlobal("Worker", undefined);
    const result = await embedLocal(["栈", "队列"]);
    expect(result.ok).toBe(false);
    expect(result.vectors).toBeNull();
    if (result.ok) return;
    expect(result.reason).toBe("unsupported");
    expect(result.message).toContain("BM25");
  });

  it("空输入直接成功，不需要 Worker", async () => {
    const worker = makeWorker();
    const result = await embedLocal([], undefined, { workerFactory: () => worker });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toEqual([]);
    expect(worker.messages).toHaveLength(0);
  });

  it("已取消的 signal 直接返回 aborted，不发消息", async () => {
    const worker = makeWorker();
    const controller = new AbortController();
    controller.abort();
    const result = await embedLocal(["栈"], controller.signal, { workerFactory: () => worker });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("aborted");
    expect(worker.messages).toHaveLength(0);
  });
});

describe("embedLocal 文档侧 / 查询侧", () => {
  it("文档侧不加 BGE 中文指令；返回 512 维向量", async () => {
    const worker = makeWorker();
    const promise = embedLocal(["栈是后进先出的线性表。"], undefined, {
      workerFactory: () => worker,
    });
    expect(worker.messages[0].texts).toEqual(["栈是后进先出的线性表。"]);

    answer(worker, 0, { ok: true, vectors: [vec(0.5)] });
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vectors).toHaveLength(1);
    expect(result.vectors[0]).toHaveLength(LOCAL_EMBED_DIM);
  });

  it("查询侧逐条加 BGE 中文指令", async () => {
    const worker = makeWorker();
    const promise = embedLocalQuery("栈和队列的区别", undefined, {
      workerFactory: () => worker,
    });
    expect(worker.messages[0].texts).toEqual([`${BGE_QUERY_INSTRUCTION}栈和队列的区别`]);

    answer(worker, 0, { ok: true, vectors: [vec(0.1)] });
    expect((await promise).ok).toBe(true);
  });

  it("输出维度不对/含非有限值时返回 invalid-output，不把坏向量交给调用方", async () => {
    const worker = makeWorker();
    const promise = embedLocal(["栈"], undefined, { workerFactory: () => worker });

    const bad = vec(0.1);
    bad[0] = Number.NaN;
    answer(worker, 0, { ok: true, vectors: [bad] });

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.vectors).toBeNull();
    if (result.ok) return;
    expect(result.reason).toBe("invalid-output");
  });

  it("Worker 报模型缺失时原样带回原因", async () => {
    const worker = makeWorker();
    const promise = embedLocal(["栈"], undefined, { workerFactory: () => worker });
    answer(worker, 0, {
      ok: false,
      reason: "model-missing",
      message: "本地模型或推理库加载失败：404",
    });

    const result = await promise;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("model-missing");
    expect(result.message).toContain("404");
  });
});

describe("embedLocal 超时", () => {
  it("超时返回 timeout 并终止 Worker", async () => {
    const worker = makeWorker();
    const result = await embedLocal(["栈"], undefined, {
      workerFactory: () => worker,
      timeoutMs: 5,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
    expect(worker.terminated).toBe(true);
  });
});
