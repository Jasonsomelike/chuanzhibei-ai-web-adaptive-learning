import { Fragment, type ReactNode } from "react";

import { tokenizeMiniMarkdown } from "@/components/mini-markdown-tokenizer";

/**
 * 最小 Markdown 渲染层：只把 token 映射成 React 节点。
 *
 * 正文一律作为 React 文本子节点输出，由 React 负责转义；
 * 不提供任何原始 HTML 注入入口（没有 innerHTML 这一类属性）。
 * 因此模型输出里的 <script> 只会显示成字面文字。
 *
 * 返回的是行内节点而不是块级容器：字号与段落交给调用方，
 * 流式光标（trailing）才能接在正文最后一段的末尾。
 */
export function MiniMarkdown({
  text,
  trailing,
}: {
  readonly text: string;
  /** 追加在正文末尾、参与同一段排版的节点（例如流式光标）。 */
  readonly trailing?: ReactNode;
}) {
  const tokens = tokenizeMiniMarkdown(text);

  return (
    <>
      {tokens.map((token, index) => {
        switch (token.kind) {
          case "text":
            // 普通文本原样交给 React；尖括号会被转义，不可能变成标签
            return <Fragment key={index}>{token.value}</Fragment>;
          case "strong":
            return (
              <strong key={index} className="font-semibold">
                {token.value}
              </strong>
            );
          case "code":
            return (
              <code
                key={index}
                className="rounded bg-[var(--line)] px-1 py-0.5 wrap-anywhere font-mono text-[0.92em]"
              >
                {token.value}
              </code>
            );
          case "pill":
            /*
             * 与引用区的 Pill 同一条跳转：/path?kc=<id> 由路径页滚动并高亮。
             * 用普通 <a>：组件不依赖路由，静态渲染（测试）也能拿到 href。
             */
            return (
              <a
                key={index}
                href={`/path?kc=${encodeURIComponent(token.kcId)}`}
                title={`在路径中定位知识点 ${token.kcId}`}
                className="inline-flex items-center rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[0.85em] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
              >
                [{token.kcId}]
              </a>
            );
          case "break":
            return <br key={index} />;
        }
      })}
      {trailing}
    </>
  );
}
