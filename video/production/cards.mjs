import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const raw = fileURLToPath(new URL("../out/final-20261118/raw/", import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const css = "html,body{margin:0;width:1920px;height:1080px}body{background:#f4f3eb;color:#253124;font:28px 'Microsoft YaHei',sans-serif;padding:116px 112px;box-sizing:border-box}header{border-top:3px solid #6d795e;padding-top:24px;font-size:25px;letter-spacing:3px}main{display:grid;grid-template-columns:650px minmax(0,1fr);gap:90px;align-items:center;margin-top:72px}h1{font:600 63px 'Microsoft YaHei';line-height:1.25;margin:0 0 24px}ol{margin:44px 0 0;padding:0;list-style:none;border-left:2px solid #96a187}li{margin:0 0 25px;padding:0 0 0 38px;position:relative}li:before{content:'';position:absolute;left:-7px;top:13px;width:12px;height:12px;background:#657456;border-radius:50%}li small{font-size:19px;color:#55674d;display:block;margin-top:6px}.frame{height:570px;border:1px solid #c7cdbb;border-radius:14px;overflow:hidden;background:#fff;position:relative;box-shadow:0 12px 32px #27301b12}img{position:absolute;height:auto}footer{margin-top:38px;color:#526045;font-size:23px}.url{font:650 36px 'Microsoft YaHei';color:#344b31;letter-spacing:.4px}.finish{background:#e8edde}";
async function card(id, image, content, pic, klass = "") {
  const data = (await readFile(path.join(raw, image + ".png"))).toString("base64");
  await page.setContent("<!doctype html><html lang='zh-CN'><meta charset='utf-8'><style>" + css + "</style><body class='" + klass + "'>" +
    "<header>自适应学习路径</header><main><section>" + content + "</section><div class='frame'><img style='" + pic +
    "' src='data:image/png;base64," + data + "'></div></main></body></html>");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(raw, id + ".png") });
}
try {
  await card("architecture_a", "node-c05",
    "<h1>一条路径<br>是怎么排出来的</h1><ol><li>作答证据<small>判断当前学习起点</small></li><li>知识点先修关系<small>决定学习顺序</small></li><li>可用时间<small>安排本次学习清单</small></li></ol>",
    "width:1400px;left:-174px;top:-224px");
  await card("architecture_b", "build_result",
    "<h1>一份方案<br>是怎么生成的</h1><ol><li>对话补全学习目标<small>记录基础、期限和练习偏好</small></li><li>检索相关材料<small>参考讲义与实际检索结果</small></li><li>校验先修图谱<small>由学生确认后保存</small></li></ol>",
    "width:2180px;left:-1130px;top:-227px");
  await card("end", "end_base",
    "<h1>把学习目标变成<br>下一步行动</h1><p>六周双栈队列学习方案</p><footer>在线演示</footer><p class='url'>chuanzhi.jasonsome.cn</p>",
    "width:1390px;left:-76px;top:-235px", "finish");
  await card("cover", "build_result",
    "<h1>自适应<br>学习路径</h1><p>从一道诊断题到自己的学习图谱</p><footer>第九届传智杯 · AI WEB 网页开发挑战赛</footer>",
    "width:2180px;left:-1130px;top:-227px", "finish");
} finally {
  await browser.close();
}
