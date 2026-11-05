# 自适应学习路径 UI V2 验收（2026-11-05）

依据参考对话最新的《传智杯「自适应学习路径」项目 UI/UX 改造规范 V2.0》实施。本记录对应本轮代码与本地生产构建；远端 CI 以本次提交的 GitHub Actions 结果为准。

## 改动与对应文件

| 改动 | 实现与目的 |
| --- | --- |
| 项目名称与日常文案 | `app/layout.tsx`、`ui.tsx`、各核心页面及 README：统一“自适应学习路径”；标题说明实际功能；保留正确的传智杯赛事、赛道与团队信息 |
| 首页日常学习仪表盘 | `learning-dashboard.tsx`：区分首次与已有记录，读取真实最近作答、当前课程证据、下一任务和到期复习；已有作答优先继续学习；未测评任务不显示先验百分比 |
| 流程演示移至指南 | 新增 `learning-journey.tsx`，在 `guide/page.tsx` 使用；保留真实题目、预算规划和导师主题预填，预览不写作答证据 |
| 路径与图谱联动 | `path/page.tsx`、`learning-graph.tsx`：清单选择定位图谱，图谱可返回对应步骤；键盘选择同步详情与清单；保留受控节点测量尺寸与真实先修连线 |
| 手机布局与预算对比 | 手机默认收起图谱，清单可直接使用；预算与章节入口保持可见；变化详情列出实际新增、预算暂缓和先修阻塞；技术指纹按需展开 |
| 诊断反馈 | `diagnose/page.tsx`：提交后显示答案、解析及资料出处；增加同步提交门闩；保留真实选项、UUID、证据更新、专注模式与减少动态效果 |
| 导师原文核对 | `tutor/page.tsx`、`tutor-rail.tsx`：正文和引用按钮在材料栏定位该回答的摘录快照，手机使用抽屉；Agent 展示服务端本次返回的课程摘录上下文，明确命中不等于全部引用；没有原文时明确说明。运行详情默认折叠 |
| 视觉与动效 | `globals.css`：保留五套暖色主题及明暗模式，日常区域用分隔线减少重复卡片；暂缓用虚线、阻塞用方形标识及加粗边；保留 GSAP 与 React Flow 各自的变换范围 |
| 仓库交付清理 | 删除 `AGENTS.md`，设置 Next `agentRules: false`，忽略本地同类工具指令文件；实际 Agent API、算法与项目技术文档保留 |
| 自动化验收 | `scripts/learning-smoke.ts`：更新页面身份断言，并增加仪表盘、指南迁移、原文侧栏、双向定位、键盘选择、手机清单优先及品牌一致性检查 |

原有尚未提交的作品文档、生成脚本和视频文件没有纳入本轮提交。对作品 DOCX 与两份 PDF 进行了只读文本检索：均含“自适应学习路径”，没有“智慧学伴”或“智慧伴读”。市场调研中另一平台的同名产品是明确的外部案例，保持原引用事实。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| `npm run verify` | 类型检查、105 个单测文件 / 2064 项、图谱校验、密钥扫描、导师规则评测通过 |
| `npm run lint -- --quiet` | exit 0，无错误 |
| `npm run build` | exit 0，30 个路由条目；最终生产代码再次构建通过 |
| `npm run test:e2e` | 学习流程 278 项、账号 36 项、MCP 18 项全部通过，使用隔离内存服务与本机模型 mock |
| 浏览器范围 | Chromium；1440、1280、853、390、360px；10 个页面无横向溢出、pageerror 或框架遮罩 |
| 主题与动效 | 五套主题 × 明暗模式经实际设置切换；节点文字对比度 ≥4.5:1；真实动态效果下验证 Flip 身份与终态，减少动态效果下截图 |
| 开发环境清理 | 启动 `next dev` 并请求首页 HTTP 200 后，确认 `AGENTS.md` 未重新生成 |

本轮未修改 `plan.ts`、`mastery.ts`、`graph.ts`、`learner.ts`、课程图谱和题库，也没有更新黄金用例常量。`npm run path:hash` 保持：

```text
algoVersion plan-v2
kgVersion   kg-v1
inputHash   f9f9999230b4c06be74c235e4f7bedc39dcb7c4b947dea80f4dbb89539e61ecd
pathHash    ad7ccec537db36ee7b0070aca3f9f99006e92521e16ce2608def4df76f2b9e66
```

未调用收费真实模型。Agent 检查走真实本地认证、检索、接口与事件流，模型回复由本机 mock 提供；这不等同于线上模型质量评测。

## 改造前后截图

同一 Chromium、空学习记录、默认暖砂主题、减少动态效果；视口 1440×960 与 390×960。改造前图片保留历史名称和旧版文案，仅用于对照，不是当前界面。截图是实际渲染结果。

| 页面 | 桌面改造前 | 桌面改造后 | 手机改造前 | 手机改造后 |
| --- | --- | --- | --- | --- |
| 首页 | [前](../screenshots/ui-v2/before-home-1440.png) | [后](../screenshots/ui-v2/after-home-1440.png) | [前](../screenshots/ui-v2/before-home-390.png) | [后](../screenshots/ui-v2/after-home-390.png) |
| 诊断 | [前](../screenshots/ui-v2/before-diagnose-1440.png) | [后](../screenshots/ui-v2/after-diagnose-1440.png) | [前](../screenshots/ui-v2/before-diagnose-390.png) | [后](../screenshots/ui-v2/after-diagnose-390.png) |
| 路径 | [前](../screenshots/ui-v2/before-path-1440.png) | [后](../screenshots/ui-v2/after-path-1440.png) | [前](../screenshots/ui-v2/before-path-390.png) | [后](../screenshots/ui-v2/after-path-390.png) |
| 导师 | [前](../screenshots/ui-v2/before-tutor-1440.png) | [后](../screenshots/ui-v2/after-tutor-1440.png) | [前](../screenshots/ui-v2/before-tutor-390.png) | [后](../screenshots/ui-v2/after-tutor-390.png) |
