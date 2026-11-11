# 全页设计与交互验收

2026-11-11。按用户选定的第二张学习地图与橄榄色执行，导览、地图、章节布局和六套配色独立选择。最终结果为 passed。

## 检查范围与证据

设计原图位于 [docs/design/editorial](docs/design/editorial/README.md)，实现截图位于 [qa](docs/design/editorial/qa)。图片均为真实浏览器渲染。课程规模、作答结果、先修关系、学习顺序与会话内容使用程序数据。

| 页面 | 设计来源 | 桌面实现 | 手机实现 |
| --- | --- | --- | --- |
| 学习概览 | [home.png](docs/design/editorial/home.png) | [1487](docs/design/editorial/qa/final-home-atlas-1487.png) | [390](docs/design/editorial/qa/final-home-atlas-390.png) |
| 学习地图 | [path-atlas.png](docs/design/editorial/path-atlas.png) | [1487](docs/design/editorial/qa/final-path-atlas-1487.png) | [390](docs/design/editorial/qa/final-path-atlas-390.png) |
| 课程诊断 | [diagnose.png](docs/design/editorial/diagnose.png) | [1487](docs/design/editorial/qa/final-diagnose-atlas-1487.png) | [390](docs/design/editorial/qa/final-diagnose-atlas-390.png) |
| 课程导师 | [tutor.png](docs/design/editorial/tutor.png) | [1487](docs/design/editorial/qa/final-tutor-atlas-1487.png) | [390](docs/design/editorial/qa/final-tutor-atlas-390.png) |
| 我的课程 | [courses.png](docs/design/editorial/courses.png) | [1487](docs/design/editorial/qa/final-courses-atlas-1487.png) | [390](docs/design/editorial/qa/final-courses-atlas-390.png) |
| 课程探索 | [market.png](docs/design/editorial/market.png) | [1487](docs/design/editorial/qa/final-market-atlas-1487.png) | [390](docs/design/editorial/qa/final-market-atlas-390.png) |
| 外观设置 | [settings.png](docs/design/editorial/settings.png) | [1487](docs/design/editorial/qa/final-settings-atlas-1487.png) | [390](docs/design/editorial/qa/final-settings-atlas-390.png) |
| 使用指南 | [guide.png](docs/design/editorial/guide.png) | [1487](docs/design/editorial/qa/final-guide-atlas-1487.png) | [390](docs/design/editorial/qa/final-guide-atlas-390.png) |
| 关于项目 | [about.png](docs/design/editorial/about.png) | [1487](docs/design/editorial/qa/final-about-atlas-1487.png) | [390](docs/design/editorial/qa/final-about-atlas-390.png) |
| 登录注册 | [login.png](docs/design/editorial/login.png) | [1487](docs/design/editorial/qa/final-login-atlas-1487.png) | [390](docs/design/editorial/qa/final-login-atlas-390.png) |

补充比较了 [导览布局](docs/design/editorial/qa/final-path-paper-1487.png)、[章节布局](docs/design/editorial/qa/final-path-chapters-1487.png) 与各自同名设计原图。手机补充了 [导览](docs/design/editorial/qa/final-path-paper-390.png)、[章节](docs/design/editorial/qa/final-path-chapters-390.png)，以及完整历史的 [桌面分支](docs/design/editorial/qa/tutor-branch-desktop.png) 和 [手机分支](docs/design/editorial/qa/tutor-branch-phone.png)。

### 尺寸与状态

- 桌面设计原图和实现截图均为 1487×1058 像素，实现 CSS 视口同尺寸，deviceScaleFactor 为 1。
- 手机原图为 852×1846 像素，实现为 390×844 像素，CSS 视口为 390×844，deviceScaleFactor 为 1。原图等比缩至 390×844 范围，保留不足一像素的边缘留白。归一化参考为 [图谱](docs/design/editorial/qa/reference-mobile-path-390.png)、[导师](docs/design/editorial/qa/reference-mobile-tutor-390.png)、[设置](docs/design/editorial/qa/reference-mobile-settings-390.png)。
- 默认截图为地图、橄榄、浅色、减少动效，课程为数据结构。诊断和图谱包含隔离浏览器的一条真实测试作答，市场为真实空状态，导师首页为新会话，分支截图来自专用会话回归。
- 三种布局分别检查十页在 1487、853、768、390、360px 的输入与导航边界，共 150 个页面组合。手机名称与五个入口、图谱邻接名称和清单定位另有断言。
- 通过设置界面切换全部六种主题的浅色、深色模式，检查正文和辅助文字语义色相对画布的对比度至少 4.5。图谱状态颜色使用学习专项的额外对比度检查。

## 完整画面与局部比较

完整画面逐页比较主次、列宽、对齐、分隔线、首屏内容、表单与导航。概览为任务和课程双列，图谱为实际关系与学习清单，诊断保留开放题面，导师以连续对话和按需资料组织，阅读页使用章节目录。

图谱的节点、选中标记、证据文字和连线额外进行了原尺寸区域比较。[节点局部对照](docs/design/editorial/qa/compare-node-detail.png) 左侧为原图的 550,420 至 1030,670 区域，右侧为实现的 500,400 至 980,650 区域。两侧均为 480×250 的原始像素裁切，未改写图内内容。手机图谱与外观使用上述归一化参考比较，完整会话另检查引用、图片按钮、分支来源与输入区。

### 必需的五项视觉检查

| 项目 | 核对与结论 |
| --- | --- |
| 字体与层次 | 正文沿用中文无衬线系统字体栈，主标题使用中文衬线回退。主要 UI 正文约 14–16px，辅助元数据更小，导师回答 16px。系统字体实际回退会影响字形，标题、正文和辅助内容的层次保留。 |
| 间距与布局 | 桌面地图导航 120px，页首 74px，内容边距 36px。导览扩大导航，章节使用顶栏。手机统一顶栏与五入口，阅读目录可横向滚动，设置三个布局纵向排列。 |
| 颜色与状态 | 默认画布 #fafaf7、导航 #ecede4、文字 #252a25、强调 #46513e。选择使用琥珀色，判分后使用语义正确与错误色，状态同时具有文字和形状。六套主题保留独立明暗模式。 |
| 图像与图标 | 保留项目 BrandMark，使用 Lucide 图标。图谱为 React Flow 数据结构，布局缩略图使用已生成的设计原图。教材和会话图片保持实际内容，图片查看可展开。 |
| 文案与内容 | 删除设计示意标记，使用真实课程、路径、证据和原文。关于页呈现现有 Supervisor 与教学子流程。资料、图片保存说明与账号同步逻辑一致。 |

### 有意保留的实现差异

- 图谱保留真实先修边与规划时间，原图的样例边、顺序和状态未作为课程数据导入。窄画布聚焦当前点、直接先修、附近分支与应用，完整课程仍可搜索或展开。
- 设置保留六套已有及新增配色，缩略图使用完整设计图。移动端表单和学习操作具有至少 44px 的主要点击区域，较长内容通过纵向滚动阅读。
- 会话与上传资料的说明补充实际存储范围。旧版已经丢弃的历史无法重建，新会话完整存档。问题图片沿用最长边 1568px、单张 400KiB 的上传压缩规格。
- 学习状态使用真实作答，因此同尺寸截图中的题目、证据、预算耗时和最近记录可能不同于设计示例。

## 发现、修复与复查

目前没有待修复的 P0、P1 或 P2 视觉问题。

| 级别与位置 | 早期发现及影响 | 修复 | 修复后证据 |
| --- | --- | --- | --- |
| P1 导师历史 | 旧界面仅能恢复短记录和最后一个任务，无法管理完整讨论。 | 增加账号及匿名完整存档、消息分页、按轮分支、管理与跨设备恢复，保存每轮练习凭据。 | 会话 HTTP 18 项、界面 20 项，分支截图见上方。 |
| P2 图谱连线 | 节点测量和布局切换曾影响实际边的显示。 | 保留受控节点测量，切换布局更新连接点，按真实边渲染。 | 三种布局的边集合与课程数据逐项对照，黄金路径指纹回归通过。 |
| P2 诊断反馈 | 旧选项颜色和反馈布局主次不清。 | 选中使用琥珀色，提交后显示正确与错误，保持选项行文档位置和高度。 | 诊断选择、判分、位置断言及桌面/手机截图。 |
| P2 导览手机页首 | 桌面专用隐藏选择器也作用于手机名称。 | 将该规则限制到桌面，统一 768px 手机断点。 | 三种布局、十页、三个手机宽度逐一检查名称和导航，导览手机截图。 |
| P2 手机图谱 | 邻接点名称被画布裁切，需要额外拖动才能阅读。 | 窄画布聚焦附近关系，采用三列紧凑排列并完整适配视野，增加图谱与清单切换。 | [修复前](docs/design/editorial/qa/before-mobile-path.png)、[修复后](docs/design/editorial/qa/final-path-atlas-390.png)，三种布局均检查全部邻接名称边界和清单返回定位。 |
| P2 手机外观 | 横向缩略图仅直接呈现一部分布局选项。 | 三种布局纵向排列，预览和说明并列。 | [修复前](docs/design/editorial/qa/before-mobile-settings.png)、[修复后](docs/design/editorial/qa/final-settings-atlas-390.png)。 |
| P2 加载状态 | 首次读取路径或导师时只有短文本，工作区随后整体跳出。 | 使用与主要区域一致的稳定骨架，关闭减少动效模式下的过渡。 | 应用内浏览器核对加载至实际图谱，完整回归检查准备状态。 |
| P2 教材入口 | 图谱链接使用单数 material 参数，未自动展开教材。 | 与导师入口统一为 materials 参数。 | 从真实知识点点击“阅读教材”后直接出现材料抽屉。 |

## 功能与可访问性检查

- 图谱节点、搜索、键盘选择、先修入口、学习清单与详情联动。课程、预算和选中点在设置往返后恢复。图谱和布局操作不改写作答证据。
- 课程目录搜索、展开全部、实际方向创建保存、匿名入口、课程市场筛选和失败重试可用。
- 指南试做显示题库解析且不写入学习记录，阶段支持方向键和 Home/End。文档目录定位和当前章节标记可用。
- 登录注册校验、确认密码、原站内入口返回和外部地址回退可用。
- 材料抽屉具有焦点管理与 Escape 关闭，手机输入框位于底栏上方。减少动效设置刷新后恢复。
- 完整会话覆盖十二轮分页、图片与引用快照、指定回答分支、跨设备继续、管理、停止与迟到响应、登出隔离和匿名刷新。
- 150 个页面组合及会话界面均检查浏览器运行错误，结果为零。

## 最终检查结果

| 命令或专项 | 结果 |
| --- | --- |
| npm run verify | 109 个测试文件、2,116 项测试通过，知识图谱校验、密钥扫描、导师评测通过。 |
| npm run build | 生产构建成功。 |
| npm run lint | 0 错误、37 条警告，主要为既有及同步状态的 effect 写法。 |
| npm run test:e2e | 完整命令成功退出，学习 302、设计交互 331、会话 HTTP 18、会话界面 20、认证存储 36、MCP 18，共 725 项通过。 |

默认测试并发曾有 worker 异常退出，现将单元测试并发固定为四个 worker，标准 verify 命令通过。一次端到端运行在 MCP 阶段出现 Node 原生进程退出，重新执行完整命令后正常完成。抽屉回归改为等待真实关闭和焦点恢复。

最终截图来自临时目录 alp-editorial-1794364795687 与 alp-conversation-ui-1794364827700。验证使用隔离本地服务、临时测试账号、临时密钥及本机模型替身，数据库语句另通过 PGlite 执行。真实线上数据库和外部模型供应商尚未进行部署后验收。

### 完成清单

- [x] 十页桌面及手机视觉比较。
- [x] 三布局、六主题、独立明暗和减少动效。
- [x] 图谱、诊断、课程、导师、完整历史与分支正常入口回归。
- [x] 加载、空态、错误、选中、提交、恢复及账号边界。
- [x] 原图、归一化参考、局部对照、修复历史与最终截图归档。

## Final result

passed
