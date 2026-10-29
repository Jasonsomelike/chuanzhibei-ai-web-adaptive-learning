import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MiniMarkdown } from "@/components/mini-markdown";
import { tokenizeMiniMarkdown } from "@/components/mini-markdown-tokenizer";

const ALLOWED_KINDS = new Set(["text", "strong", "code", "pill", "break"]);

describe("tokenizeMiniMarkdown", () => {
  it("把 **x** 切成 strong，前后文本保持原样", () => {
    expect(tokenizeMiniMarkdown("**渐进分析方法**")).toEqual([
      { kind: "strong", value: "渐进分析方法" },
    ]);
    expect(tokenizeMiniMarkdown("见 **栈** 的定义")).toEqual([
      { kind: "text", value: "见 " },
      { kind: "strong", value: "栈" },
      { kind: "text", value: " 的定义" },
    ]);
  });

  it("把 [c04] 切成 pill；其他方括号不是 pill", () => {
    expect(tokenizeMiniMarkdown("渐进方法 [c04]")).toEqual([
      { kind: "text", value: "渐进方法 " },
      { kind: "pill", kcId: "c04" },
    ]);
    // 上传 / 网络引用不是知识点 id，不能被当成可点 pill
    expect(tokenizeMiniMarkdown("[资料1] 与 [网络2] 都不是知识点")).toEqual([
      { kind: "text", value: "[资料1] 与 [网络2] 都不是知识点" },
    ]);
    expect(tokenizeMiniMarkdown("[1]")).toEqual([{ kind: "text", value: "[1]" }]);
    // id 大小写归一，路径页按小写 id 比对
    expect(tokenizeMiniMarkdown("[C04]")).toEqual([{ kind: "pill", kcId: "c04" }]);
  });

  it("单换行切成 break", () => {
    expect(tokenizeMiniMarkdown("第一行\n第二行")).toEqual([
      { kind: "text", value: "第一行" },
      { kind: "break" },
      { kind: "text", value: "第二行" },
    ]);
    expect(tokenizeMiniMarkdown("a\n\nb")).toEqual([
      { kind: "text", value: "a" },
      { kind: "break" },
      { kind: "break" },
      { kind: "text", value: "b" },
    ]);
  });

  it("无模型兜底拼装的一行：粗体 + 引用 pill", () => {
    expect(tokenizeMiniMarkdown("**渐进分析方法** [c04]\n出处：教材")).toEqual([
      { kind: "strong", value: "渐进分析方法" },
      { kind: "text", value: " " },
      { kind: "pill", kcId: "c04" },
      { kind: "break" },
      { kind: "text", value: "出处：教材" },
    ]);
  });

  it("行内 code 独立成 token，code 里的 ** 不再解析", () => {
    expect(tokenizeMiniMarkdown("复杂度 `O(log n)` 与 `**x**`")).toEqual([
      { kind: "text", value: "复杂度 " },
      { kind: "code", value: "O(log n)" },
      { kind: "text", value: " 与 " },
      { kind: "code", value: "**x**" },
    ]);
  });

  it("未闭合的 ** 与 ` 原样保留，不会被吃掉", () => {
    expect(tokenizeMiniMarkdown("**没闭合")).toEqual([{ kind: "text", value: "**没闭合" }]);
    expect(tokenizeMiniMarkdown("`没闭合")).toEqual([{ kind: "text", value: "`没闭合" }]);
    expect(tokenizeMiniMarkdown("****")).toEqual([{ kind: "text", value: "****" }]);
  });

  it("<script>alert(1)</script> 整段只是一个 text token，token 里没有 HTML 种类", () => {
    const input = "<script>alert(1)</script>";
    const tokens = tokenizeMiniMarkdown(input);
    expect(tokens).toEqual([{ kind: "text", value: input }]);
    expect(tokens.every((token) => ALLOWED_KINDS.has(token.kind))).toBe(true);
    // 没有任何 token 携带标签结构（渲染层只能拿到纯文本）
    expect(tokens.some((token) => "value" in token && token.value.includes("<script"))).toBe(true);
    expect(tokens.some((token) => token.kind === "strong" || token.kind === "pill")).toBe(false);
  });
});

describe("MiniMarkdown 渲染", () => {
  it("组件源码不使用 dangerouslySetInnerHTML", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/mini-markdown.tsx"), "utf8");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  it("把 <script> 转义成文本，而不是生成 script 元素", () => {
    const html = renderToStaticMarkup(MiniMarkdown({ text: "<script>alert(1)</script>" }));
    expect(html).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("粗体、行内 code、pill 与换行都渲染成对应节点，pill 指向路径页", () => {
    const html = renderToStaticMarkup(
      MiniMarkdown({ text: "**栈** [c09]\n`LIFO`" }),
    );
    expect(html).toMatch(/<strong[^>]*>栈<\/strong>/);
    expect(html).toMatch(/<code[^>]*>LIFO<\/code>/);
    expect(html).toContain('<a href="/path?kc=c09"');
    expect(html).toContain("[c09]</a>");
    expect(html).toContain("<br/>");
  });

  it("trailing（流式光标）接在正文末尾", () => {
    const html = renderToStaticMarkup(MiniMarkdown({ text: "**栈**", trailing: "▍" }));
    expect(html).toMatch(/^<strong[^>]*>栈<\/strong>▍$/);
  });
});
