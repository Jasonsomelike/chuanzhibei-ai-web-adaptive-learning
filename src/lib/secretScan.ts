/**
 * 密钥扫描的规则与行级匹配。
 *
 * 为什么单独成模块：`scripts/check-secrets.ts` 负责遍历目录、打印与退出码，
 * 匹配逻辑必须能被单测直接调用——否则「page.fill 的口令会不会被扫到」
 * 只能靠手工往仓库里放一个假文件来验证，而这种验证没人会每次提交前重跑。
 *
 * 规则刻意写得宽一些：宁可误报，也不要漏报。放行项只有示例文件里的空值、
 * 文档占位符与测试里明显不可能是真凭据的短值。
 */

export interface SecretPattern {
  readonly name: string;
  readonly re: RegExp;
}

/**
 * 疑似密钥的模式。每条都在单行内匹配：跨行匹配会让报错行号失去意义。
 * 注意：这里的正则本身也会被 check:secrets 扫描，新增规则后要确认它不自匹配。
 */
export const PATTERNS: readonly SecretPattern[] = [
  { name: "OpenAI 风格 key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "AWS Access Key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { name: "私钥块", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Bearer 长串", re: /Bearer\s+[A-Za-z0-9._-]{40,}/ },
  {
    name: "赋了值的密钥变量",
    re: /(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/,
  },
  {
    /*
     * Playwright 脚本里的 `page.fill('input[type=password]', '...')`：
     * 第二个参数是字面量时，口令就明文写死在源码里。
     *
     * 单独一条规则、而不是把通用阈值从 16 降到 6：15 位口令正好落在
     * 「赋了值的密钥变量」的缝里（该规则要求 ≥16 位），而降低通用阈值会让
     * fake-key-5678 这类测试占位符（13 位）开始报错。这里只匹配 selector
     * 里带 pass/pwd 的 fill，普通输入框的字面量不报。
     */
    name: "page.fill 明文口令",
    re: /page\.fill\([^\n]{0,160}?(?:pass(?:word|wd)?|pwd)[^\n]{0,80}?,\s*["'`][^"'`\n]{6,}["'`]/i,
  },
];

/** 允许出现的例外：示例文件里的空值、文档里的占位符。 */
export const ALLOWLIST: readonly RegExp[] = [
  /\.env\.example$/,
  /\.env\.local$/,
  /PLACEHOLDER/,
  /<REDACTED>/,
  /your[_-]?api[_-]?key/i,
  /xxx+/i,
];

/** 单行超过这个长度就不扫：压缩产物/生成文件里的长行只会制造噪声。 */
const MAX_LINE_LENGTH = 500;

export interface SecretHit {
  /** 1 起始的行号。 */
  readonly line: number;
  readonly pattern: string;
  /** 只留前 40 字符，避免把疑似密钥本身打印出来。 */
  readonly preview: string;
}

/**
 * 扫描一段文本，返回全部命中。
 *
 * 行级放行与整文件放行分开：文件路径的放行在调用方（脚本）里做，
 * 这里的 allowlist 只作用于行内容。
 */
export function scanText(
  text: string,
  allowlist: readonly RegExp[] = ALLOWLIST,
): SecretHit[] {
  const hits: SecretHit[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > MAX_LINE_LENGTH) continue;
    if (allowlist.some((re) => re.test(line))) continue;

    for (const p of PATTERNS) {
      if (p.re.test(line)) {
        hits.push({
          line: i + 1,
          pattern: p.name,
          preview: line.trim().slice(0, 40),
        });
        break;
      }
    }
  }
  return hits;
}
