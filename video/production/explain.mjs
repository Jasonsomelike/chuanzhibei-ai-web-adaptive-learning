import { chromium } from "playwright";
import { take } from "./live-camera.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 2304, height: 1296 },
  deviceScaleFactor: 1,
});
const css = `
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{font:24px/1.55 "Microsoft YaHei",sans-serif;background:#f4efe4;color:#26332e}
article{height:100%;padding:46px 82px 72px;position:relative}
article{width:1440px;height:810px;transform:scale(1.6);transform-origin:top left}
header{border-top:2px solid currentColor;padding-top:13px;display:flex;justify-content:space-between;font-size:19px;letter-spacing:.05em}
h1{font:600 65px/1.2 "SimSun",serif;margin:52px 0 12px}
h2{font-size:32px;margin:0 0 12px}
p{margin:0}
.dek{font-size:25px;color:#576258}
.flow{margin-top:63px;display:flex;align-items:center;gap:30px}
section{flex:1;min-width:0;position:relative}
strong.big{font:600 42px/1.3 "SimSun",serif;display:block;margin:12px 0}
.k{display:block;font:600 17px "Microsoft YaHei";color:#975026;letter-spacing:.12em;margin-bottom:17px}
.choice{padding:10px 0;border-bottom:1px solid #c9c9b8;font-size:23px}
.cross{color:#9e432e}.check{color:#24553f}
.arrow{width:60px;height:2px;background:#829184;position:relative;flex-shrink:0}.arrow:after{content:"";position:absolute;right:0;top:-5px;width:10px;height:10px;border-right:2px solid currentColor;border-top:2px solid currentColor;transform:rotate(45deg)}
.graph{width:100%;height:154px}.graph text{font:21px "Microsoft YaHei";fill:#26332e}
.graph path,.graph circle{fill:none;stroke:#647a64;stroke-width:2}
.graph circle{fill:#faf7ed;stroke-width:3}
.dark{background:#203b37;color:#f8f3e8}.dark .dek{color:#c0d0bf}.dark .k{color:#e3ba83}
.quote{font:500 43px/1.5 "SimSun";padding:18px 0}
.paper{background:#f4f0e4;color:#26332e;border-radius:3px;box-shadow:9px 9px 0 #adc3ad45;padding:24px 28px;border-left:4px solid #ccaa78}
.paper p{font-size:23px}.paper small{display:block;font-size:16px;margin-top:14px;color:#677361}
.tag{display:inline-block;border:1px solid #8aa99e;border-radius:24px;padding:3px 13px;font-size:18px;margin:4px 6px 4px 0}
.validate .flow{margin-top:48px;align-items:stretch;gap:55px}.validate section{border-top:2px solid #acb59c;padding-top:19px}
.glyph{height:125px;margin:8px 0 20px}.glyph text{font:22px "Microsoft YaHei";fill:#29352e}
.glyph circle{fill:#e5ebdd;stroke:#435e4c;stroke-width:2}.glyph path{fill:none;stroke:#627959;stroke-width:2}
[data-step]{opacity:0;transform:translateY(13px);transition:opacity .55s ease,transform .65s cubic-bezier(.2,.7,.2,1)}
[data-step].on{opacity:1;transform:none}
`;
const branch =
  '<svg class="graph" viewBox="0 0 350 150"><path d="M67 77 C160 77 120 32 213 32 M67 77 C160 77 120 119 213 119"/><circle cx="57" cy="77" r="8"/><circle cx="216" cy="32" r="8"/><circle cx="216" cy="119" r="8"/><text x="14" y="119">顺序表</text><text x="236" y="38">栈</text><text x="236" y="125">队列</text></svg>';
const content = {
  evidence: {
    title: "一道错题，怎样影响下一步？",
    sub: "以「栈」的诊断为例",
    theme: "",
    label: "学习路径",
    body: `<div class="flow"><section data-step="1"><span class="k">作答</span><h2>哪种出栈顺序不可能？</h2><p class="choice cross">我选了　3，2，1</p><p class="choice check">应当选　3，1，2</p></section><i class="arrow" data-step="2"></i><section data-step="2"><span class="k">学习证据</span><strong class="big">更新掌握状态</strong><p>记录在「栈」这个知识点下</p></section><i class="arrow" data-step="3"></i><section data-step="3"><span class="k">先修图谱 · 时间预算</span>${branch}</section></div>`,
  },
  retrieval: {
    title: "导师的引用，从哪里来？",
    sub: "检索增强生成（RAG）",
    theme: "dark",
    label: "课程导师",
    body: `<div class="flow"><section data-step="1"><span class="k">学生提问</span><p class="quote">为什么两个栈<br>能实现队列？</p></section><i class="arrow" data-step="2"></i><section data-step="2"><span class="k">BM25 关键词检索</span><strong class="big">定位教材片段</strong><p><span class="tag">栈</span><span class="tag">队列</span></p></section><i class="arrow" data-step="3"></i><section class="paper" data-step="3"><h2>引用原文</h2><p>栈遵循后进先出。<br>队列遵循先进先出。</p><small>知识点、教材章节与页码</small></section></div>`,
  },
  validation: {
    title: "这张图，可以按顺序学吗？",
    sub: "规划导师生成草案后，程序校验每一条先修关系。",
    theme: "validate",
    label: "自定义方向",
    body: `<div class="flow"><section data-step="1"><span class="k">生成</span><strong class="big">知识点与先修边</strong>${branch}</section><section data-step="2"><span class="k">端点校验</span><strong class="big">两端都有知识点</strong><svg class="glyph" viewBox="0 0 270 100"><circle cx="50" cy="50" r="27"/><circle cx="207" cy="50" r="27"/><path d="M80 50h93l-10 -8 m10 8 -10 8"/><text x="40" y="58">A</text><text x="198" y="58">B</text></svg></section><section data-step="3"><span class="k">环路校验</span><strong class="big">先修不能绕回自己</strong><svg class="glyph" viewBox="0 0 270 100"><path d="M58 36Q125 -8 192 36l-13 -2m13 2 -5 -12 M192 69Q125 114 58 69l5 12m-5 -12 13 2"/><text x="32" y="60">A</text><text x="201" y="60">B</text><text x="113" y="65" style="fill:#a74d35;font-size:36px">×</text></svg></section></div>`,
  },
};
try {
  await page.goto(new URL("./intro.html", import.meta.url).href);
  await page.evaluate(() => document.fonts.ready);
  await take(page, "intro", 17, async ({ at }) => {
    await page.evaluate(() => document.body.classList.add("play"));
    await at(4.85);
    await page.evaluate(() => {
      document.body.dataset.act = "2";
    });
    for (const [i, t] of [5.1, 6.3, 7.7].entries()) {
      await at(t);
      await page
        .locator("#r" + (i + 1))
        .evaluate((el) => el.classList.add("on"));
    }
    await at(9.5);
    await page.evaluate(() => {
      document.body.dataset.act = "3";
    });
    for (const [i, t] of [9.8, 11.4, 13.15, 14.55].entries()) {
      await at(t);
      await page.evaluate((i) => {
        document.querySelector("#f" + (i + 1)).classList.add("on");
        document.querySelector("#feature-line").style.strokeDashoffset =
          1 - i / 3;
      }, i);
    }
  });
  for (const [key, s] of Object.entries(
    process.argv[2] === "intro" ? {} : content,
  )) {
    await page.setContent(
      '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>' +
        css +
        '</style><body class="' +
        s.theme +
        '"><article><header><b>自适应学习路径</b><span>' +
        s.label +
        "</span></header><h1>" +
        s.title +
        '</h1><p class="dek">' +
        s.sub +
        "</p>" +
        s.body +
        "</article></body></html>",
    );
    await page.evaluate(() => document.fonts.ready);
    await take(page, key, key === "retrieval" ? 22 : 21, async ({ at }) => {
      for (const [i, t] of [0, 4.2, 10.8].entries()) {
        await at(t);
        await page
          .locator('[data-step="' + (i + 1) + '"]')
          .evaluateAll((els) => els.forEach((el) => el.classList.add("on")));
      }
    });
  }
} finally {
  await browser.close();
}
