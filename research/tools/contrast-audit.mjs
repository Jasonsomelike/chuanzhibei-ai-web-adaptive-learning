#!/usr/bin/env node
/**
 * 主题对比度审计 + 色值求解工具
 *
 * WCAG 2.2 相对亮度公式：
 *   对每个通道 c（0..1）：c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4
 *   L = 0.2126R + 0.7152G + 0.0722B
 *   ratio = (Lhi + 0.05) / (Llo + 0.05)
 * 来源：https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 * 阈值不四舍五入（4.499 不算 4.5）。
 *
 * 用法：
 *   node research/tools/contrast-audit.mjs             # 汇总
 *   node research/tools/contrast-audit.mjs --markdown  # Markdown 全表
 *   node research/tools/contrast-audit.mjs --json      # JSON
 *   node research/tools/contrast-audit.mjs --solve     # 求解辅助色
 */

// ============ WCAG 数学 ============
export function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function hexToRgb(hex) {
  const h = String(hex).trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`bad hex: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export const round2 = (n) => Math.round(n * 100) / 100;
export const fmt = (n) => round2(n).toFixed(2);

// ============ OKLCH -> sRGB（用于按感知亮度调色） ============
function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export function oklchToHex(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const [lr, lg, lb] = oklabToLinearSrgb(L, C * Math.cos(h), C * Math.sin(h));
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return rgbToHex([linearToSrgb(clamp(lr)) * 255, linearToSrgb(clamp(lg)) * 255, linearToSrgb(clamp(lb)) * 255]);
}

export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => srgbToLinear(v));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

/**
 * 固定色相/彩度，二分搜索满足 target 对比度的 L。
 * dir='darker' 表示相对 bg 更暗，'lighter' 表示更亮。
 * 返回 { hex, ratio }，找不到返回 null。
 */
export function solveForContrast(bgHex, target, { H, C, dir = 'darker', Lstart = 0.5 } = {}) {
  const bgLum = relativeLuminance(bgHex);
  let lo = 0.0, hi = 1.0;
  const ratioAt = (L) => {
    const hx = oklchToHex(L, C, H);
    const l1 = relativeLuminance(hx);
    const [a, b] = l1 >= bgLum ? [l1, bgLum] : [bgLum, l1];
    return { r: (a + 0.05) / (b + 0.05), hx };
  };
  // 单调性检查：在 dir 方向上对比度随 L 单调变化
  const [a, b] = dir === 'darker' ? [0, Lstart] : [Lstart, 1];
  let x0 = a, x1 = b;
  const r0 = ratioAt(x0).r, r1 = ratioAt(x1).r;
  const increasing = r1 > r0;
  if ((increasing && r1 < target) || (!increasing && r0 < target)) {
    // 该方向上到不了目标，退到端点最大者
    const best = ratioAt(x1);
    return { hex: best.hx, ratio: best.r, reached: false };
  }
  for (let i = 0; i < 60; i++) {
    const mid = (x0 + x1) / 2;
    const { r } = ratioAt(mid);
    const ok = increasing ? r >= target : r >= target;
    // 找「刚好达标」的边界：朝 bg 方向逼近
    if (increasing) {
      if (r >= target) x1 = mid; else x0 = mid;
    } else {
      if (r >= target) x0 = mid; else x1 = mid;
    }
  }
  const L = increasing ? x1 : x0;
  const out = ratioAt(L);
  return { hex: out.hx, ratio: out.r, reached: out.r >= target };
}

// ============ 主题定义 ============
// 12 个 token：10 个必需 + on-accent（填充块上的文字）+ line-strong（控件边界）
export const THEMES = {
  sand: {
    name: '暖砂',
    tagline: '沉稳阅读：暖纸底 + 陶土橙，像纸质书，长时间看不发冷',
    light: {
      canvas: '#faf6ef',
      surface: '#fffcf7',
      ink: '#1f1a14',
      'ink-soft': '#544a3d',
      'ink-faint': '#736656',
      line: '#e6ddcf',
      'line-strong': '#8d8172',
      accent: '#9a4410',
      'accent-soft': '#f6e3cd',
      'on-accent': '#ffffff',
      good: '#1a6236',
      warn: '#7d5105',
      bad: '#99251b',
    },
    dark: {
      canvas: '#17140f',
      surface: '#211d17',
      ink: '#f3ecdf',
      'ink-soft': '#cdc2b1',
      'ink-faint': '#a2957f',
      line: '#37312a',
      'line-strong': '#7d7365',
      accent: '#eaa76a',
      'accent-soft': '#3a2919',
      'on-accent': '#2a1a08',
      good: '#7dd39d',
      warn: '#e6c273',
      bad: '#f39b90',
    },
  },
  forest: {
    name: '森林',
    tagline: '专注沉静：冷绿灰底 + 苔绿，降低唤醒，适合刷题与深度阅读',
    light: {
      canvas: '#f4f7f2',
      surface: '#fcfdfb',
      ink: '#15201a',
      'ink-soft': '#45564b',
      'ink-faint': '#5f7367',
      line: '#dbe4db',
      'line-strong': '#778a7c',
      accent: '#1c6643',
      'accent-soft': '#d9eede',
      'on-accent': '#ffffff',
      good: '#15603a',
      warn: '#775006',
      bad: '#9a2822',
    },
    dark: {
      canvas: '#0f1612',
      surface: '#17211b',
      ink: '#e7f1e8',
      'ink-soft': '#b9cbbd',
      'ink-faint': '#93a696',
      line: '#2a3830',
      'line-strong': '#6f8274',
      accent: '#71cd9b',
      'accent-soft': '#1c3227',
      'on-accent': '#082415',
      good: '#75d49e',
      warn: '#e0bb70',
      bad: '#f2968d',
    },
  },
  indigo: {
    name: '深蓝',
    tagline: '专业理性：蓝灰中性 + 靛蓝，接近学术出版物的克制',
    light: {
      canvas: '#f6f8fb',
      surface: '#ffffff',
      ink: '#121821',
      'ink-soft': '#43506a',
      'ink-faint': '#616f86',
      line: '#dce3ed',
      'line-strong': '#77869d',
      accent: '#1c47c4',
      'accent-soft': '#e2eafd',
      'on-accent': '#ffffff',
      good: '#12603c',
      warn: '#745006',
      bad: '#9d2530',
    },
    dark: {
      canvas: '#0d1219',
      surface: '#151c26',
      ink: '#e8eef7',
      'ink-soft': '#b4c0d2',
      'ink-faint': '#8b99ad',
      line: '#28313d',
      'line-strong': '#6d7c91',
      accent: '#93b2ff',
      'accent-soft': '#1a2740',
      'on-accent': '#0a1730',
      good: '#70d3a0',
      warn: '#dfba70',
      bad: '#f39aa1',
    },
  },
  violet: {
    name: '紫罗兰',
    tagline: '创意：淡紫中性 + 紫罗兰，适合作图、写作与概念探索',
    light: {
      canvas: '#f9f7fc',
      surface: '#fffefe',
      ink: '#1a1523',
      'ink-soft': '#4e4560',
      'ink-faint': '#6e6480',
      line: '#e5e0ed',
      'line-strong': '#8f85a3',
      accent: '#6524cf',
      'accent-soft': '#eee3fd',
      'on-accent': '#ffffff',
      good: '#14603a',
      warn: '#725006',
      bad: '#9b2333',
    },
    dark: {
      canvas: '#121019',
      surface: '#1b1724',
      ink: '#eee9f7',
      'ink-soft': '#c4bbd4',
      'ink-faint': '#9a90ab',
      line: '#322b41',
      'line-strong': '#786d8c',
      accent: '#c3a6ff',
      'accent-soft': '#2a2040',
      'on-accent': '#1a0f33',
      good: '#70d39c',
      warn: '#dfba70',
      bad: '#f49aa8',
    },
  },
  contrast: {
    name: '高对比',
    tagline: '无障碍优先：纯白/纯黑极限对比，正文 ≥10:1，弱视与强光环境友好',
    light: {
      canvas: '#ffffff',
      surface: '#ffffff',
      ink: '#000000',
      'ink-soft': '#2b2b2b',
      'ink-faint': '#4a4a4a',
      line: '#8f8f8f',
      'line-strong': '#595959',
      accent: '#00309e',
      'accent-soft': '#e4eaff',
      'on-accent': '#ffffff',
      good: '#00542a',
      warn: '#523700',
      bad: '#900d17',
    },
    dark: {
      canvas: '#000000',
      surface: '#0c0c0c',
      ink: '#ffffff',
      'ink-soft': '#e6e6e6',
      'ink-faint': '#c2c2c2',
      line: '#6e6e6e',
      'line-strong': '#8f8f8f',
      accent: '#9dbcff',
      'accent-soft': '#101a33',
      'on-accent': '#00102e',
      good: '#63dd9f',
      warn: '#f2cf80',
      bad: '#ffa0a0',
    },
  },
};

// ============ 审计规则 ============
// required: 参与通过/失败判定；info: 仅展示数值，无强制要求
export const RULES = [
  { fg: 'ink', bg: 'canvas', min: 7, sc: '1.4.6', level: 'AAA 正文', hcMin: 10 },
  { fg: 'ink', bg: 'surface', min: 7, sc: '1.4.6', level: 'AAA 正文', hcMin: 10 },
  { fg: 'ink-soft', bg: 'canvas', min: 4.5, sc: '1.4.3', level: 'AA 次要文字' },
  { fg: 'ink-soft', bg: 'surface', min: 4.5, sc: '1.4.3', level: 'AA 次要文字' },
  { fg: 'ink-faint', bg: 'canvas', min: 4.5, sc: '1.4.3', level: 'AA 提示文字' },
  { fg: 'ink-faint', bg: 'surface', min: 4.5, sc: '1.4.3', level: 'AA 提示文字' },
  { fg: 'line-strong', bg: 'canvas', min: 3, sc: '1.4.11', level: 'AA 控件边界' },
  { fg: 'line-strong', bg: 'surface', min: 3, sc: '1.4.11', level: 'AA 控件边界' },
  { fg: 'accent', bg: 'canvas', min: 4.5, sc: '1.4.3', level: 'AA 链接/强调文字' },
  { fg: 'accent', bg: 'surface', min: 4.5, sc: '1.4.3', level: 'AA 链接/强调文字' },
  { fg: 'on-accent', bg: 'accent', min: 4.5, sc: '1.4.3', level: 'AA 实心按钮文字' },
  { fg: 'accent', bg: 'accent-soft', min: 4.5, sc: '1.4.3', level: 'AA 徽标文字/进度填充' },
  { fg: 'ink', bg: 'accent-soft', min: 7, sc: '1.4.6', level: 'AAA 浅色块上的正文', hcMin: 10 },
  { fg: 'good', bg: 'canvas', min: 4.5, sc: '1.4.3', level: 'AA 语义文字' },
  { fg: 'good', bg: 'surface', min: 4.5, sc: '1.4.3', level: 'AA 语义文字' },
  { fg: 'warn', bg: 'canvas', min: 4.5, sc: '1.4.3', level: 'AA 语义文字' },
  { fg: 'warn', bg: 'surface', min: 4.5, sc: '1.4.3', level: 'AA 语义文字' },
  { fg: 'bad', bg: 'canvas', min: 4.5, sc: '1.4.3', level: 'AA 语义文字' },
  { fg: 'bad', bg: 'surface', min: 4.5, sc: '1.4.3', level: 'AA 语义文字' },
  // 仅展示：装饰性分隔线不受 1.4.11 约束；surface 与 canvas 的层次差异
  { fg: 'line', bg: 'canvas', min: 0, sc: '—', level: '装饰性分隔线（无要求）', info: true },
  { fg: 'surface', bg: 'canvas', min: 0, sc: '—', level: 'surface 层次（无要求）', info: true },
];

export function auditTheme(key, variant) {
  const t = THEMES[key][variant];
  const isHC = key === 'contrast';
  return RULES.map((rule) => {
    const fg = t[rule.fg];
    const bg = t[rule.bg];
    const ratio = contrast(fg, bg);
    let min = rule.min;
    if (isHC && rule.hcMin) min = Math.max(min, rule.hcMin);
    const info = !!rule.info;
    return {
      theme: key,
      variant,
      fgName: rule.fg,
      bgName: rule.bg,
      pair: `${rule.fg} on ${rule.bg}`,
      fg,
      bg,
      ratio: round2(ratio),
      raw: ratio,
      min,
      sc: rule.sc,
      level: rule.level,
      info,
      pass: info ? true : ratio >= min,
    };
  });
}

export function auditAll() {
  const rows = [];
  for (const key of Object.keys(THEMES)) {
    rows.push(...auditTheme(key, 'light'));
    rows.push(...auditTheme(key, 'dark'));
  }
  return rows;
}

export function summarize(rows) {
  const fails = rows.filter((r) => !r.pass);
  const byTheme = {};
  for (const r of rows) {
    const k = `${r.theme}/${r.variant}`;
    const s = (byTheme[k] ||= { min: Infinity, minPair: '', ink: 0, inkSoft: 0, faint: 0, n: 0, infoMin: Infinity });
    s.n++;
    if (!r.info && r.raw < s.min) {
      s.min = r.raw;
      s.minPair = r.pair;
    }
    if (r.info && r.raw < s.infoMin) s.infoMin = r.raw;
    if (r.fgName === 'ink' && r.bgName === 'canvas') s.ink = r.raw;
    if (r.fgName === 'ink-soft' && r.bgName === 'canvas') s.inkSoft = r.raw;
    if (r.fgName === 'ink-faint' && r.bgName === 'canvas') s.faint = r.raw;
  }
  return { fails, byTheme };
}

// ============ CLI ============
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('contrast-audit.mjs');
if (isMain) {
  const rows = auditAll();
  const { fails, byTheme } = summarize(rows);
  const argv = process.argv.slice(2);

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ themes: THEMES, rows, fails: fails.length }, null, 2));
  } else if (argv.includes('--markdown')) {
    for (const key of Object.keys(THEMES)) {
      for (const variant of ['light', 'dark']) {
        const sub = rows.filter((r) => r.theme === key && r.variant === variant);
        console.log(`\n**${THEMES[key].name} · ${variant === 'light' ? '浅色' : '深色'}**\n`);
        console.log('| 前景 / 背景 | 前景 | 背景 | 对比度 | 要求 | 依据 | 结果 |');
        console.log('| --- | --- | --- | ---: | ---: | --- | :---: |');
        for (const r of sub) {
          const verdict = r.info ? '参考' : r.pass ? '通过' : '**未通过**';
          const req = r.info ? '—' : `${r.min}:1`;
          console.log(`| ${r.pair} | \`${r.fg}\` | \`${r.bg}\` | **${fmt(r.ratio)}:1** | ${req} | ${r.sc} ${r.level} | ${verdict} |`);
        }
      }
    }
  } else if (argv.includes('--solve')) {
    // 为每个主题求解 ink-faint / line-strong / accent 的建议色
    for (const key of Object.keys(THEMES)) {
      for (const variant of ['light', 'dark']) {
        const t = THEMES[key][variant];
        const bg = t.canvas;
        const dir = variant === 'light' ? 'darker' : 'lighter';
        const base = hexToOklch(t['ink-faint']);
        const faint = solveForContrast(bg, 4.5, { H: base.H, C: Math.min(base.C, 0.03), dir });
        const ls = hexToOklch(t['line-strong']);
        const strong = solveForContrast(bg, 3, { H: ls.H, C: Math.min(ls.C, 0.02), dir });
        console.log(
          `${key}/${variant}: ink-faint ${t['ink-faint']}(${fmt(contrast(t['ink-faint'], bg))}) -> ${faint.hex}(${fmt(faint.ratio)}) | line-strong ${t['line-strong']}(${fmt(contrast(t['line-strong'], bg))}) -> ${strong.hex}(${fmt(strong.ratio)})`,
        );
      }
    }
  } else {
    console.log('主题 / 模式          最低(必需)  出现于                     正文     次要     提示');
    for (const [k, v] of Object.entries(byTheme)) {
      console.log(
        `${k.padEnd(18)} ${fmt(v.min).padStart(8)}:1  ${v.minPair.padEnd(26)} ${fmt(v.ink).padStart(6)}  ${fmt(v.inkSoft).padStart(6)}  ${fmt(v.faint).padStart(6)}`,
      );
    }
    console.log(`\n共 ${rows.length} 对（含参考项），未通过 ${fails.length} 对。`);
    for (const f of fails) console.log(`  FAIL ${f.theme}/${f.variant} ${f.pair} = ${fmt(f.ratio)} < ${f.min}`);
  }
  process.exitCode = fails.length ? 1 : 0;
}
