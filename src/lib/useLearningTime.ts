"use client";
import { useEffect, useMemo, useState } from "react";
import type { KnowledgeGraph } from "./graph";
import type { SubjectProgress } from "./learner";
import { useAuth } from "./useAuth";
import {
  loadProvider,
  hydrateProviderFromServer,
  type ProviderConfig,
} from "./provider";
import { loadCallMode } from "./serverConfig";
import { callChat } from "./chat";
import { contextBudget } from "./contextBudget";
import {
  ruleTimeEstimates,
  timeFingerprint,
  timeBatches,
  parseTimeJson,
  validateTimeEstimates,
  type LearningTimeResult,
} from "./learningTime";

const requests = new Map<string, Promise<LearningTimeResult>>();
async function localEstimate(
  provider: ProviderConfig,
  graph: KnowledgeGraph,
  progress: SubjectProgress,
  fingerprint: string,
): Promise<LearningTimeResult> {
  const estimates = [];
  const capacity = contextBudget({ ...provider, thinking: "off" });
  const signal = AbortSignal.timeout(120_000);
  const batches = timeBatches(
    graph,
    progress.mastery,
    { recentAttempts: progress.attempts.filter((a) => !a.retired).slice(-30) },
    provider,
  );
  for (const batch of batches) {
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      const answer = await callChat(provider, {
        user:
          batch.prompt +
          (attempt ? "\n请修复格式、知识点覆盖和区间范围。" : ""),
        maxTokens: Math.min(12000, capacity.response),
        jsonMode: true,
        timeoutMs: 60000,
        signal,
      });
      try {
        result = validateTimeEstimates(parseTimeJson(answer.text), batch.graph);
      } catch {
        if (attempt) throw new Error("模型估算未通过结构校验。");
      }
    }
    estimates.push(...result!);
  }
  return {
    version: "learning-time-v1",
    fingerprint,
    source: "llm",
    model: provider.model,
    estimates,
    stages: [],
  };
}

export function useLearningTime(
  targetId: string,
  graph: KnowledgeGraph | undefined,
  progress: SubjectProgress | null | undefined,
) {
  const { user, loading: authLoading } = useAuth();
  const [loaded, setLoaded] = useState<{
    key: string;
    result: LearningTimeResult;
  } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const fingerprint = useMemo(
    () => (graph && progress ? timeFingerprint(graph, progress.mastery) : ""),
    [graph, progress],
  );
  const key = `${user?.id ?? "anonymous"}:${targetId}:${fingerprint}:${refresh}`;
  useEffect(() => {
    if (authLoading || !graph || !progress) return;
    let active = true;
    const controller = new AbortController();
    // Fast cached results do not flash a loading label.
    const loadingTimer = window.setTimeout(() => {
      if (active) setLoadingKey(key);
    }, 150);
    const work = async () => {
      let provider = loadProvider();
      if (user && loadCallMode() === "server")
        provider =
          (await hydrateProviderFromServer(controller.signal)) ?? provider;
      if (
        !active ||
        !provider ||
        (provider.mode === "server" && (!user || !provider.serverConfigured)) ||
        (provider.mode !== "server" && !provider.apiKey)
      )
        return null;
      const requestKey = `${key}:${provider.mode}:${provider.baseUrl}:${provider.model}`;
      let request = requests.get(requestKey);
      if (!request) {
        const configured = provider;
        request = (async () => {
          if (configured.mode !== "server")
            return localEstimate(configured, graph, progress, fingerprint);
          const response = await fetch("/api/learning/time-estimates", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ targetId }),
            signal: AbortSignal.timeout(150_000),
          });
          if (!response.ok) throw new Error("模型估算暂时不可用。");
          const data = (await response.json()) as LearningTimeResult;
          const estimates = validateTimeEstimates(
            { estimates: data.estimates },
            graph,
          );
          if (data.source !== "llm" && data.source !== "rules")
            throw new Error("估算来源不正确。");
          return { ...data, estimates };
        })();
        requests.set(requestKey, request);
        if (requests.size > 30) requests.delete(requests.keys().next().value!);
      }
      return request;
    };
    void work()
      .then(
        (result) => {
          if (active && result) setLoaded({ key, result });
        },
        () => {
          if (active)
            setLoaded({
              key,
              result: {
                version: "learning-time-v1",
                fingerprint,
                source: "rules",
                estimates: ruleTimeEstimates(graph, progress.mastery),
                notice: "模型估算暂时不可用，使用规则初估。",
                stages: [],
              },
            });
        },
      )
      .finally(() => {
        clearTimeout(loadingTimer);
        if (active) setLoadingKey(null);
      });
    return () => {
      active = false;
      clearTimeout(loadingTimer);
      controller.abort();
    };
  }, [key, targetId, graph, progress, authLoading, user, fingerprint]);
  const result = loaded?.key === key ? loaded.result : null;
  const fallback = useMemo(
    () => (graph && progress ? ruleTimeEstimates(graph, progress.mastery) : []),
    [graph, progress],
  );
  return {
    estimates: result?.estimates ?? fallback,
    names: graph?.concepts,
    source: result?.source ?? "rules",
    pending: loadingKey === key,
    notice: result?.notice,
    model: result?.model,
    refresh: () => setRefresh((n) => n + 1),
  };
}
