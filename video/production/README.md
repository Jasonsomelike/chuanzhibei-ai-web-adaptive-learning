# 传智杯线上演示视频

## 60 fps 实录剪辑版

新版母片与同名 SRT 位于 `video/out/recut/chuanzhibei-direction-graph-1080p60.*`，时长 6 分 15 秒。网页镜头取自指定站点的 Chromium 连续录屏。原始 WebM 与对应的镜头时间、鼠标焦点分别保存在 `live/` 和 `live-hd/`。每个细节近景结束后，镜头拉回完整浏览器视口并短暂停留。紧邻的操作全景连拍。手机段保留 430 × 860 的完整竖屏，字幕放在手机画面左侧。三段独立动画分别说明先修排程、带出处的检索、先修图谱校验。旁白按 1.12 倍保留音高处理，字幕随实测音频重新分句定时。

| 时间 | 内容 |
| --- | --- |
| 0:00–0:17 | 动画介绍项目，用双栈队列目标串起先修路径，依次点亮四项功能 |
| 0:17–0:32 | 旁白说到登录时切入线上登录页，使用评委账号进入工作台 |
| 0:32–1:27 | 完成出栈顺序诊断，从错题本筛选同一道题、查看解析并打开重做，再说明作答证据 |
| 1:27–2:40 | 点击顺序表、栈、队列，切到当前路径比较两档预算，核对顺序表的模型估算 |
| 2:40–3:40 | 实录提问与发送，阅读双栈结论和 1、2、3 的例子，点开教材出处；手机竖屏翻开教材并带着原文回到提问，随后讲解 BM25 检索 |
| 3:40–5:11 | 导入讲义，讨论两轮，联网生成方向、校验先修关系并保存 |
| 5:11–5:25 | 在图谱页查看已保存方向的全科关系，点开「均摊代价解释」，核对两个前置知识后回到全图 |
| 5:25–5:40 | 从地图＋橄榄切到章节＋暖砂、导览＋深蓝，逐一展示学习地图，再恢复地图＋橄榄 |
| 5:40–6:03 | 展示模型供应商、联网搜索，以及资料与口径中的口径基源和教材优先级 |
| 6:03–6:15 | 回到已保存方案，展示演示地址 |

逐段时长和新口播在 [recut.json](./recut.json)，沿用的台词按相同镜头名读取 [storyboard.json](./storyboard.json)。本轮实录中，同一份作答记录下，30 分钟排入 2 步、预计 22 分钟；60 分钟排入 3 步、预计 47 分钟。「顺序表」从预算暂缓变为第 3 步。页面复用 DeepSeek 的模型估算，顺序表新学 25 分钟、复习 10 分钟。生成的私有方向「双栈队列与均摊分析 · 六周练习」含 12 个节点、15 条边。

复现需要下文列出的凭据、FFmpeg、Chromium，以及 Python 的 NumPy 和 Pillow。完整重录会在演示账号产生作答和新的学习方向。仅重新剪辑时可以直接使用已录素材，从 `recut.py audio` 开始。

```powershell
node video/production/record60.mjs tour
node video/production/record60.mjs tutor
node video/production/record60.mjs studio
$env:NATIVE_DETAIL = "1"
node video/production/record60.mjs login
node video/production/record60.mjs nodes
node video/production/record60.mjs budgets
node video/production/record60.mjs mistakes
node video/production/record60.mjs settings
node video/production/record60.mjs appearanceGraphs
node video/production/record60.mjs readback
node video/production/record60.mjs directionGraph
node video/production/explain.mjs
python -X utf8 video/production/recut.py voices
python -X utf8 video/production/recut.py audio
python -X utf8 video/production/recut.py video
python -X utf8 video/production/recut.py mux
```

编码参数为 1920×1080、60 fps、H.264、AAC 48 kHz。定向重剪可在 `recut.py video` 后传入镜头名。录屏画面中密码由网站原生密码框遮盖。

## 原版母片

2026 年 11 月 18 日录制，成片 6 分 15 秒。画面来自指定的线上站点，流程图和片尾使用实际录屏截图。分镜与口播在 [storyboard.json](./storyboard.json)。成片、字幕、旁白、原始录屏和验收截图输出到 `video/out/final-20261118/`。

## 复现

准备 Node.js、项目的 Playwright 与 Chromium、Python、带 `libass` 和 `libx264` 的 FFmpeg 及 FFprobe。Windows 下使用微软正黑或雅黑字体环境，字幕默认使用 Microsoft YaHei。

把评委演示账号和密码分别放进当前进程的 `DEMO_EMAIL`、`DEMO_PASSWORD`，把 MiMo 凭据放进 `MIMO_API_KEY`。如需覆写工具路径，设置 `FFMPEG_PATH` 和 `FFPROBE_PATH`。录制从线上账号读取数据，并会提交测试作答、创建一段导师会话和一份私有学习方向。

```powershell
node video/production/record.mjs login
node video/production/record.mjs tour
node video/production/record.mjs tutor
node video/production/record.mjs studio
node video/production/cards.mjs
python -X utf8 video/production/narrate.py
python -X utf8 video/production/compose.py
```

MiMo 旁白逐句缓存。需要全片切换到 Edge 的单一中文音色时，运行 `narrate.py --edge`。合成脚本会烧录字幕、导出 SRT，并以不重新编码视频的方式拼接分段。分段已完整编码时，可使用 `compose.py --mux-only` 重做封装。

录制时从 30 分钟预算换到 60 分钟，按照当次作答与规则初估，实际新增了「栈」与「栈的应用」。自定义方向在当次会话生成 12 个节点、16 条先修边。重复录制前按屏幕实测结果核对这几句口播。
