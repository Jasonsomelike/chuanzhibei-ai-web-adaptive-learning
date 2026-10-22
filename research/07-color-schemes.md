# 07 · 配色方案调研与 5 套可切换主题

> 调研日期 2026-10-22。面向「教育类学习产品」的 Web 配色，落地对象是中文自适应学习路径应用（Next.js 16 + Tailwind 4）。
> **本文所有对比度数字都是脚本实算的**，不是估计。校验脚本：`research/tools/contrast-audit.mjs`，可随时重跑复现。
> 与现有 `app/globals.css` 的关系：现有 token 是「暖砂」主题的原型，本文给出完整 5 套（含深色）的升级版。

---

## 0. 一页速览

1. **主流设计系统的共识是「成对定义」而不是「定义单个颜色」。** MD3 用 `primary` / `on-primary` 成对，shadcn/ui 用 `background` / `foreground`、`muted` / `muted-foreground` 成对，Khan Academy 的 Wonder Blocks 用 `background.*` / `foreground.*` / `border.*` 三层语义命名。**没有任何一家靠「一个色值 + 透明度」撑起整个体系。**
2. **深色模式不是浅色模式的取反。** Radix 为每个色相单独生成 12 阶 dark scale；MD3 深色把 `primary` 从 tone 40 换成 tone 80、`surface` 从 tone 98（`#fef7ff`）换成 tone 6（`#141218`）。我实测 Radix 的 light `gray-11` 在 `gray-2` 上只有 5.62:1，dark `gray-11` 是 8.48:1——**同一个 step 在两个模式下并不等对比**。
3. **WCAG 2.2 的硬指标是四档：** 正文 4.5:1（SC 1.4.3 AA）、大字 3:1（同条）、非文本 3:1（SC 1.4.11 AA）、正文增强 7:1（SC 1.4.6 AAA）。**阈值不许四舍五入**，4.499:1 就是不达标。教育产品最容易翻车的是「提示文字」和「进度条填充 vs 轨道」。
4. **教育产品普遍用高饱和暖色，但那是品牌层，不是正文层。** 实测 Duolingo 的品牌绿 `#58cc02` 配白字只有 **2.09:1**，它的黄 `#ffb100` 只有 **1.82:1**；这些颜色只用于大面积色块和角色 IP，正文仍然用深灰。**「看起来活泼」和「正文可读」是两套颜色。**
5. **长时间阅读该偏冷还是偏暖，没有单一答案，但有可用的证据：** 屏幕阅读存在「正极性优势」（深字浅底优于浅字深底，Piepenbrock 2013 / Dobres 2017），字号越小优势越明显；暖色 vs 冷色影响的是**动机与任务类型**（Mehta & Zhu 2009：红色提升细节型任务、蓝色提升创造性任务），不是「哪个更不伤眼」。所以正确做法是**提供切换**，而不是替用户选一个。
6. **中文在深色下发虚，主因不是颜色，是字重与字形。** 中文没有西文的升部/降部变化，笔画密度高、字面填满 em 框；深色底上的亮字会产生「光晕/泛光」（halation），细笔画先糊掉。对策是**深色下把正文字重从 400 提到 450–500、不要用纯白、把正文对比度控制在 12–16:1 而不是 21:1**。
7. **5 套主题全部达标：** 210 个检查对（含参考项）**0 失败**；正文最低 **15.50:1**，次要文字最低 **7.24:1**，提示文字最低 **4.70:1**，控件边框最低 **3.26:1**，高对比主题正文 **21.00:1**（要求 ≥10:1）。

---

## 1. 主流设计系统怎么组织 token

### 1.1 Tailwind CSS 默认色板

- **结构**：17 个彩色家族（red / orange / amber / yellow / lime / green / emerald / teal / cyan / sky / blue / indigo / violet / purple / fuchsia / pink / rose）+ 5 个有文档的中性家族（slate / gray / zinc / neutral / stone），每族 **11 阶**，`50`（最浅）到 `950`（最深）。来源：[tailwindcss.com/docs/colors](https://tailwindcss.com/docs/colors)。
- **中性家族的差别只是色温**，亮度结构对齐：`slate` 偏蓝（`oklch(55.4% 0.046 257.417)`）、`gray` 微蓝、`zinc` 极淡紫、`neutral` 零彩度、`stone` 偏暖（`oklch(55.3% 0.013 58.071)`）。**同一阶号换家族，对比度几乎不变，变的只是冷暖**——这正是「5 套主题共用一套结构、只换色相」的可行基础。
- **官方示例的配对方式是「浅底深字 / 深底浅字」显式写两遍**：`bg-white dark:bg-gray-800`、`text-gray-700 dark:text-gray-400`。它不提供语义层，语义层要自己建。
- **暗色里边框常用透明度降权**：`border-pink-300 dark:border-pink-300/10`。**这一点不能照抄**——边框若承担控件边界识别，降到 10% 不透明度基本必然跌破 3:1（见 §2.4）。

### 1.2 Radix Colors：12 阶的「角色剧本」

来源：[radix-ui.com/colors/docs/palette-composition/understanding-the-scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)。

| 阶 | 角色 | 对应我们的 token |
| --- | --- | --- |
| 1 | App background | `canvas` |
| 2 | Subtle background | `surface`（卡片底） |
| 3 | UI element background（常态） | 悬停/输入框底 |
| 4 | Hovered UI element background | — |
| 5 | Active / Selected UI element background | 选中态 |
| 6 | Subtle borders / separators | `line`（装饰性分隔线） |
| 7 | UI element border / focus ring | — |
| 8 | Hovered border / stronger border | `line-strong`（控件边界） |
| 9 | Solid backgrounds（最高彩度） | `accent`（填充块） |
| 10 | Hovered solid | — |
| 11 | Low-contrast text | `ink-faint` / `ink-soft` |
| 12 | High-contrast text | `ink` |

三个可直接借用的结论：

1. **第 6 阶和第 8 阶是两种不同的边框**：6 是「非交互容器的分隔线」（卡片、表头、侧栏），8 是「交互控件的边框」。前者不承担信息传达，后者承担。**只有后者受 SC 1.4.11 约束。** 这一区分我在本文的 token 里落成 `line` 与 `line-strong` 两个名字。
2. **第 9 阶是「纯色块」，不是文字色**。文档明确说 Sky / Mint / Lime / Yellow / Amber 的第 9 阶是**为深色前景设计的**（即这些色块上要用深色字）。这解释了为什么「高饱和强调色 + 白字」经常翻车。
3. **11/12 阶的保证是 APCA Lc 60 / Lc 90，不是 WCAG 比值**。APCA 与 WCAG 2 的比值不可互换。我实测了 8 个色相：

   | 色相 | light 11 在 2 阶上 | light 12 在 2 阶上 | dark 11 在 2 阶上 | dark 12 在 2 阶上 |
   | --- | ---: | ---: | ---: | ---: |
   | gray | 5.62 | 15.48 | 8.48 | 15.15 |
   | blue | 4.53 | 12.00 | 8.38 | 13.47 |
   | red | 4.94 | 11.78 | 8.56 | 13.20 |
   | amber | **4.43** | 10.93 | 11.52 | 14.57 |
   | green | **4.49**（未舍入 4.4963，仍 < 4.5） | 11.72 | 9.37 | 13.65 |
   | violet | 5.86 | 12.75 | 8.52 | 13.56 |
   | purple | 5.75 | 12.45 | 8.41 | 13.37 |
   | pink | 5.01 | 11.47 | 8.50 | 13.25 |

   **amber-11（4.43:1）和 green-11（4.4963:1）在白/近白底上不满足 WCAG AA 正文 4.5:1。** green-11 尤其能说明「不许四舍五入」：它显示为 4.50，但真实值 4.4963 小于 4.5，按 SC 1.4.3 就是不达标。这不是说 Radix 做错了（它按 APCA 标定），而是说：**直接搬一套现成色阶就宣称「无障碍」是不可靠的，必须按自己的背景色重算。** 本文 5 套主题的所有文字色都是按各自 `canvas`/`surface` 重算过的。

   > 脚本口径：`contrast-audit.mjs` 用**未舍入的原始比值**与阈值比较（`ratio >= min`），只在展示时保留两位。所以 green-11 会显示 4.50 但判为不通过——这是刻意设计，与 SC 1.4.11 文档 "values aren't rounded" 一致。

### 1.3 Material Design 3：color roles + tone

M3 的机制是「**色相 → 色调板（tone 0–100）→ 角色（role）**」，角色永远是成对的。我直接从 Material Web 的官方 token 文件读到了映射（`tokens/versions/v0_192/_md-sys-color.scss`）：

| 角色 | 浅色 | 深色 |
| --- | --- | --- |
| `primary` | primary **40** | primary **80** |
| `on-primary` | primary **100** | primary **20** |
| `primary-container` | primary **90** | primary **30** |
| `on-primary-container` | primary **10** | primary **90** |
| `surface` | neutral **98** | neutral **6** |
| `on-surface` | neutral **10** | neutral **90** |
| `surface-variant` | neutral-variant **90** | neutral-variant **30** |
| `on-surface-variant` | neutral-variant **30** | neutral-variant **80** |
| `outline` | neutral-variant **50** | neutral-variant **60** |
| `outline-variant` | neutral-variant **80** | neutral-variant **30** |
| `error` | error **40** | error **80** |
| `on-error` | error **100** | error **20** |
| `surface-container-lowest` | neutral **100** | neutral **4** |
| `surface-container-low` | neutral **96** | neutral **10** |
| `surface-container` | neutral **94** | neutral **12** |
| `surface-container-high` | neutral **92** | neutral **17** |
| `surface-container-highest` | neutral **90** | neutral **22** |

三个可借用的设计决策：

1. **`on-*` 是配对约定，不是颜色名。** 任何承载内容的表面都必须有配套的 `on-` 前景。我们的 `on-accent` 直接来自这个约定。
2. **浅色用 40、深色用 80 的「镜像」不是对称的**：40 在深色底上会太暗，80 在浅色底上会太亮，所以必须换阶而不是调透明度。
3. **深色的「抬升」靠 `surface-container-*` 的 tone 递进（6 → 12 → 17 → 22），不靠阴影。** 深色里阴影几乎不可见，靠「表面变亮」表达层级。我的 5 套深色主题因此让 `surface` 比 `canvas` 亮 4–8 个 OKLCH 亮度点，而不是加深色阴影。

### 1.4 shadcn/ui：最贴近工程实现的约定

来源：[ui.shadcn.com/docs/theming](https://ui.shadcn.com/docs/theming)。

- **成对 token**：`background`/`foreground`、`card`/`card-foreground`、`popover`/`popover-foreground`、`primary`/`primary-foreground`、`secondary`/`secondary-foreground`、`muted`/`muted-foreground`、`accent`/`accent-foreground`、`destructive`、`border`、`input`、`ring`、`chart-1..5`、`sidebar-*`。
- **格式用 OKLCH**，默认 scaffold 里 `background: oklch(1 0 0)`、`foreground: oklch(0.145 0 0)`、`border: oklch(0.922 0 0)`。
- **深色就是重声明同一批变量**（`.dark { ... }`），不是另起一套名字。
- **Tailwind v4 的接法是 `@theme inline`**：把 `--primary` 别名成 `--color-primary`，这样 `bg-primary` 才可用，而真实值仍留在 `:root` / `.dark` 里可改。

**这就是本文推荐的落地方式**：`--color-*` 只做别名，主题切换只改 `:root[data-theme]` 下的一批值。

### 1.5 Khan Academy 的 Wonder Blocks（教育产品里少见的公开设计系统）

来源：[github.com/Khan/wonder-blocks](https://github.com/Khan/wonder-blocks)，文件 `packages/wonder-blocks-tokens/src/tokens/color.ts` 与 `src/theme/semantic/semantic-color.ts`。

它的结构是**三层**：primitive（`blue: #1865f2`、`green: #00a60e`、`gold: #ffb100`、`red: #d92916`、`offBlack: #21242c`、`offWhite: #f7f8fa`、`darkBlue: #0b2149`、`teal: #14bf96`）→ semantic（`background.base.subtle/default/strong`、`foreground.neutral.subtle/default/strong`、`border.instructive/critical/success/warning/disabled`）→ 组件。

关键点是**语义层按「意图」而不是「颜色」命名，并且每个意图都有 subtle / default / strong 三档**。例如 `foreground.neutral.subtle = offBlack 64%`、`default = 72%`、`strong = 100%`。这正好对应我们的 `ink-faint` / `ink-soft` / `ink` 三档。

值得注意：它用 `offBlack #21242c`（不是纯黑）、`offWhite #f7f8fa`（不是纯白）。实测 `#21242c` on `#f7f8fa` = **14.60:1**——**不靠纯黑纯白也能轻松超过 AAA 7:1**。这是本文 4 套常规主题不采用纯黑/纯白的依据。

### 1.6 横向对比：这套 token 该长什么样

| 概念 | Tailwind | Radix | MD3 | shadcn | Wonder Blocks | 本文采用 |
| --- | --- | --- | --- | --- | --- | --- |
| 页面底 | `bg-white` | 1 阶 | `surface` | `background` | `background.base` | `canvas` |
| 卡片底 | `bg-gray-50` | 2 阶 | `surface-container-*` | `card` | `background.base.subtle` | `surface` |
| 正文 | `text-gray-950` | 12 阶 | `on-surface` | `foreground` | `foreground.neutral.strong` | `ink` |
| 次要文字 | `text-gray-700` | 11 阶 | `on-surface-variant` | `muted-foreground` | `foreground.neutral.default` | `ink-soft` |
| 提示文字 | `text-gray-500` | 11 阶 | `on-surface-variant` | `muted-foreground` | `foreground.neutral.subtle` | `ink-faint` |
| 分隔线 | `border-gray-200` | 6 阶 | `outline-variant` | `border` | `border.neutral.subtle` | `line` |
| 控件边框 | `border-gray-400` | 8 阶 | `outline` | `input` | `border.neutral.default` | `line-strong` |
| 强调 | `bg-blue-600` | 9 阶 | `primary` | `primary` | `background.instructive.default` | `accent` |
| 强调浅底 | `bg-blue-50` | 3 阶 | `primary-container` | `accent` | `background.instructive.subtle` | `accent-soft` |
| 强调块上的字 | `text-white` | — | `on-primary` | `primary-foreground` | `foreground.knockout` | `on-accent` |
| 成功/警告/错误 | `green-*` / `amber-*` / `red-*` | 对应色相 | `error` 等 | `destructive` | `*.success/warning/critical` | `good` / `warn` / `bad` |

**深色映射的三条规则**（四家一致）：
1. **换阶，不换名**：`canvas` 从 near-white 换成 near-black，但 token 名不变。
2. **不是取反**：Radix 单独生成 dark scale；MD3 把 98 换成 6、40 换成 80；暗色的强调色要**提亮**（我的深色 `accent` 全部是浅色版的提亮版，实测 8.9–11.1:1）。
3. **层级靠亮度递进，不靠阴影**：MD3 的 `surface-container` 系列、Radix 的 1→2→3 阶都是这个思路。

---

## 2. 无障碍硬指标（WCAG 2.2）

### 2.1 四档对比度要求

| 要求 | 比值 | 条款 | 等级 | 适用 |
| --- | ---: | --- | --- | --- |
| 正文对比度（最低） | **4.5:1** | **SC 1.4.3** Contrast (Minimum) | AA | 正文与正文级图片文字 |
| 大字对比度（最低） | **3:1** | **SC 1.4.3** 同条 | AA | 大字与大字级图片文字 |
| 非文本对比度 | **3:1** | **SC 1.4.11** Non-text Contrast | AA | 控件视觉信息、图形对象（图标、进度条、图表） |
| 正文对比度（增强） | **7:1** | **SC 1.4.6** Contrast (Enhanced) | AAA | 正文 |
| 大字对比度（增强） | **4.5:1** | **SC 1.4.6** 同条 | AAA | 大字 |

来源：[Understanding SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[Understanding SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)、[Understanding SC 1.4.6](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html)。

**「大字」的定义**：至少 18pt，或 14pt 加粗；CJK 取「等效字号」。1pt = 1.333px，所以 14pt ≈ 18.5px、18pt ≈ 24px。原文特别写了 *"at least 18 point or 14 point bold or font size that would yield equivalent size for Chinese, Japanese and Korean (CJK) fonts"*——**中文没有单独的官方像素阈值**，实操中按 18.5px / 24px 处理即可。

**阈值不许四舍五入**：1.4.11 的 Understanding 文档明确写 "values aren't rounded, so 2.999:1 fails"。同理 4.499:1 不满足 4.5:1。

### 2.2 容易被忽略的相邻条款

| 条款 | 要求 | 对本项目的约束 |
| --- | --- | --- |
| **SC 1.4.12** Text Spacing（AA） | 行高 ≥ 1.5×、段距 ≥ 2×、字距 ≥ 0.12×、词距 ≥ 0.16× 时不得丢失内容 | 正文行高取 1.75，天然满足；不要把行高写死成 `px` |
| **SC 1.4.8** Visual Presentation（AAA） | 行宽 ≤ 80 字符（**CJK ≤ 40 字**）、行距 ≥ 1.5、段距 ≥ 1.5× 行距、两端对齐禁用、可缩放到 200% 不横向滚动 | **中文正文容器 `max-width: 36em` 左右**（约 36 汉字/行），正好落在 40 字以内 |
| **SC 2.5.8** Target Size（AA） | 指针目标 ≥ 24×24 CSS px | 知识点节点、主题切换按钮、进度条拖拽点 |
| **SC 2.4.13** Focus Appearance（AAA） | 焦点指示器 ≥ 2px 厚周长面积，且与未聚焦态对比 ≥ 3:1 | 现有 `:focus-visible` 的 `2px solid accent` 方向正确，但 **accent 必须对背景 ≥3:1**，本文已全部验证 ≥6:1 |

### 2.3 教育产品里最容易翻车的四处

**① 提示文字（placeholder / helper text / 时间戳）**

这是最普遍的问题。设计稿里常见的 `#999` on `#fff` 只有 **2.85:1**，连 AA 都不到，更别说 4.5:1。它在 WCAG 里**仍然算文字**（除非是纯装饰），没有豁免。

本文的处理：`ink-faint` 一律按 **4.5:1** 要求，实测最低 **4.70:1**（森林浅色）。这比多数产品严格——很多产品把提示文字做成 3:1 左右。

**② 禁用态（disabled）**

SC 1.4.3 和 1.4.11 都**豁免了 inactive/disabled 组件**。但教育产品有个真实陷阱：**「禁用」和「未开始」在视觉上容易混淆**。如果学生分不清「这题我做不了」和「这题我还没做」，那就是信息传达失败。

本文建议：禁用态**不靠降低对比度表达**，而靠「去色 + 加斜纹/锁图标 + `aria-disabled`」表达。文字仍保持 ≥4.5:1，只是彩度归零。这样既满足可用性，也不违反「禁用态可豁免」的宽松条款。

**③ 进度条填充 vs 轨道**

这是 SC 1.4.11 的典型图形对象：进度条是「理解内容所必需的图形」，填充与轨道必须 **≥3:1**。常见错误是 `#e5e7eb` 轨道 + `#3b82f6` 填充，看起来很清爽，但一旦轨道再浅一点就跌破 3:1。

本文的处理：`accent` 作填充、`accent-soft` 作轨道，实测 **5.23–9.14:1**，远超 3:1。**注意**：如果你的轨道用的是 `line`（分隔线灰），那就必须重算——本文的 `line` 是装饰性的，实测只有 1.20–1.49:1，**不能用作进度条轨道**。

**④ 掌握度/置信区间的语义色**

自适应学习界面会同时出现「已掌握（绿）」「进行中（黄）」「有风险（红）」。三种颜色**不能只靠色相区分**（红绿色盲约 8% 男性）。必须叠加图标或文字标签。本文的 `good`/`warn`/`bad` 全部 ≥6.39:1，但**颜色只是第二编码**。

### 2.4 一个必须说清的区别：`line` vs `line-strong`

| token | 用途 | 是否受 SC 1.4.11 | 本文实测 |
| --- | --- | --- | --- |
| `line` | 卡片分隔线、表格横线、装饰性描边 | **否**（不传达信息） | 1.20–4.12:1 |
| `line-strong` | 输入框边框、按钮描边、**唯一的分隔手段** | **是**（≥3:1） | 3.26–7.00:1 |

SC 1.4.11 明确写：如果控件已由文字或其他对比线索识别，**不强制要求边框**；反过来，**如果边框是识别控件的唯一线索，它就必须 ≥3:1**。

高对比主题里 `canvas` 与 `surface` 同色（都是 `#ffffff`），此时边框是唯一的分层手段，所以那套主题的 `line` 我提到了 **3.23:1 / 4.12:1**，而非常规主题的 1.2–1.5:1。

---

## 3. 教育/学习产品的配色实践

### 3.1 实测的品牌色

我从各家站点与公开设计系统里取到真实色值，并**用同一套公式算了它们的对比度**：

| 产品 | 颜色 | 用途 | 对白底对比度 | 结论 |
| --- | --- | --- | ---: | --- |
| **Duolingo** | `#58cc02` Feather Green | 主品牌绿 | **2.09:1** | 只能做色块/图形，不能做正文或按钮上的白字 |
| Duolingo | `#1cb0f6` Macaw | 次要蓝 | 2.44:1 | 同上 |
| Duolingo | `#ffb100` | 金色 | **1.82:1** | 同上 |
| Duolingo | `#ff7878` | 红 | 2.56:1 | 同上 |
| Duolingo | `#ce82ff` | 紫 | 2.54:1 | 同上 |
| **Khan Academy** | `#1865f2` | 品牌蓝 | 5.02:1 | 可做正文链接 |
| Khan Academy | `#00a60e` | 绿 | **3.25:1** | 不够 4.5:1，只能做图形 |
| Khan Academy | `#ffb100` | 金 | 1.82:1 | 图形 |
| Khan Academy | `#d92916` | 红 | 4.91:1 | 勉强可做正文 |
| Khan Academy | `#21242c` offBlack | 正文 | **15.52:1** | 正文用这个 |
| **Coursera** | `#0056d2` blue-800 | 主蓝 | **6.44:1** | 可做链接 |
| Coursera | `#5e6f92` grey-600 | 次要文字 | 5.04:1 | 可做次要文字 |
| Coursera | `#804ee4` purple-600 | 紫 | 5.09:1 | 可做链接 |
| **Brilliant** | `#f5f3f1` | 页面底（暖白） | 黑字 18.97:1 | 暖中性底 + 黑字 |

**关键观察：Duolingo 的 5 个品牌色，对白底的对比度全部在 1.8–2.6:1 之间。** 它显然不是拿来当文字色的。Duolingo 的 CSS 里有一整套以动物命名的中性色变量（`--color-eel`、`--color-wolf`、`--color-hare`、`--color-swan` 等，共 74 个 `--color-*` 变量），正文用的是这些深灰阶；品牌绿只出现在按钮块、进度环、角色 IP 和庆祝动画上。**这些中性阶的具体色值在其压缩后的 CSS 中未直接展开，本文未取到，故不做数值引用。**

这解释了一个常见误解：**「教育产品用高饱和色」说的是品牌层与反馈层，不是阅读层。** 两者必须分开管理——这也是本文把 `accent`（可做文字，≥4.5:1）和 `accent-soft`（浅色块底）分开的原因。

### 3.2 为什么教育产品普遍用暖色/高饱和强调色

有三个可验证的理由，和一个需要澄清的：

**① 高饱和色承担「反馈」功能，不承担「阅读」功能。**
Duolingo 的绿色出现在答对、连击、进度环；红色出现在扣血。这类反馈需要**瞬间可辨识**，所以用最高彩度的 9 阶（Radix 的 solid 阶）。阅读区则保持中性。这是「颜色分区」而非「整体高饱和」。

**② 色相会影响任务表现，但方向取决于任务类型——有实验依据。**
Mehta & Zhu (2009, *Science*, DOI [10.1126/science.1169144](https://doi.org/10.1126/science.1169144))：红色（vs 蓝色）诱发回避动机，**红色提升细节型任务表现，蓝色提升创造性任务表现**（研究 2/3，n=208 与 118）。

需要说清边界：该研究比较的是**红 vs 蓝**，不是「暖 vs 冷」的普遍规律，也不涉及「背景色」。可迁移的推论只有一条：**强调色的色相应当匹配当前任务类型**——刷题/校对类用暖色强调，探索/写作类用冷色强调。这对应本文「暖砂」与「紫罗兰」两套的性格差异。**不要把它引申成「暖色背景提高学习效率」**，那是过度解读。

**③ 高彩度提升「品牌记忆」，但会牺牲长时间舒适度。**
这是设计上的取舍，不是研究结论。所以正确做法是：**强调色高彩度，但面积小**（按钮、进度、徽章），大面积（canvas、surface）保持低彩度中性。

**需要澄清的一点**：没有可靠证据表明「暖色背景更护眼」。见 §3.3。

### 3.3 长时间阅读：背景该偏冷还是偏暖？

这个问题要拆成两问，答案不同。

**问一：浅底深字 vs 深底浅字（极性）？**

**有明确证据支持浅底深字（正极性）在短期阅读上更优：**

| 研究 | 结论 |
| --- | --- |
| Piepenbrock et al. (2013), *Ergonomics* | 正极性在视力敏度与校对任务上全面优于负极性；**字号越小，优势越大**（*Human Factors* 后续研究：优势随字号减小线性增大） |
| Dobres et al. (2017), *Applied Ergonomics* | 浅色模式整体更快；夜间场景浅色显著更优 |
| Buchner & Baumgartner (2007), *Ergonomics*, DOI [10.1080/00140130701306413](https://doi.org/10.1080/00140130701306413) | 极性效应独立于环境照度与色彩对比度存在 |
| Aleman et al. (2018), *Scientific Reports* | 持续浅色阅读 1 小时后脉络膜变薄，**提示长期浅色可能与近视相关** |
| Legge et al. (1985) | 白内障等屈光介质混浊者**深色模式读得更快**；中心视力受损者无极性效应 |

综合（NN/g 的结论）：**不要把深色设为默认，但要提供切换**；尤其长文阅读类应用应当提供深色。来源：[nngroup.com/articles/dark-mode](https://www.nngroup.com/articles/dark-mode/)。

→ 对本文的含义：**默认浅色，深色作为一等公民提供**，而不是「深色是附赠的」。

**问二：暖中性 vs 冷中性（色温）？**

**没有可靠证据表明某个色温对所有人更护眼。** 我查到的相关说法有两类：

1. **彩色滤镜/覆盖片（Irlen 综合征）**：Wikipedia 的条目明确写该病症「is not supported by scientific evidence」，RANZCO 2018 声明「没有科学证据表明 Irlen 综合征存在」，WHO / AAO / AAP 均不承认。**所以「米黄色底一定更护眼」缺乏证据支持。**
2. **个体差异**：对对比度敏感的人群（含部分阅读障碍者）确实有个体化的偏好，但**没有普适最优色**。WCAG SC 1.4.8 因此要求「用户能自行选择前景/背景色」，而不是规定某个颜色。

→ 对本文的含义：**色温是性格与审美选择，不是健康声明。** 5 套主题里 3 套暖/中性、2 套冷，让用户按场景选，比论证「哪个更科学」更诚实。**文档与 UI 里都不要写「护眼」二字**——那是无依据的医疗声称。

**一个可用的中间结论**：如果只能选一个默认，选**近白但非纯白、略偏暖或中性的底**（如 `#faf6ef` / `#f6f8fb`），理由是它把「纸张感」和「屏幕高亮刺眼」折中，且不损失正极性优势。这也是 Khan（`#f7f8fa`）、Brilliant（`#f5f3f1`）实际在做的事。

### 3.4 可汗学院中文版

`zh.khanacademy.org` 与主站共用同一套 Wonder Blocks token（站点返回 "Client Challenge" 反爬页，未能取到渲染后的样式；但 Wonder Blocks 是同一仓库的公开设计系统，色值见 §1.5）。中文版没有独立配色，**这本身是一个结论：教育产品做国际化时，配色系统不随语言变，排版规则才随语言变。**

---

## 4. 中文界面的排版约束

### 4.1 行高

**中文需要比西文更大的行高。** 原因不是审美，是字形：

- clreq（W3C 中文排版需求）§6.4 指出：**汉字是等宽等高的正方形字框，字面（实际笔画区域）居中且四周留白**，字号即字框尺寸。西文有升部/降部，行距的一部分被字形的自然起伏「吃掉」；中文每个字都撑满字框，行与行之间没有天然呼吸空间。来源：[w3.org/TR/clreq](https://www.w3.org/TR/clreq/)。
- clreq §6.4 本身**没有给出正文字号/行高的数值**（我核对了原文，该节只定义了字框、字面、字幅三个概念）。所以数值要靠实证研究。

**实证依据**：Chan, Tsang & Ng (2014), *Human Factors* 56(3):521–534, DOI [10.1177/0018720813499368](https://doi.org/10.1177/0018720813499368)，研究屏幕中文校对的三个显示因素。结论原文：

> "For balancing time and detection rate and improving performance for on-screen Chinese proofreading, the display setting of medium line length (**36 characters per line**) with four lines and **1.5 line spacing** should be used."

这是我能找到的最直接的中文屏幕阅读行距证据：**1.5 倍行距 + 每行 36 字**。

**工程取值建议**：

| 场景 | 字号 | 行高 | 说明 |
| --- | --- | --- | --- |
| 正文（长段落） | 16px | **1.75**（28px） | 高于研究的 1.5，因为 Web 阅读距离更近、且要给 SC 1.4.12 留余量 |
| 正文（紧凑列表） | 15–16px | 1.6 | 低于 1.6 中文会「粘行」 |
| 次要说明 | 14px | 1.6 | — |
| 提示/元信息 | 13px | 1.5 | 13px 是中文可读下限，再小笔画会糊 |
| 标题 | 20–28px | 1.35–1.45 | 中文标题行高可比正文紧 |
| 数字/代码 | — | 1.5 | 用 `tabular-nums` 对齐 |

Ant Design 的中文规范给的是 14px / 22px（≈1.57），但它面向**后台管理界面**（短文本、高密度），不是长文阅读。本项目是学习阅读场景，取 16/1.75 更合适。

### 4.2 字号

- **正文建议 16px。** 中文在 14px 时，横画已经很细，1x 屏上容易发虚——这是工程经验判断，不是实验结论。
- **13px 作为元信息下限**（时间、哈希、计数），正文不要用。同样属于经验值。
- **字号必须用相对单位**（`rem`），用户放大到 200% 时布局不能崩（SC 1.4.8）。

### 4.3 字重

- **中文正文 400 起，深色模式 450–500。** 原因见 §4.4。
- **不要用 300 及以下做中文正文。** 中文 Light 字重的横画在 16px 下通常不足 1 物理像素，会被抗锯齿「抹平」。
- **中文标题可用 600–700**，但不要 800+：中文超粗字重的字怀（counter）会被挤没，反而降低辨识。
- Ant Design 的建议是「一般只需 regular(400) 与 medium(500)，英文可用 semibold(600)」——对中文同样成立。

### 4.4 深色背景下的中文可读性

**症状**：深色底上的浅色中文看起来「发虚」「发胖」「笔画粘连」，小字尤其明显。

**成因有三层**：

1. **光晕/泛光（halation / blooming）**：亮字在暗底上，人眼与显示器的光学扩散会让亮部向暗部「溢出」，细笔画先被淹没。这是**对比度越高越明显**的现象——所以「纯白 on 纯黑」是中文小字最差的组合之一。web.dev 的 prefers-color-scheme 指南给了同一方向的经验建议：*"Avoid pure white"*，作者用 `rgb(250,250,250)` 减少 glowing/bleeding。来源：[web.dev](https://web.dev/articles/prefers-color-scheme)。
2. **字重不足**：中文横画在常规字重下很细，深色底上细笔画的有效亮度更低，抗锯齿会把它们渲染成半透明灰。
3. **抗锯齿模式退化**：深色背景下字体渲染更容易转为灰度抗锯齿，横向清晰度下降。**这是平台/字体栈行为，CSS 无法直接修复**——只能靠字重和颜色补偿。

> 证据分级：第 1 条有公开设计指南支撑（方向性建议，非对照实验）；第 2 条是字形与渲染的机制推断；第 3 条我**没有取到可引用的权威来源**，属于工程经验，按「假设」对待。本文的取值不依赖第 3 条是否成立——①②③④ 四条对策在任一成因下都成立。

**对策（按有效性排序）**：

| 措施 | 做法 | 依据/说明 |
| --- | --- | --- |
| **① 不用纯白** | 深色正文用 `#f3ecdf` / `#e8eef7` 一类「带一点色相的近白」，对比度落在 **14–17:1** | web.dev 的 prefers-color-scheme 指南明确建议 "Avoid pure white"，作者用 `rgb(250,250,250)` 减少 glowing/bleeding |
| **② 不用纯黑底** | 深色 canvas 用 `#17140f` / `#0d1219` 一类 near-black | MD3 深色 surface 是 neutral 6（`#141218`），不是 `#000`；避免纯黑也让「抬升」有空间 |
| **③ 深色正文加字重** | `font-weight: 450`（可变字体）或 500 | 补偿灰度抗锯齿导致的笔画变细 |
| **④ 控制对比度上限** | 正文目标 **12–16:1**，不要 21:1 | 对比度越高，halation 越强。AAA 要求 7:1，做到 21:1 是过度 |
| **⑤ 字号下限 15px** | 深色正文不小于 15px | 小字 + 深色 = 最差组合 |
| **⑥ 字距微调** | 深色下 `letter-spacing: 0.01em` | 补偿光晕造成的视觉粘连；不要超过 0.02em，会破坏中文方块节奏 |

**注意**：高对比主题（`#000` / `#fff`，21:1）是**故意**违反上述 ① ② ④ 的。它是为低视力用户提供的**极端选项**，不是默认。默认 4 套都遵守上面的规则。这个取舍必须在文档里写清，否则会被当成「设计不一致」。

**我做了实际渲染验证**：用 Playwright 以 2x DPR 渲染 16px 中文正文 + 15px 次要文字 + 13px 提示文字，在「暖砂深色」（`#f3ecdf` on `#17140f`，15.63:1）与「高对比深色」（`#fff` on `#000`，21:1）两套下对比。前者笔画干净，后者 13px 提示文字已能看出轻微泛光。**结论与上表一致：日常深色用 14–17:1，21:1 只留给无障碍主题。**

### 4.5 中文特有的三个细节

1. **中英混排要加空隙**：`数据 68%` 比 `数据68%` 易读。CSS 可用 `text-spacing-trim`（新）或手动在数字前后留 `0.15em`。clreq §6.3.3 讨论了混排配置。
2. **行宽 ≤ 40 汉字**（SC 1.4.8 对 CJK 的明确要求，是西文 80 字符的一半）。`max-width: 36em` 对应约 36 汉字。
3. **标点挤压**：中文标点占满一个字宽，行首行尾会出现大片空白。`text-spacing-trim: trim-start`（Chrome 123+）可缓解；不支持时用 `hanging-punctuation` 降级。

---

## 5. 五套主题的完整色值

### 5.1 设计原则

1. **每套 12 个 token**：题目要求的 10 个 + 2 个工程必需（`line-strong` 控件边框、`on-accent` 强调块上的字）。
2. **正文对 canvas 与 surface 都 ≥7:1**（AAA），高对比主题 ≥10:1。
3. **次要文字 ≥4.5:1，提示文字也 ≥4.5:1**（比多数产品严格，因为提示文字在教育产品里承载「为什么」的解释）。
4. **浅色 `accent` 是深色文字色，深色 `accent` 是浅色文字色**——两版都能直接做链接文字用。
5. **深色 `surface` 比 `canvas` 亮**（MD3 的抬升逻辑），不是靠阴影。
6. **常规 4 套不用纯黑纯白**，高对比主题故意用纯黑纯白。

### 5.2 色值总表

| 主题 | 模式 | canvas | surface | ink | ink-soft | ink-faint | line | line-strong | accent | accent-soft | on-accent | good | warn | bad |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 暖砂 | 浅 | `#faf6ef` | `#fffcf7` | `#1f1a14` | `#544a3d` | `#736656` | `#e6ddcf` | `#8d8172` | `#9a4410` | `#f6e3cd` | `#ffffff` | `#1a6236` | `#7d5105` | `#99251b` |
| 暖砂 | 深 | `#17140f` | `#211d17` | `#f3ecdf` | `#cdc2b1` | `#a2957f` | `#37312a` | `#7d7365` | `#eaa76a` | `#3a2919` | `#2a1a08` | `#7dd39d` | `#e6c273` | `#f39b90` |
| 森林 | 浅 | `#f4f7f2` | `#fcfdfb` | `#15201a` | `#45564b` | `#5f7367` | `#dbe4db` | `#778a7c` | `#1c6643` | `#d9eede` | `#ffffff` | `#15603a` | `#775006` | `#9a2822` |
| 森林 | 深 | `#0f1612` | `#17211b` | `#e7f1e8` | `#b9cbbd` | `#93a696` | `#2a3830` | `#6f8274` | `#71cd9b` | `#1c3227` | `#082415` | `#75d49e` | `#e0bb70` | `#f2968d` |
| 深蓝 | 浅 | `#f6f8fb` | `#ffffff` | `#121821` | `#43506a` | `#616f86` | `#dce3ed` | `#77869d` | `#1c47c4` | `#e2eafd` | `#ffffff` | `#12603c` | `#745006` | `#9d2530` |
| 深蓝 | 深 | `#0d1219` | `#151c26` | `#e8eef7` | `#b4c0d2` | `#8b99ad` | `#28313d` | `#6d7c91` | `#93b2ff` | `#1a2740` | `#0a1730` | `#70d3a0` | `#dfba70` | `#f39aa1` |
| 紫罗兰 | 浅 | `#f9f7fc` | `#fffefe` | `#1a1523` | `#4e4560` | `#6e6480` | `#e5e0ed` | `#8f85a3` | `#6524cf` | `#eee3fd` | `#ffffff` | `#14603a` | `#725006` | `#9b2333` |
| 紫罗兰 | 深 | `#121019` | `#1b1724` | `#eee9f7` | `#c4bbd4` | `#9a90ab` | `#322b41` | `#786d8c` | `#c3a6ff` | `#2a2040` | `#1a0f33` | `#70d39c` | `#dfba70` | `#f49aa8` |
| 高对比 | 浅 | `#ffffff` | `#ffffff` | `#000000` | `#2b2b2b` | `#4a4a4a` | `#8f8f8f` | `#595959` | `#00309e` | `#e4eaff` | `#ffffff` | `#00542a` | `#523700` | `#900d17` |
| 高对比 | 深 | `#000000` | `#0c0c0c` | `#ffffff` | `#e6e6e6` | `#c2c2c2` | `#6e6e6e` | `#8f8f8f` | `#9dbcff` | `#101a33` | `#00102e` | `#63dd9f` | `#f2cf80` | `#ffa0a0` |

### 5.3 各主题的性格与适用场景

**① 暖砂（Sand）· 沉稳阅读**
`#faf6ef` 暖纸底 + 陶土橙 `#9a4410`。低彩度暖中性，接近纸质书；强调色取砖橙而非亮黄，避免与「警告」混淆。**默认主题**，适合长文讲解、题解阅读、每日学习流。深色版是暖炭黑（`#17140f`），不是冷灰，夜间不刺眼。

**② 森林（Forest）· 专注沉静**
`#f4f7f2` 冷绿灰底 + 苔绿 `#1c6643`。绿色在 UI 里天然关联「正确/通过」，用在教育产品上有语义优势；但主绿刻意压暗到 **6.41:1**（对 canvas），与 `good` 的 7.03:1 拉开层次，避免「强调色」和「成功态」分不清。适合刷题、限时练习、需要降低唤醒的场景。

**③ 深蓝（Indigo）· 专业理性**
`#f6f8fb` 蓝灰底 + 靛蓝 `#1c47c4`。最接近学术出版物与 IDE 的观感，克制、信息密度高。适合知识点图谱、路径编辑、教师端看板。深色版 `#0d1219` 是本文 5 套里最「冷」的底。

**④ 紫罗兰（Violet）· 创意**
`#f9f7fc` 淡紫底 + `#6524cf`。呼应 §3.2 的 Mehta & Zhu 结论——该研究中**蓝色**提升创造性任务，紫罗兰是蓝向红的延伸，取它的「创造性」联想而避开蓝色的通用感（注意：研究只验证了红/蓝，紫罗兰是设计上的延伸，不是研究结论）。适合概念探索、开放题、写作类任务。紫色也是教育产品里较少见的色相，有辨识度。

**⑤ 高对比（Contrast）· 无障碍优先**
纯白/纯黑，正文 **21:1**。为低视力、强光环境（户外）、低质量投影仪准备。**代价**：`canvas` 与 `surface` 同色，层级只能靠边框（所以 `line` 提到 3.23:1）；深色下 21:1 会加剧 halation，**不建议作为日常默认**。

---

## 6. 对比度验证结果

> 全部由 `research/tools/contrast-audit.mjs` 计算。公式严格按 WCAG 2.2 定义，阈值不四舍五入。
> 复现：`node research/tools/contrast-audit.mjs`（汇总）/ `--markdown`（全表）。

### 6.1 五套主题横向汇总

| 主题 / 模式 | 正文/底 | 正文/卡片 | 次要/底 | 提示/底 | 控件边框/底 | 强调/底 | 强调块文字 | 语义最低 | 最低必需项 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 暖砂 · 浅 | **16.03** | 16.87 | 8.04 | 5.18 | 3.53 | 6.08 | 6.55 | 6.39 | **3.53** |
| 暖砂 · 深 | **15.63** | 14.27 | 10.45 | 6.25 | 3.60 | 8.95 | 8.19 | 8.66 | **3.60** |
| 森林 · 浅 | **15.50** | 16.42 | 7.24 | 4.70 | 3.40 | 6.41 | 6.93 | 6.62 | **3.40** |
| 森林 · 深 | **15.86** | 14.29 | 10.79 | 7.11 | 4.03 | 9.54 | 8.57 | 8.33 | **4.03** |
| 深蓝 · 浅 | **16.75** | 17.82 | 7.61 | 4.78 | 3.47 | 7.18 | 7.64 | 6.82 | **3.47** |
| 深蓝 · 深 | **16.11** | 14.69 | 10.21 | 6.49 | 4.03 | 8.99 | 8.53 | 8.90 | **4.03** |
| 紫罗兰 · 浅 | **16.79** | 17.75 | 8.42 | 5.20 | 3.26 | 7.29 | 7.76 | 6.89 | **3.26** |
| 紫罗兰 · 深 | **15.83** | 14.76 | 10.24 | 6.24 | 3.65 | 9.17 | 8.81 | 9.01 | **3.65** |
| 高对比 · 浅 | **21.00** | 21.00 | 14.16 | 8.86 | 7.00 | 10.96 | 10.96 | 9.12 | **7.00** |
| 高对比 · 深 | **21.00** | 19.56 | 16.83 | 11.79 | 6.05 | 11.07 | 9.94 | 10.79 | **6.05** |

**关键数字**：
- **正文最低 15.50:1**（要求 7:1），最差也有 2.2 倍余量。
- **次要文字最低 7.24:1**（要求 4.5:1）。
- **提示文字最低 4.70:1**（要求 4.5:1）——这是全文最紧的一项，森林浅色的 `ink-faint`。
- **控件边框最低 3.26:1**（要求 3:1）——紫罗兰浅色。
- **高对比主题正文 21.00:1**（要求 10:1）。
- **210 个检查对（含 20 个参考项），0 失败。**

### 6.2 暖砂

| 检查项（前景 / 背景） | 浅色 | 深色 | 要求 | 条款 |
| --- | ---: | ---: | ---: | --- |
| ink on canvas | **16.03:1** | **15.63:1** | 7:1 | 1.4.6 |
| ink on surface | **16.87:1** | **14.27:1** | 7:1 | 1.4.6 |
| ink-soft on canvas | **8.04:1** | **10.45:1** | 4.5:1 | 1.4.3 |
| ink-soft on surface | **8.47:1** | **9.54:1** | 4.5:1 | 1.4.3 |
| ink-faint on canvas | **5.18:1** | **6.25:1** | 4.5:1 | 1.4.3 |
| ink-faint on surface | **5.45:1** | **5.70:1** | 4.5:1 | 1.4.3 |
| line-strong on canvas | **3.53:1** | **3.95:1** | 3:1 | 1.4.11 |
| line-strong on surface | **3.72:1** | **3.60:1** | 3:1 | 1.4.11 |
| accent on canvas | **6.08:1** | **8.95:1** | 4.5:1 | 1.4.3 |
| accent on surface | **6.40:1** | **8.17:1** | 4.5:1 | 1.4.3 |
| on-accent on accent | **6.55:1** | **8.19:1** | 4.5:1 | 1.4.3 |
| accent on accent-soft | **5.23:1** | **6.77:1** | 4.5:1 | 1.4.3 |
| ink on accent-soft | **13.80:1** | **11.83:1** | 7:1 | 1.4.6 |
| good on canvas | **6.85:1** | **10.21:1** | 4.5:1 | 1.4.3 |
| good on surface | **7.21:1** | **9.32:1** | 4.5:1 | 1.4.3 |
| warn on canvas | **6.39:1** | **10.78:1** | 4.5:1 | 1.4.3 |
| warn on surface | **6.73:1** | **9.84:1** | 4.5:1 | 1.4.3 |
| bad on canvas | **7.40:1** | **8.66:1** | 4.5:1 | 1.4.3 |
| bad on surface | **7.79:1** | **7.90:1** | 4.5:1 | 1.4.3 |
| line on canvas（装饰） | 1.25 | 1.43 | — | 参考 |
| surface on canvas（层次） | 1.05 | 1.10 | — | 参考 |

### 6.3 森林

| 检查项（前景 / 背景） | 浅色 | 深色 | 要求 | 条款 |
| --- | ---: | ---: | ---: | --- |
| ink on canvas | **15.50:1** | **15.86:1** | 7:1 | 1.4.6 |
| ink on surface | **16.42:1** | **14.29:1** | 7:1 | 1.4.6 |
| ink-soft on canvas | **7.24:1** | **10.79:1** | 4.5:1 | 1.4.3 |
| ink-soft on surface | **7.66:1** | **9.72:1** | 4.5:1 | 1.4.3 |
| ink-faint on canvas | **4.70:1** | **7.11:1** | 4.5:1 | 1.4.3 |
| ink-faint on surface | **4.98:1** | **6.41:1** | 4.5:1 | 1.4.3 |
| line-strong on canvas | **3.40:1** | **4.48:1** | 3:1 | 1.4.11 |
| line-strong on surface | **3.60:1** | **4.03:1** | 3:1 | 1.4.11 |
| accent on canvas | **6.41:1** | **9.54:1** | 4.5:1 | 1.4.3 |
| accent on surface | **6.79:1** | **8.59:1** | 4.5:1 | 1.4.3 |
| on-accent on accent | **6.93:1** | **8.57:1** | 4.5:1 | 1.4.3 |
| accent on accent-soft | **5.69:1** | **7.11:1** | 4.5:1 | 1.4.3 |
| ink on accent-soft | **13.75:1** | **11.82:1** | 7:1 | 1.4.6 |
| good on canvas | **7.03:1** | **10.20:1** | 4.5:1 | 1.4.3 |
| good on surface | **7.44:1** | **9.19:1** | 4.5:1 | 1.4.3 |
| warn on canvas | **6.62:1** | **10.06:1** | 4.5:1 | 1.4.3 |
| warn on surface | **7.01:1** | **9.07:1** | 4.5:1 | 1.4.3 |
| bad on canvas | **7.20:1** | **8.33:1** | 4.5:1 | 1.4.3 |
| bad on surface | **7.62:1** | **7.50:1** | 4.5:1 | 1.4.3 |
| line on canvas（装饰） | 1.20 | 1.49 | — | 参考 |
| surface on canvas（层次） | 1.06 | 1.11 | — | 参考 |

### 6.4 深蓝

| 检查项（前景 / 背景） | 浅色 | 深色 | 要求 | 条款 |
| --- | ---: | ---: | ---: | --- |
| ink on canvas | **16.75:1** | **16.11:1** | 7:1 | 1.4.6 |
| ink on surface | **17.82:1** | **14.69:1** | 7:1 | 1.4.6 |
| ink-soft on canvas | **7.61:1** | **10.21:1** | 4.5:1 | 1.4.3 |
| ink-soft on surface | **8.09:1** | **9.31:1** | 4.5:1 | 1.4.3 |
| ink-faint on canvas | **4.78:1** | **6.49:1** | 4.5:1 | 1.4.3 |
| ink-faint on surface | **5.09:1** | **5.92:1** | 4.5:1 | 1.4.3 |
| line-strong on canvas | **3.47:1** | **4.42:1** | 3:1 | 1.4.11 |
| line-strong on surface | **3.70:1** | **4.03:1** | 3:1 | 1.4.11 |
| accent on canvas | **7.18:1** | **8.99:1** | 4.5:1 | 1.4.3 |
| accent on surface | **7.64:1** | **8.20:1** | 4.5:1 | 1.4.3 |
| on-accent on accent | **7.64:1** | **8.53:1** | 4.5:1 | 1.4.3 |
| accent on accent-soft | **6.34:1** | **7.14:1** | 4.5:1 | 1.4.3 |
| ink on accent-soft | **14.78:1** | **12.79:1** | 7:1 | 1.4.6 |
| good on canvas | **7.14:1** | **10.30:1** | 4.5:1 | 1.4.3 |
| good on surface | **7.60:1** | **9.39:1** | 4.5:1 | 1.4.3 |
| warn on canvas | **6.82:1** | **10.20:1** | 4.5:1 | 1.4.3 |
| warn on surface | **7.26:1** | **9.29:1** | 4.5:1 | 1.4.3 |
| bad on canvas | **7.20:1** | **8.90:1** | 4.5:1 | 1.4.3 |
| bad on surface | **7.66:1** | **8.11:1** | 4.5:1 | 1.4.3 |
| line on canvas（装饰） | 1.21 | 1.43 | — | 参考 |
| surface on canvas（层次） | 1.06 | 1.10 | — | 参考 |

### 6.5 紫罗兰

| 检查项（前景 / 背景） | 浅色 | 深色 | 要求 | 条款 |
| --- | ---: | ---: | ---: | --- |
| ink on canvas | **16.79:1** | **15.83:1** | 7:1 | 1.4.6 |
| ink on surface | **17.75:1** | **14.76:1** | 7:1 | 1.4.6 |
| ink-soft on canvas | **8.42:1** | **10.24:1** | 4.5:1 | 1.4.3 |
| ink-soft on surface | **8.90:1** | **9.55:1** | 4.5:1 | 1.4.3 |
| ink-faint on canvas | **5.20:1** | **6.24:1** | 4.5:1 | 1.4.3 |
| ink-faint on surface | **5.49:1** | **5.82:1** | 4.5:1 | 1.4.3 |
| line-strong on canvas | **3.26:1** | **3.92:1** | 3:1 | 1.4.11 |
| line-strong on surface | **3.45:1** | **3.65:1** | 3:1 | 1.4.11 |
| accent on canvas | **7.29:1** | **9.17:1** | 4.5:1 | 1.4.3 |
| accent on surface | **7.71:1** | **8.55:1** | 4.5:1 | 1.4.3 |
| on-accent on accent | **7.76:1** | **8.81:1** | 4.5:1 | 1.4.3 |
| accent on accent-soft | **6.30:1** | **7.41:1** | 4.5:1 | 1.4.3 |
| ink on accent-soft | **14.50:1** | **12.79:1** | 7:1 | 1.4.6 |
| good on canvas | **7.14:1** | **10.31:1** | 4.5:1 | 1.4.3 |
| good on surface | **7.55:1** | **9.62:1** | 4.5:1 | 1.4.3 |
| warn on canvas | **6.89:1** | **10.23:1** | 4.5:1 | 1.4.3 |
| warn on surface | **7.28:1** | **9.54:1** | 4.5:1 | 1.4.3 |
| bad on canvas | **7.36:1** | **9.01:1** | 4.5:1 | 1.4.3 |
| bad on surface | **7.78:1** | **8.40:1** | 4.5:1 | 1.4.3 |
| line on canvas（装饰） | 1.22 | 1.40 | — | 参考 |
| surface on canvas（层次） | 1.06 | 1.07 | — | 参考 |

### 6.6 高对比

| 检查项（前景 / 背景） | 浅色 | 深色 | 要求 | 条款 |
| --- | ---: | ---: | ---: | --- |
| ink on canvas | **21.00:1** | **21.00:1** | 10:1 | 1.4.6 |
| ink on surface | **21.00:1** | **19.56:1** | 10:1 | 1.4.6 |
| ink-soft on canvas | **14.16:1** | **16.83:1** | 4.5:1 | 1.4.3 |
| ink-soft on surface | **14.16:1** | **15.67:1** | 4.5:1 | 1.4.3 |
| ink-faint on canvas | **8.86:1** | **11.79:1** | 4.5:1 | 1.4.3 |
| ink-faint on surface | **8.86:1** | **10.98:1** | 4.5:1 | 1.4.3 |
| line-strong on canvas | **7.00:1** | **6.49:1** | 3:1 | 1.4.11 |
| line-strong on surface | **7.00:1** | **6.05:1** | 3:1 | 1.4.11 |
| accent on canvas | **10.96:1** | **11.07:1** | 4.5:1 | 1.4.3 |
| accent on surface | **10.96:1** | **10.31:1** | 4.5:1 | 1.4.3 |
| on-accent on accent | **10.96:1** | **9.94:1** | 4.5:1 | 1.4.3 |
| accent on accent-soft | **9.14:1** | **9.09:1** | 4.5:1 | 1.4.3 |
| ink on accent-soft | **17.51:1** | **17.25:1** | 10:1 | 1.4.6 |
| good on canvas | **9.12:1** | **12.37:1** | 4.5:1 | 1.4.3 |
| good on surface | **9.12:1** | **11.53:1** | 4.5:1 | 1.4.3 |
| warn on canvas | **11.02:1** | **14.01:1** | 4.5:1 | 1.4.3 |
| warn on surface | **11.02:1** | **13.05:1** | 4.5:1 | 1.4.3 |
| bad on canvas | **9.31:1** | **10.79:1** | 4.5:1 | 1.4.3 |
| bad on surface | **9.31:1** | **10.05:1** | 4.5:1 | 1.4.3 |
| line on canvas | 3.23 | 4.12 | — | 参考（此主题下承担分层职责） |
| surface on canvas | 1.00 | 1.07 | — | 参考 |

### 6.7 验证过程中被改掉的色值

初版有 5 处不达标，全部修掉，记录在此以便复核：

| 主题/模式 | token | 初值 | 初值对比度 | 终值 | 终值对比度 |
| --- | --- | --- | ---: | --- | ---: |
| 暖砂 浅 | `line-strong` | `#9c8f7d` | 2.94 ✗ | `#8d8172` | 3.53 ✓ |
| 森林 浅 | `ink-faint` | `#657a6d` | 4.26 ✗ | `#5f7367` | 4.70 ✓ |
| 森林 浅 | `line-strong` | `#85988a` | 2.83 ✗ | `#778a7c` | 3.40 ✓ |
| 深蓝 浅 | `ink-faint` | `#64748c` | 4.47 ✗ | `#616f86` | 4.78 ✓ |
| 深蓝 浅 | `line-strong` | `#8494ab` | 2.90 ✗ | `#77869d` | 3.47 ✓ |
| 高对比 浅 | `line` | `#d0d0d0` | 1.54 ✗ | `#8f8f8f` | 3.23 ✓ |
| 高对比 深 | `line` | `#3a3a3a` | 1.85 ✗ | `#6e6e6e` | 4.12 ✓ |

最后两行不是 WCAG 失败，是**设计规则失败**：高对比主题里 canvas 与 surface 同色，边框成了唯一的分层手段，必须 ≥3:1。这说明「跑通 WCAG」和「设计上成立」是两道独立的检查。

---

## 7. 实现建议

### 7.1 CSS 变量组织

用 **三层**：primitive（可选）→ semantic（主题变量）→ Tailwind 别名。主题切换只改中间层。

```css
/* app/globals.css */
@import "tailwindcss";

/* ① 语义变量：默认主题（暖砂）+ 浅色 */
:root {
  color-scheme: light;

  --canvas: #faf6ef;
  --surface: #fffcf7;
  --ink: #1f1a14;
  --ink-soft: #544a3d;
  --ink-faint: #736656;
  --line: #e6ddcf;
  --line-strong: #8d8172;
  --accent: #9a4410;
  --accent-soft: #f6e3cd;
  --on-accent: #ffffff;
  --good: #1a6236;
  --warn: #7d5105;
  --bad: #99251b;
}

/* ② 主题 × 模式：只覆盖值，不改名 */
[data-theme="sand"][data-mode="dark"] {
  color-scheme: dark;
  --canvas: #17140f; --surface: #211d17;
  --ink: #f3ecdf; --ink-soft: #cdc2b1; --ink-faint: #a2957f;
  --line: #37312a; --line-strong: #7d7365;
  --accent: #eaa76a; --accent-soft: #3a2919; --on-accent: #2a1a08;
  --good: #7dd39d; --warn: #e6c273; --bad: #f39b90;
}
/* 其余 4 套同构，略 */

/* ③ Tailwind 别名：只做映射，不存值 */
@theme inline {
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-ink-faint: var(--ink-faint);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-accent: var(--accent);
  --color-accent-soft: var(--accent-soft);
  --color-on-accent: var(--on-accent);
  --color-good: var(--good);
  --color-warn: var(--warn);
  --color-bad: var(--bad);
}
```

**为什么必须用 `@theme inline`**：这是本文实测过的关键点，写错会导致主题切换失效。我用 Tailwind 4.3.3 实际编译了两种情况：

| 写法 | `.bg-canvas` 编译结果 | 后果 |
| --- | --- | --- |
| `@theme { --color-canvas: var(--canvas); }` | `background-color: var(--color-canvas)` | 工具类引用 `--color-canvas`，而它在**定义处**求值，运行时改 `--canvas` 不会传导 |
| `@theme inline { --color-canvas: var(--canvas); }` | `background-color: var(--canvas)` | 工具类直接引用 `--canvas`，在**使用处**求值，主题切换生效 |

官方文档的说明是：*"Using the inline option, the utility class will use the theme variable value instead of referencing the actual theme variable"*——即工具类使用**被引用的值**（`var(--canvas)`），而不是主题变量名（`var(--color-canvas)`）。当主题变量派生自另一个变量时，必须加 `inline`。来源：[tailwindcss.com/docs/theme](https://tailwindcss.com/docs/theme)。这与 shadcn/ui 在 Tailwind v4 下的做法一致。

**为什么用 `data-theme` + `data-mode` 两个属性**：主题（色相）与模式（明暗）是**正交**的两个维度。5 × 2 = 10 个组合，用两个属性可以写成 5 组规则 × 2 段，而不是 10 段。也便于「跟随系统」：

```js
// 模式：'light' | 'dark' | 'system'
const mode = localStorage.getItem('mode') ?? 'system';
const resolved = mode === 'system'
  ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  : mode;
document.documentElement.dataset.mode = resolved;
document.documentElement.dataset.theme = localStorage.getItem('theme') ?? 'sand';
```

**必须做的三件配套事**：
1. **首屏防闪烁**：在 `<head>` 里放一段同步脚本，读 `localStorage` 并设 `data-mode`，早于 CSS 绘制。否则深色用户会看到白闪。
2. **`color-scheme` 跟着切**：`color-scheme: dark` 让滚动条、表单控件、`<select>` 弹层跟着变深色。漏了这行，深色主题下原生控件会是刺眼的白色。
3. **`<meta name="theme-color">` 跟着切**：移动端地址栏颜色。

### 7.2 避免深色模式下中文发虚

这是 CSS 层能做的全部：

```css
:root { --text-weight-body: 400; }

[data-mode="dark"] {
  /* ① 正文加字重，补偿灰度抗锯齿导致的笔画变细 */
  --text-weight-body: 450;      /* 可变字体；非可变字体回退 500 */
}

body {
  background: var(--canvas);
  color: var(--ink);
  font-family: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
               "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.75;            /* 中文正文，高于研究的 1.5 */
  font-weight: var(--text-weight-body);
  font-synthesis-weight: none;  /* 不要合成假粗体，会糊 */
  -webkit-font-smoothing: antialiased;   /* 深色下减少过粗 */
  text-rendering: optimizeLegibility;
  text-wrap: pretty;
  max-width: 36em;              /* ≈36 汉字/行，满足 SC 1.4.8 的 CJK 40 字上限 */
}

/* ② 深色下给极小字号一点字距，抵消光晕造成的粘连 */
[data-mode="dark"] .text-xs,
[data-mode="dark"] .text-2xs {
  letter-spacing: 0.01em;
}

/* ③ 中文标点挤压（支持的浏览器） */
.prose-cn {
  text-spacing-trim: trim-start;
  hanging-punctuation: allow-end;
}

/* ④ 数字等宽，掌握度百分比不跳动 */
.tabular { font-variant-numeric: tabular-nums; }
```

**四条不要做的事**：

| 反模式 | 后果 | 正确做法 |
| --- | --- | --- |
| 深色下 `text-shadow: 0 0 1px` 描边加粗 | 中文小字会糊成一团 | 用字重，不用阴影 |
| `font-weight: 300` 做中文正文 | 横画在 16px 下不足 1px，直接消失 | 400 起，深色 450–500 |
| 纯白 `#fff` on 纯黑 `#000` 做日常深色 | halation 最强，小字发胖 | 近白 on 近黑，14–17:1 |
| `transform: scale()` 或 `zoom` 做字号放大 | 中文笔画会因非整数像素而发虚 | 用 `rem` + 浏览器缩放 |

### 7.3 主题切换的验收清单

上线前用脚本跑，别靠肉眼：

1. `node research/tools/contrast-audit.mjs` → 退出码 0，无 FAIL。
2. 5 × 2 个组合逐个截图，检查：进度条填充/轨道、禁用按钮、focus ring、`<select>` 弹层。
3. 系统级 `prefers-color-scheme` 切换时不闪白。
4. 200% 缩放下正文不横向滚动（SC 1.4.8）。
5. 三种语义状态（good/warn/bad）**叠加图标或文字**，不只靠颜色。
6. 深色下 13px 提示文字在 1x 屏上仍可读（这是最容易失守的一档）。

### 7.4 与现有 `app/globals.css` 的迁移

现有文件里的 `--color-*` 已经是「暖砂」的浅色版雏形，但有三处需要改：

| 现状 | 问题 | 改法 |
| --- | --- | --- |
| `@media (prefers-color-scheme: dark) { @theme { ... } }` | **实测会失效**：`@theme` 是编译期指令，包在 media query 里时只有**最后一份**值被写进 `:root`，media query 本身在输出里消失。我用 Tailwind 4.3.3 编译验证：浅色 `--color-canvas: #faf9f7` 被深色 `#1c1917` 直接覆盖，**浅色主题实际不生效** | 改成 `[data-mode="dark"]` 覆盖语义变量 + `@theme inline` 别名 |
| `--color-ink-faint: #a8a29e` | 对 `#faf9f7` 只有 **2.40:1**，**提示文字不达标** | 换成 `#736656`（5.18:1） |
| `--color-ink-faint: #78716c`（深色） | 对 `#1c1917` 只有 **3.65:1**，深色提示文字不达标 | 换成 `#a2957f`（6.25:1） |
| `--color-line: #e7e5e4` 兼作控件边框 | **1.19:1**，控件边界不达标 | 拆成 `line`（装饰）+ `line-strong`（控件，≥3:1） |
| `line-height: 1.6` | 中文正文偏紧 | 改 1.75，并加 `max-width: 36em` |

> 第一条是**功能性 bug**，不只是配色问题。建议优先修：在浏览器里切换系统深色模式，当前浅色主题不会恢复。

---

## 8. 结论与取舍

1. **能直接抄的是结构，不能直接抄的是数值。** Radix 的 12 阶角色、MD3 的 `on-*` 配对、shadcn 的 `@theme inline` 接法都可以照搬；但色值必须按自己的 canvas/surface 重算——Radix 自家的 amber-11 在白底上只有 4.43:1。
2. **教育产品的「活泼」和「可读」是两层颜色。** Duolingo 品牌绿 2.09:1 证明了这一点：品牌色做色块，正文色做阅读，两者不要混。
3. **默认浅色 + 深色一等公民**，依据是正极性优势（Piepenbrock 2013 / Dobres 2017）与长期用眼的不确定性（Aleman 2018）。不要宣称「护眼」。
4. **中文深色的核心是字重与对比度上限，不是换颜色。** 把正文对比度从 21:1 压到 15:1、字重从 400 提到 450，比换任何色相都更直接——但这条是**基于机制的工程推断**（halation 随对比度增强、细笔画先失守），我没有找到「字重 450 vs 400 在深色下提升阅读速度 X%」的对照实验。落地后应当用真实用户测试验证。
5. **WCAG 达标 ≠ 设计成立。** 高对比主题的边框问题（§6.7）说明还要跑一遍「结构检查」：当两个面同色时，边界必须自己扛起 3:1。

---

## 附录：复现方式

```bash
# 汇总表（退出码 0 = 全通过）
node research/tools/contrast-audit.mjs

# 完整 Markdown 表（本文 §6.2–6.6 的来源）
node research/tools/contrast-audit.mjs --markdown

# JSON（供 CI 或其它脚本消费）
node research/tools/contrast-audit.mjs --json

# 求解「刚好达标」的候选色（调色时用）
node research/tools/contrast-audit.mjs --solve
```

脚本内 `THEMES` 对象是唯一的数据源。改色值后重跑 `--markdown` 即可拿到新表；本文 §5.2 与 §6.x 的数字是用 `--markdown` 输出后逐项核对过的（脚本与文档做过 210 项自动比对，0 差异）。

**公式实现**（`contrast-audit.mjs`）：

```js
const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const relativeLuminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
```

---

## 参考来源

**设计系统**
- [Tailwind CSS — Colors](https://tailwindcss.com/docs/colors)（11 阶色板、5 个中性家族的色温差异、`dark:` 配对方式）
- [Radix Colors — Understanding the Scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)（12 阶角色、第 6/8 阶边框区分、11/12 阶的 APCA Lc 60/90 保证）
- Radix Colors 实际色值：`@radix-ui/colors@3.0.0` 的 `*.css` / `*-dark.css`（本文 §1.2 的 8 色相实测表）
- Material Web — `tokens/versions/v0_192/_md-sys-color.scss` 与 `_md-ref-palette.scss`（M3 role → tone 映射，本文 §1.3 全表）
- [shadcn/ui — Theming](https://ui.shadcn.com/docs/theming)（成对 token、OKLCH、`.dark` 重声明、`@theme inline`）
- [Khan Academy — wonder-blocks](https://github.com/Khan/wonder-blocks)（`tokens/color.ts`、`theme/semantic/semantic-color.ts`；三层 token 与 `offBlack #21242c` / `offWhite #f7f8fa`）

**无障碍**
- [WCAG 2.2 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)（4.5:1 / 3:1；大字定义含 CJK）
- [WCAG 2.2 SC 1.4.6 Contrast (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html)（7:1 / 4.5:1）
- [WCAG 2.2 SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)（3:1；禁用态豁免；边框非必需的判定）
- [WCAG 2.2 SC 1.4.12 Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)（1.5/2/0.12/0.16）
- [WCAG 2.2 SC 1.4.8 Visual Presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html)（CJK 行宽 40 字）
- [WCAG 2.2 SC 2.5.8 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)（24×24）
- [WCAG 2.2 SC 2.4.13 Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)（2px 周长、3:1）

**阅读研究**
- Piepenbrock et al. (2013), *Ergonomics* / *Human Factors*：正极性优势，字号越小优势越大（经 [NN/g Dark Mode](https://www.nngroup.com/articles/dark-mode/) 转述）
- Dobres et al. (2017), *Applied Ergonomics*：浅色模式更快，夜间尤甚（同上）
- Aleman et al. (2018), *Scientific Reports*：持续浅色阅读与脉络膜变薄相关（同上）
- Legge et al. (1985)：屈光介质混浊者深色更优（同上）
- Buchner & Baumgartner (2007), *Ergonomics*, DOI [10.1080/00140130701306413](https://doi.org/10.1080/00140130701306413)：极性效应独立于照度与色彩对比
- Mehta & Zhu (2009), *Science*, DOI [10.1126/science.1169144](https://doi.org/10.1126/science.1169144)：红/蓝对细节型与创造性任务的不同影响
- Chan, Tsang & Ng (2014), *Human Factors* 56(3):521–534, DOI [10.1177/0018720813499368](https://doi.org/10.1177/0018720813499368)：中文屏幕校对推荐 36 字/行 + 1.5 行距

**中文排版**
- [W3C clreq（中文排版需求）](https://www.w3.org/TR/clreq/) §6.4 基线/行高（定义字框、字面、字幅；**未给出正文行高数值**）
- [Ant Design — 字体](https://ant.design/docs/spec/font)（14/22 基准、400/500 字重、AAA 7:1 目标）
- [web.dev — prefers-color-scheme](https://web.dev/articles/prefers-color-scheme)（"Avoid pure white"；用 `rgb(250,250,250)` 减少 glowing/bleeding）

**教育产品**
- Duolingo 品牌色：`design.duolingo.com` 的 brand guidelines bundle（`#58cc02` / `#1cb0f6` / `#ffb100` / `#ce82ff` / `#ff7878`），经 Wayback 存档读取
- Khan Academy：Wonder Blocks `tokens/color.ts`（`#1865f2` / `#00a60e` / `#ffb100` / `#d92916` / `#21242c` / `#f7f8fa`）
- Coursera：`coursera.org` 首页 CSS 变量（`--cds-color-blue-800: #0056d2` 等）
- Brilliant：`brilliant.org` 首页内联样式（`#f5f3f1` / `#ffede0` / `#e7eee2` / `#f0f8fa`）

**说明**：Duolingo 与 Khan Academy 官网正文页有反爬（分别返回 JS 壳与 "Client Challenge"），色值取自其公开品牌 bundle 与开源设计系统仓库，不是渲染后的截图取色；这一点在 §3.1 已注明。
