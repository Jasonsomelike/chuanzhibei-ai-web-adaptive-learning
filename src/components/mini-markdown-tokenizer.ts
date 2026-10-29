/**
 * 最小 Markdown 的词法层。
 *
 * 只认四种在无模型兜底回答里实际会出现的标记：
 *   **粗体**、`行内代码`、[kcId] 引用 pill、换行。
 *
 * 刻意不做 HTML：尖括号一律当普通字符，渲染层交给 React 转义，
 * 组件里也不使用 dangerouslySetInnerHTML。因此这里没有任何「HTML token」，
 * 模型输出 <script> 时只会得到一段文本。
 *
 * 识别规则故意保守：
 *   - 未闭合的 ** 与 ` 原样保留，不会被悄悄吃掉；
 *   - [资料1] / [网络2] / [1] 都不是 pill，只有形如 [c04] 的知识点 id 才是；
 *   - 粗体与行内代码不跨行——跨行多半是模型漏了闭合，
 *     按字面量展示比把后面整段吞进 <strong> 安全。
 *
 * 边界：纯函数，不碰 React / DOM；同样输入必须得到同样输出。
 */

export type MiniMarkdownToken =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "strong"; readonly value: string }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "pill"; readonly kcId: string }
  | { readonly kind: "break" };

/**
 * 知识点 id 的形状，与 tutor-logic 抽取引用用的 `[a-z][a-z0-9_]{0,15}` 一致。
 * 前面锚定 `[`，配合 `input.slice(i)` 使用。
 */
const PILL_PATTERN = /^\[([A-Za-z][A-Za-z0-9_]{0,15})\]/;

/** 在 [from, end) 之间找闭合标记；跨行视为没找到。 */
function closeBeforeNewline(input: string, marker: string, from: number): number {
  const close = input.indexOf(marker, from);
  if (close === -1) return -1;
  return input.slice(from, close).includes("\n") ? -1 : close;
}

/**
 * 把一段回答切成 token。
 *
 * 相邻的普通字符会合并成一个 text token：`<script>alert(1)</script>`
 * 因此是「一段文本」，而不是被拆开的多段。
 */
export function tokenizeMiniMarkdown(input: string): MiniMarkdownToken[] {
  const tokens: MiniMarkdownToken[] = [];
  let buffer = "";

  const flushText = (): void => {
    if (buffer === "") return;
    tokens.push({ kind: "text", value: buffer });
    buffer = "";
  };

  let i = 0;
  while (i < input.length) {
    const char = input[i];

    if (char === "\n") {
      flushText();
      tokens.push({ kind: "break" });
      i += 1;
      continue;
    }

    if (char === "*" && input[i + 1] === "*") {
      const close = closeBeforeNewline(input, "**", i + 2);
      // close === i + 2 是 `****`，空内容按字面量保留
      if (close > i + 2) {
        flushText();
        tokens.push({ kind: "strong", value: input.slice(i + 2, close) });
        i = close + 2;
        continue;
      }
      buffer += "**";
      i += 2;
      continue;
    }

    if (char === "`") {
      const close = closeBeforeNewline(input, "`", i + 1);
      // close === i + 1 是空代码 ``，同样按字面量保留
      if (close > i + 1) {
        flushText();
        tokens.push({ kind: "code", value: input.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
      buffer += "`";
      i += 1;
      continue;
    }

    if (char === "[") {
      const match = PILL_PATTERN.exec(input.slice(i));
      if (match !== null && match[1] !== undefined) {
        flushText();
        tokens.push({ kind: "pill", kcId: match[1].toLowerCase() });
        i += match[0].length;
        continue;
      }
      buffer += char;
      i += 1;
      continue;
    }

    buffer += char;
    i += 1;
  }

  flushText();
  return tokens;
}
