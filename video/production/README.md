# 传智杯线上演示视频

## 60 fps 实录剪辑版

新版母片与同名 SRT 位于 `video/out/recut/chuanzhibei-live-1080p60.*`，时长 5 分 51 秒。网页镜头取自指定站点的 Chromium 连续录屏。原始 WebM 与对应的镜头时间、鼠标焦点分别保存在 `live/` 和 `live-hd/`。剪辑时先裁掉录制器填充区，再做移动取景。三段独立动画分别说明先修排程、带出处的检索、先修图谱校验。旁白按 1.12 倍保留音高处理，字幕随实测音频重新分句定时。

| 时间 | 内容 |
| --- | --- |
| 0:00–0:32 | 在登录页介绍项目，使用评委账号进入工作台 |
| 0:32–1:27 | 完成出栈顺序诊断，结合反馈讲解作答证据 |
| 1:27–2:44 | 点击顺序表、栈、队列，比较两档预算，读一项用时估算 |
| 2:44–3:48 | 向导师提问，核对引用原文，打开手机教材，讲解 BM25 检索 |
| 3:48–5:18 | 导入讲义，讨论两轮，联网生成方向并解释先修环路校验 |
| 5:18–5:51 | 展开本轮来源，保存方案，核对知识库和演示地址 |

逐段时长和新口播在 [recut.json](./recut.json)，沿用的台词按相同镜头名读取 [storyboard.json](./storyboard.json)。本轮实录中，30 分钟预算排入 4 步，60 分钟预算排入 6 步、预计 52 分钟。生成的私有方向「双栈队列与均摊分析 · 六周练习」含 12 个节点、15 条边。

复现需要下文列出的凭据、FFmpeg、Chromium，以及 Python 的 NumPy 和 Pillow。完整重录会在演示账号产生作答和新的学习方向。仅重新剪辑时可以直接使用已录素材，从 `recut.py audio` 开始。

```powershell
node video/production/record60.mjs tour
node video/production/record60.mjs tutor
node video/production/record60.mjs studio
$env:NATIVE_DETAIL = "1"
node video/production/record60.mjs login
node video/production/record60.mjs graph
node video/production/record60.mjs readback
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
