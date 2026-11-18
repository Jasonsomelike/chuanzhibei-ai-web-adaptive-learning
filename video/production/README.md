# 传智杯线上演示视频

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
