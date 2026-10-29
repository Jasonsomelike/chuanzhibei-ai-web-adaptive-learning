"use client";

/**
 * 设置页的「思考强度」与「依据核对」区块。
 *
 * 组件只负责展示与回传选择，探测请求由设置页发起（probeThinking 在 chat.ts）：
 * 探测必须用页面当前的草稿配置，而不是已保存的配置，否则用户改完地址后
 * 测到的仍是旧端点。
 *
 * 布局：两个语义分开的 SettingsGroup（细线分隔），不再套一张大卡片。
 */

import { Collapse, Pill, SettingsGroup } from "@/components/ui";
import type { ThinkingProbeResult } from "@/lib/chat";
import type { ThinkingStatus } from "@/lib/provider";
import type { ThinkingStrength } from "@/lib/reasoning";

export type ProbeState =
  | { readonly status: "idle" }
  | { readonly status: "running" }
  | { readonly status: "done"; readonly result: ThinkingProbeResult };

export interface ThinkingSettingsProps {
  readonly thinking: ThinkingStrength;
  readonly thinkingStatus: ThinkingStatus;
  readonly verification: boolean;
  /** 地址、密钥、模型名是否填齐；没填齐就既不能探测，也不能开核对。 */
  readonly providerReady: boolean;
  readonly probe: ProbeState;
  readonly onThinkingChange: (next: ThinkingStrength) => void;
  readonly onVerificationChange: (next: boolean) => void;
  readonly onProbe: () => void;
}

const STATUS_LABEL: Record<ThinkingStatus, string> = {
  unknown: "未探测",
  verified: "已确认：端点接受思考参数",
  "verified-empty": "已确认：端点未返回思考内容",
  unsupported: "不支持：端点拒绝了思考参数",
};

const STATUS_TONE: Record<ThinkingStatus, "neutral" | "good" | "warn" | "bad"> = {
  unknown: "neutral",
  verified: "good",
  "verified-empty": "warn",
  unsupported: "bad",
};

const LEVELS: ReadonlyArray<{
  id: ThinkingStrength;
  label: string;
  request: string;
  cost: string;
}> = [
  {
    id: "off",
    label: "关",
    request: "不发送 reasoning_effort / thinking 字段",
    cost: "不额外占用 token 预算",
  },
  {
    id: "standard",
    label: "标准",
    request: "reasoning_effort=medium；Anthropic 为 thinking.budget_tokens=4096",
    cost: "max_tokens 抬到 ≥8192，费用会明显增加",
  },
  {
    id: "deep",
    label: "深入",
    request: "reasoning_effort=high；Anthropic 为 thinking.budget_tokens=16384",
    cost: "max_tokens 抬到 ≥20480，费用最高",
  },
];

export function ThinkingSettings({
  thinking,
  thinkingStatus,
  verification,
  providerReady,
  probe,
  onThinkingChange,
  onVerificationChange,
  onProbe,
}: ThinkingSettingsProps) {
  const unsupported = thinkingStatus === "unsupported";
  const probeDisabled = !providerReady || thinking === "off" || probe.status === "running";

  return (
    <div className="space-y-6">
      <SettingsGroup
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            思考强度
            <Pill tone={STATUS_TONE[thinkingStatus]}>{STATUS_LABEL[thinkingStatus]}</Pill>
          </span>
        }
        hint="档位是「请求意图」，实际强度由供应商决定；只影响导师回答，出题与批解始终非思考。"
      >
        <div className="grid gap-2 sm:grid-cols-3">
          {LEVELS.map((level) => {
            const disabled = unsupported && level.id !== "off";
            const active = thinking === level.id;
            return (
              <button
                key={level.id}
                type="button"
                onClick={() => onThinkingChange(level.id)}
                aria-pressed={active}
                disabled={disabled}
                className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--line-strong)] hover:bg-[var(--line)]"
                }`}
              >
                <span className="block font-medium">{level.label}</span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--ink-faint)]">
                  {level.request}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--ink-soft)]">
                  {level.cost}
                </span>
              </button>
            );
          })}
        </div>

        {unsupported ? (
          <div className="mt-3 max-w-[68ch] rounded-lg border-l-2 border-[var(--bad)] bg-[var(--bad-soft)] px-3 py-2.5 text-sm">
            <p className="font-medium text-[var(--bad)]">该端点不支持思考参数</p>
            <p className="mt-1 text-[var(--ink-soft)]">
              端点对带思考字段的请求返回了 HTTP 400，标准与深入两档已置灰。导师回答会按普通模式工作；
              想继续用思考，请换一个支持该参数的端点或模型，或先点「测试思考参数」重新确认。
              选择「关」可以随时关闭思考。
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onProbe}
            disabled={probeDisabled}
            className="rounded-lg border border-[var(--line-strong)] px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
          >
            {probe.status === "running" ? "探测中…" : "测试思考参数"}
          </button>
          <span className="max-w-[52ch] text-xs leading-relaxed text-[var(--ink-faint)]">
            {!providerReady
              ? "填齐地址、密钥、模型名后才能探测"
              : thinking === "off"
                ? "当前是「关」档，不会发送思考字段，无需探测"
                : "会真实发出一次带思考参数的请求并计费"}
          </span>
        </div>

        {probe.status === "done" ? (
          <div
            className={`mt-3 max-w-[68ch] rounded-lg border p-3 text-sm ${
              probe.result.ok
                ? "border-[var(--good)] bg-[var(--good-soft)]"
                : "border-[var(--warn)] bg-[var(--warn-soft)]"
            }`}
          >
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {probe.result.detail}
              <span className="text-xs font-normal text-[var(--ink-faint)]">
                探测档位：
                {LEVELS.find((level) => level.id === probe.result.strength)?.label ??
                  probe.result.strength}
              </span>
            </p>
            {probe.result.reasoning.trim() !== "" ? (
              <Collapse title="查看模型返回的思考内容（节选）" className="mt-1">
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--ink-soft)]">
                  {probe.result.reasoning.slice(0, 400)}
                </p>
              </Collapse>
            ) : null}
          </div>
        ) : null}

        <ul className="mt-3 max-w-[68ch] space-y-1 text-xs leading-relaxed text-[var(--ink-faint)]">
          <li>· 档位是「请求意图」，实际强度由供应商决定，部分供应商会把 medium 映射成 high。</li>
          <li>· 思考强度只作用于导师回答；出题、批解、方向生成始终走非思考，避免 JSON 被思考 token 吃光。</li>
          <li>· 思考内容与正文分开显示，思考过程可能不忠实，判分与引用以正文和出处为准。</li>
        </ul>
      </SettingsGroup>

      <SettingsGroup
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            依据核对
            <Pill tone={verification ? "good" : "neutral"}>{verification ? "开" : "关"}</Pill>
          </span>
        }
        hint="对带 [kcId] 的引用做一次只读核对，只打标记，不改写回答。"
      >
        <p className="max-w-[68ch] text-xs leading-relaxed text-[var(--ink-soft)]">
          开启后，导师回答里每条带 [kcId] 的引用会额外做一次只读核对（每次回答最多一条请求，约 600 token）。
          核对只给引用打「已核对 / 未找到依据 / 与原文冲突」的标记，不会改写回答；核对失败只显示「核对未完成」。
          没有教材 / 上传资料可核对时不会发起请求。
        </p>
        <button
          type="button"
          onClick={() => onVerificationChange(!verification)}
          disabled={!providerReady}
          aria-pressed={verification}
          className={`mt-2 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
            verification
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--line-strong)] text-[var(--ink-soft)] hover:bg-[var(--line)]"
          }`}
        >
          {verification ? "关闭依据核对" : "开启依据核对"}
        </button>
        {!providerReady ? (
          <p className="mt-1 text-xs text-[var(--ink-faint)]">需要先配置模型（地址、密钥、模型名）。</p>
        ) : null}
      </SettingsGroup>

      <p className="max-w-[68ch] text-xs leading-relaxed text-[var(--ink-faint)]">
        思考强度与依据核对属于供应商配置，随「模型供应商」分区的「保存配置」一起写入本浏览器。
      </p>
    </div>
  );
}
