# 自适应学习路径规划：教育学与算法基础调研

> **⚠️ 本文的选型结论已被 `06-synthesis.md` 取代（2026-10-22 第二次修订）。**
> 本文 §1 选型表、§5 路径算法表、§7 推荐架构里的 **BKT + IRT 3PL** 是选题阶段的方案；06 把规模收敛到 **40 概念 / 120 题 / 一个班 40 人**，判定 BKT 四参数与 IRT 3PL 在该数据量下不可识别，**最终采用难度加权 Beta-Bernoulli**（公式见 06 §1.3，理由见 06 §3.5）。
> **本文仍然有效的部分**：§4 学习科学约束、§6 本地实测、§8「不建议做」清单。**本文的选型与架构部分只作为「为什么不用」的论证材料，不要照此实现。**
> 全文执行口径以 `06-synthesis.md` 为准。


> 面向传智杯赛道 10037「AI 教育与学习平台 → 自适应学习路径规划」。调研日期 2026-10-21。数字均标来源；「本地实测」指本机微基准（Python 3.13.5 / numpy 2.5.1 / 32 线程 Windows），非生产压测。

## 0. 一句话结论

**可落地方案不是「让 LLM 排一条学习路径」，而是三层：学情估计（BKT/IRT 这类可解释模型）→ 知识结构（先修 DAG）→ 路径生成（拓扑序 + ZPD 打分的贪心/束搜索，LLM 只做解释与内容生成）。** 理由见 §6 实测：三层全部毫秒级，而深度知识追踪的训练成本与数据要求远超 4 周赛程能凑出的量。

## 1. 三层概念地图

| 层 | 回答的问题 | 候选方法 | ~~本产品选型~~（已被 06 取代，见 06 §1.3/§3.5） |
|---|---|---|---|
| 学情估计 | 这个学生现在会什么？ | BKT、DKT/DKVMN/SAKT/AKT、IRT、Elo | BKT（每知识点四参数）+ IRT 定难度 |
| 知识结构 | 知识点之间谁先谁后？ | 知识空间理论、先修 DAG、Q-matrix | 人工建 DAG + 数据驱动补边 |
| 路径生成 | 下一步学哪个？ | 拓扑排序+贪心、图搜索、MAB、RL、约束优化、LLM | 拓扑序约束下的 ZPD 贪心 + 束搜索 |

## 2. 学情估计（Knowledge Tracing）

### 2.1 BKT：四参数隐马尔可夫模型

每个知识点独立一套参数：`p-init`（p(L₀) 已掌握概率）、`p-transit`（p(T) 每次练习后学会的概率）、`p-slip`（p(S) 会了却答错的概率）、`p-guess`（p(G) 不会却蒙对的概率）（Corbett & Anderson, *User Modeling and User-Adapted Interaction* 4(4), 1995, doi:10.1007/BF01099821）。

更新式（Wikipedia "Bayesian knowledge tracing" 条目）：
- 答对后：`p(L|correct) = pL(1−pS) / [pL(1−pS) + (1−pL)pG]`
- 答错后：`p(L|wrong) = pL·pS / [pL·pS + (1−pL)(1−pG)]`
- 学习转移：`p(L_{t+1}) = p(L_t|obs) + (1 − p(L_t|obs))·pT`
- 预测答对：`p(C_{t+1}) = p(L_{t+1})(1−pS) + (1−p(L_{t+1}))pG`

**输入**：某学生某知识点上的答题对错序列（0/1）。**输出**：每个时间步的掌握概率 p(L)，取值 [0,1]，可直接当「掌握度」显示。
**优点**：参数只有 4 个、可解释、可用 EM 拟合、增量更新 O(1)、冷启动友好（先验可配）。
**缺点**：默认所有学生共享同一套参数，无法表达个体差异；参数可辨识性是学生建模的经典难题（Beck & Chang, *Identifiability: A Fundamental Problem of Student Modeling*, UM 2007）；「一个知识点一道题」的粒度假设过强。
**规模**：pyBKT（MIT，PyPI 1.4.3）C++ 后端拟合 5000 名学生约 45 秒，纯 Python 约 1 小时 30 分（github.com/CAHLR/pyBKT README）。纯 Python 在 Windows 上只能跑纯 Python 版（同页）。

### 2.2 深度知识追踪家族

| 模型 | 年份/ venue | 核心机制 | 代表 AUC | 主要问题 |
|---|---|---|---|---|
| DKT | NIPS 2015 (arXiv:1506.05908；proceedings.neurips.cc/paper/2015 已收录，作者 Piech, Bassen, Huang 等) | LSTM，输入 one-hot(题目,对错) | Khan 0.85 / ASSISTments 0.86（原文 Table 1） | 不可解释；有「预测不一致」缺陷（DKT+，Yeung & Yeung 2018, doi:10.1145/3231644.3231647） |
| DKVMN | WWW 2017 (arXiv:1611.08108) | key-value 记忆矩阵：key 存概念（数量 K 需预先指定）、value 存掌握度 | ASSISTments2009 0.816（SAKT 论文 Table 3 复现值） | 概念数需预设，新知识点要重训 |
| SAKT | EDM 2019 (arXiv:1907.06837) | 自注意力选相关历史题 | ASSIST09 0.848 / ASSIST15 0.854 / Statics 0.853，平均 +4.43% | ASSISTChall 上与 DKT 持平（0.734），历史太短时退化 |
| AKT | KDD 2020 (arXiv:2007.12324, doi:10.1145/3394486.3403282) | 单调注意力 + 指数衰减距离 + Rasch 正则 | ASSIST09 0.8346 / ASSIST15 0.7828 / ASSIST17 0.7702 | 原文用单卡 Titan X 训练，单 epoch <10 s（ar5iv 版），但仍需 GPU |

AUC 数据来自各论文结果表（AKT 数字取自 ar5iv 版 Table 2；SAKT 取自 ar5iv 版 Table 3）。

**必须知道的反例**：Khajah, Lindsey & Mozer, *How Deep is Knowledge Tracing?*（EDM 2016, arXiv:1604.02416）复现后发现，DKT 相对 BKT 的优势里 **31.6% 来自 BKT 侧 AUC 计算方式有偏，另有 50.6% 在给 BKT 加上遗忘参数后消失**；在 ASSISTments 上经典 BKT AUC 0.73、BKT+遗忘 0.83，而论文报的 DKT 是 0.86；用 exercise 级标签做技能发现后 BKT+FSA 达到 0.90，反超 DKT（EDM2016 proceedings paper_144.pdf 第 98–99 页）。
**结论：在一个只有几千条交互的课程产品里，BKT 与深度模型的 AUC 差距通常在 2–5 个百分点（Sarsa et al. 2022, arXiv:2112.15072 实测 BKT 比最差 DLKT 低 2–3.4 点，而 DLKT 模型之间只差 0.6–1.7 点），不值得付出训练与部署成本；且该文指出「即使几乎没有预测力的简单基线也可能在某些指标上超过 DLKT」。**

### 2.3 IRT 与 Elo：定「题目难度」而不是定「学生会什么」

IRT 三参数模型：`p_i(θ) = c_i + (1−c_i) / [1 + e^{−a_i(θ−b_i)}]`，a=区分度、b=难度、c=猜测率；1PL（Rasch）只保留 b（Wikipedia "Item response theory"）。IRT 把「人」和「题」放在同一把 θ 尺子上，这正是路径规划需要的：**学生能力 θ 与题目难度 b 可直接相减得到「最近发展区」距离**。
**输入**：学生×题目的对错矩阵。**输出**：每题 (a,b,c) 与学生 θ。**成本**：离线拟合；在线更新只需重估单个 θ。Python 库 `girth` 0.8.0、`py-irt` 0.7.1（PyPI，MIT）可用。
**注意**：Elo 在教育场景有已知偏差——评级的方差不收敛、并非无偏（*Keeping Elo alive*, Br. J. Math. Stat. Psychol. 2025, doi:10.1111/bmsp.12395）。做快速冷启动可以用，但别把它当最终能力估计。

## 3. 知识结构与先修关系

### 3.1 知识空间理论（KST）

Doignon & Falmagne 1985 提出：知识域是有限概念集 Q，可行知识状态是 Q 的子集，全体可行状态构成「知识结构」；对并集封闭叫知识空间，再加「良级」（well-graded，任何状态都能一次去掉一个概念仍可行）叫学习空间。**外边缘（outer fringe）= 学生准备好学的下一个概念**——这是路径规划最直接的理论依据（Wikipedia "Knowledge space"）。商业系统 ALEKS 就建立在此之上（同页）。

### 3.2 先修关系怎么来

| 做法 | 代表工作 | 数据要求 | 适用 |
|---|---|---|---|
| 专家手工建 DAG | 大多数 ITS | 无（靠教研） | 课程知识点 < 500，最稳 |
| Q 矩阵 + 贝叶斯网联合学习 | COMMAND（Chen, González-Brenes & Tian, EDM 2016, paper_89.pdf） | 学生答题记录 + 题目-技能映射 | 已有题库和日志 |
| 文本挖掘先修关系 | *Prerequisite Relation Learning for Concepts in MOOCs*（ACL 2017, doi:10.18653/v1/P17-1133），F1 提升 5.9–48.0% | 课程文本/视频字幕 | 冷启动、无日志 |
| LLM 抽先修边 | 2024–2026 多篇（如 arXiv:2501.12300） | 教材文本 | 快速铺量，需人工抽检 |

**拓扑排序复杂度 O(|V|+|E|)**（Wikipedia "Topological sorting"），500 节点 984 条边本地实测 0.118 ms/次。这意味着「先修约束」在 Web 产品里几乎零成本，**没有理由不做**。

## 4. 学习科学约束（决定「下一步该多难」）

### 4.1 最近发展区 ZPD

维果茨基在生命最后三年（1931–1934）提出，生前未完成系统论述；英译本 *Mind in Society* 由 Harvard UP 出版（常见引用年份 1978，Crossref 对该书 DOI 标注 1980）：ZPD 是「独立能做的」与「即使有帮助也做不到的」之间的区间，学习发生在有他人支架的地带（Wikipedia "Zone of proximal development"；doi:10.2307/j.ctvjf9vz4）。**可操作化**：把 ZPD 翻译成「预测正确率落在某区间」，例如 0.7–0.85。
实证：E-Gotsky（Vainas et al., arXiv:1904.12268，EDM 2019 短文）用两个随机森林分别预测「首次答对概率 CFA」和「答对耗时 TTS」，跳过太简单的题，在数百名小学生学分数的 5 个月实验里**达到同等掌握水平少用 17% 时间（p=.025），猜测行为减少 25%**。
**注意**：该文没有给出统一的「ZPD 概率区间」常数，阈值是按假阳性率 <10% 离线调的。所以「0.75 正确率」这类数字是我们自己的产品参数，不能引用成文献结论。

### 4.2 掌握学习（Mastery Learning）

Bloom 1968 提出；核心是「先修达标才前进 + 未达标给矫正性教学 + 允许时间因人而异」，常以约 90% 正确率为达标线（Wikipedia "Mastery learning"）。Bloom 1984 的「2 sigma 问题」：一对一辅导+掌握学习的学生平均比班级授课高 2 个标准差，平均受辅导学生超过对照班 98% 的人（*Educational Researcher* 13(6), doi:10.3102/0013189X013006004）。
效应量：维基百科称「平均效应量 0.59」，但该句只引到 Winget & Persky 2022 的综述（*Am J Pharm Educ*, doi:10.5688/ajpe8906），该综述原文只说「moderate effect sizes」，**没有给 0.59**——这个数字需要独立核验，不要直接写进技术文档。可靠的原始 meta 分析是 Guskey & Pigott 1988（46 项研究，*J. Educ. Res.*, doi:10.1080/00220671.1988.10885824），结论是「一致正向但效应量异质性很大，研究不共享同一效应量」。

### 4.3 间隔重复与遗忘曲线

- 艾宾浩斯 1885 提出遗忘曲线；常用指数近似 `R = e^{−t/S}`（Wikipedia "Forgetting curve"）。
- SM-2：EF 初始 2.5、下限 1.3；首次间隔 1 天、第二次 6 天，之后 `I ← round(I × EF)`；`EF ← EF + (0.1 − (5−q)(0.08 + (5−q)·0.02))`（Wikipedia "SuperMemo"）。
- FSRS-6：21 个参数，记忆三变量 D/S/R；遗忘曲线 `R(t,S) = (1 + factor·t/S)^{−w20}`，其中 `factor = 0.9^{−1/w20} − 1` 保证 `R(S,S)=90%`（open-spaced-repetition wiki "The Algorithm"）。Anki 默认期望保留率 90%，并提示「高于 90% 工作量增长很快」（Anki Manual, docs.ankiweb.net/deck-options.html）。
- 最优间隔不是常数：Cepeda et al. 2008（*Psych. Science*, doi:10.1111/j.1467-9280.2008.02209.x，1350+ 人）发现最优间隔随测试延迟增长，但**占测试延迟的比例从 1 周延迟的 20–40% 降到 1 年延迟的 5–10%**。
- 工程实现：`ts-fsrs` npm 5.4.2（MIT，2026-10-19 更新）可直接在前端跑 FSRS。

### 4.4 认知负荷与「学习风格」

- 认知负荷理论：Sweller 1988（*Cognitive Science* 12(2), doi:10.1207/s15516709cog1202_4），分内在/外在/相关三类负荷；工作记忆容量约 **4 个 chunk**（Cowan 2001，转引自 Wikipedia "Working memory"），不是米勒的 7±2。**产品含义**：单屏新概念 ≤ 3–4 个，一次练习只引入一个新变式。
- **学习风格（视觉型/听觉型）不要做**：Pashler, McDaniel, Rohrer & Bjork 2008（*Psychol. Sci. Public Interest* 9(3), doi:10.1111/j.1539-6053.2009.01038.x）的结论是「没有充分证据支持把学习风格评估纳入常规教育实践」。做「按风格匹配教学」既不科学也不加分。

### 4.5 「85% 规则」的适用边界

Wilson, Shenhav, Straccia & Cohen 2019（*Nature Communications*, doi:10.1038/s41467-019-12552-4）证明：对一类**基于随机梯度下降的二分类学习算法**，最优训练错误率约 **15.87%**，即 85% 正确率。**但这是关于机器学习算法收敛速度的结论，不是关于人类学习的实验结论。** 它可以作为「难度目标设在 ~85% 正确率」的类比依据，不能写成「科学研究证明学生应在 85% 正确率下学习」——答辩时会被问穿。

## 5. 路径生成算法：输入/输出/规模/优缺点/Web 落地

| 算法 | 输入 | 输出 | 复杂度 | 适用规模 | 优点 | 缺点 | Web 落地 |
|---|---|---|---|---|---|---|---|
| 拓扑排序 + ZPD 贪心 | 先修 DAG、每点掌握度 p、难度 b | 有序知识点列表 | O(V+E) 建序 + O(V log V) 选点 | 10³–10⁴ 节点 | 毫秒级、结果必然满足先修、可解释 | 贪心非全局最优；不考虑长期遗忘 | **首选**。服务端算，或浏览器 Web Worker |
| DAG 最短路 / A* | 带权 DAG（边权=学习成本） | 到目标点的最短学习链 | O(V+E)（DAG 上 DP） | 10³–10⁴ | 最优、快 | 需要合理的边权定义 | 适合「我要在 2 周内达到 X」这类查询 |
| 约束优化 / ILP | 先修约束、时间预算、目标函数 | 全局最优序列 | 组合优化，ACS 被明确称为 NP-hard（doi:10.3390/systems11010034） | < 200 节点 | 可表达复杂约束 | 求解器重、需后端、超时不可控 | 不推荐在赛期内做 |
| 元启发式（GA/PSO） | 同上 | 近似最优序列 | 迭代式，秒级 | 10²–10³ | 能处理非线性目标 | 结果不稳定、难复现 | 学术上常见（如 GT-PSO, doi:10.3390/systems11010034），工程上不划算 |
| 多臂老虎机（UCB/Thompson） | 候选题目、历史奖励 | 下一题 | O(K) 每步 | 任意 | 天然处理探索-利用；冷启动好 | 无长期规划；奖励定义难 | 适合「同一知识点内选哪道题」 |
| 强化学习（DQN/PPO） | 状态=知识状态，动作=选知识点，奖励=掌握度增量 | 策略 | 训练小时级 | 需大量模拟 | 可优化长期收益 | 样本效率低、难复现、答辩难解释 | 赛期内不建议自训；可引用 CSEAL（KDD 2019, arXiv:1905.12470）说明思路 |
| LLM 规划 | 学生画像 + 知识图谱 + 目标 | 自然语言路径 + 理由 | 秒级、按 token 计费 | 任意 | 解释性强、能处理非结构化目标 | 幻觉、不保证先修约束、不可复现 | **只做「解释层」和「目标拆解」，不把排序权交给它** |

关键参考：
- CSEAL（Liu et al., KDD 2019）把路径推荐建成 MDP，用 actor-critic，并用先修结构上的导航算法收缩动作空间——这是「RL + 先修约束」的标准范式（arXiv:1905.12470）。
- MAPLE（Segal et al., arXiv:1804.05212）用「难度排序 + 多臂老虎机」选题，在真实在线学习环境部署过，思路与本产品最接近。
- 有真实部署数据的案例：2025 年 *Scientific Reports* 的「知识图谱 + Q-learning 剪枝 + PPO 选择」系统，微信小程序上线，200 名活跃学生、3 个月、18,742 条交互，Precision 0.85 / Recall 0.82 / F1 0.84，200 并发下平均延迟 **241 ms**（doi:10.1038/s41598-025-17918-x）。这个数字可以作为我们「实时推荐延迟」的对标。
- LLM 直接做规划的效果：PersonaPath（arXiv:2609.18861, AACL 2026）构建了 2,000 个学习者画像 + 347 本教材/1,751 单元/4,092 概念的层级知识图谱，最好的 LLM 在基础教育场景**最终通过率仅 29.5%**，个性化适配维度**没有模型超过 44.7%**。**这是「不要用 LLM 直接排路径」最硬的证据。**

## 6. 本地实测（证明「毫秒级」不是拍脑袋）

| 操作 | 规模 | 耗时 | 备注 |
|---|---|---|---|
| BKT 前向更新 | 单学生 1000 次交互 | 0.107 ms | 纯 Python 循环 |
| BKT 批量 | 200 知识点 × 1000 学生 × 20 次交互 | 0.479 s | 纯 Python，可放后台任务 |
| 拓扑排序 | 500 节点 / 984 边 | 0.118 ms | Kahn 算法 |
| 路径生成（堆 + ZPD 贪心） | 500 节点 DAG，输出 40 步 | 0.645 ms | 已验证先修约束 100% 满足 |
| 路径生成（朴素全扫描） | 同上 | 3.414 ms | 堆优化约快 5× |
| UCB 选题 | 100 臂 × 1000 轮 | 3.88 ms | numpy |
| LSTM 前向（DKT 推理代理） | T=200, D=400, H=128 | 6.62 ms | numpy 单线程；浏览器 WASM 未实测，通常更慢 |
| DKT 参数量 | 200 知识点, H=128 | 29.6 万参数 ≈ 1.13 MB (fp32) | 2000 知识点约 9 MB |

复现说明：上表由三个临时脚本测得（`bench_kt.py` / `bench_pipeline.py` / `bench_nn.py`，用 `timeit` 计时，`/tmp` 下的一次性文件，未入库）；路径生成的先修约束用断言校验，500 节点/40 步全部满足。

**工程含义**：路径重算完全可以在每次答题提交后同步触发，不需要消息队列；真正的瓶颈是 LLM 调用（秒级）而不是算法。

## 7. 在本产品里怎么落地（可直接写进技术方案）

**数据从哪来**
1. 冷启动：教研录入知识图谱（节点=知识点，边=先修），每题标注所属知识点与难度（IRT b 初值可用专家打分）。
2. 运行期：每次答题写一条 `(user_id, kc_id, correct, timestamp, duration_ms)` 事件；这是 BKT 与 IRT 的唯一必需输入。
3. 无历史时用先验：`p-init` 按知识点在课程中的位置给 0.2–0.4，`p-transit` 0.1–0.2，`p-slip` 0.05–0.1，`p-guess` 0.15–0.25（这是工程默认值，不是文献结论，需在文档中标注为可调参数）。

**算一次要多久**
- 单次答题后 BKT 增量更新：< 1 ms（本地实测同量级）。
- 重算整条路径（500 节点）：< 1 ms（本地实测 0.645 ms）。
- 每晚批量重拟合 BKT 参数（200 知识点 × 1000 学生）：约 0.5 s（本地实测），可放定时任务。
- LLM 生成「为什么推荐这个」的解释：1–3 s，走流式输出（赛道评分项「AI 交互体验 3%」明确要求流式渲染）。

**推荐架构（已被 06 取代：`plan` 改为纯函数、不调 LLM，见 06 §1.4）**
```
答题事件 → BKT 增量更新掌握度 → 先修 DAG 上取「外边缘」候选集
        → ZPD 打分（|预测正确率 − 0.8| 最小）→ 束搜索取前 k 条路径
        → LLM 生成解释与学习建议（不参与排序）→ 流式返回前端
```
**降级策略**：LLM 超时/失败时，前端仍能拿到排序结果与掌握度，只缺解释文案——这直接对应评分项「AI 安全与可控性 4%」里的「兜底机制」。

**可解释性怎么讲**：BKT 的 p(L) 可以直接画成掌握度进度条；每条推荐边可以标注「因为你先修 A 未达标」；这两点是 DKT 给不了的，也是答辩时的加分点。

## 8. 不建议做 / 需要谨慎的地方

| 事项 | 原因 |
|---|---|
| 自训 DKT/DKVMN | 需要 10⁵–10⁶ 级交互（EdNet 是 1.3 亿条，CC BY-NC 4.0 仅限研究，github.com/riiid/ednet）；4 周赛程拿不到，且 AUC 提升有限 |
| 用 LLM 直接输出路径顺序 | PersonaPath 实测通过率 29.5%、适配性 ≤44.7%（arXiv:2609.18861） |
| 按「学习风格」个性化 | 无充分证据（Pashler et al. 2008） |
| 把「85% 规则」说成人类学习规律 | 原论文是 SGD 二分类算法的收敛结论（Wilson et al. 2019） |
| 引用「掌握学习效应量 0.59」 | 该数字在维基百科上无原始出处，Winget & Persky 2022 原文未给此数；需改用 Guskey & Pigott 1988 的定性结论 |

## 9. 未找到可靠来源的问题

- **ZPD 的「标准正确率区间」**：没有任何一篇论文给出统一常数；E-Gotsky 是阈值+假阳性率调参。若技术文档要写「0.75」，必须声明为产品假设。
- **FSRS 相对 SM-2 的复习量下降百分比**：fsrs-benchmark 仓库只报 Log Loss / RMSE / AUC，不报复习次数；Anki 手册只说「同样时间记住更多」，无百分比。网上流传的「减少 20–30% 复习量」我未找到一手出处，**不要引用**。
- **国内 K12 场景的公开知识图谱数据集**：未找到可商用、可直接下载的中文先修关系数据集；建议自建并由教研审核。

## 10. 主要来源清单

1. Corbett & Anderson 1995, doi:10.1007/BF01099821；BKT 公式见 en.wikipedia.org/wiki/Bayesian_knowledge_tracing
2. Piech et al. 2015, *Deep Knowledge Tracing*, arXiv:1506.05908（AUC 表见 ar5iv 版）
3. Zhang et al. 2017, *DKVMN*, arXiv:1611.08108
4. Pandey & Karypis 2019, *SAKT*, arXiv:1907.06837
5. Ghosh, Heffernan & Lan 2020, *AKT*, arXiv:2007.12324, doi:10.1145/3394486.3403282
6. Khajah, Lindsey & Mozer 2016, *How Deep is Knowledge Tracing?*, arXiv:1604.02416；PDF: educationaldatamining.org/EDM2016/proceedings/paper_144.pdf
7. Sarsa, Leinonen & Hellas 2022, arXiv:2112.15072
8. Doignon & Falmagne 1985；en.wikipedia.org/wiki/Knowledge_space
9. Chen, González-Brenes & Tian 2016, *COMMAND*, educationaldatamining.org/EDM2016/proceedings/paper_89.pdf
10. Liang et al. 2017, *Prerequisite Relation Learning for Concepts in MOOCs*, doi:10.18653/v1/P17-1133
11. Liu et al. 2019, *CSEAL*, arXiv:1905.12470
12. Segal et al. 2018, *MAPLE*, arXiv:1804.05212
13. Vainas et al. 2019, *E-Gotsky*, arXiv:1904.12268
14. Bloom 1984, *The 2 Sigma Problem*, doi:10.3102/0013189X013006004
15. Guskey & Pigott 1988, doi:10.1080/00220671.1988.10885824
16. Cepeda et al. 2006, doi:10.1037/0033-2909.132.3.354；Cepeda et al. 2008, doi:10.1111/j.1467-9280.2008.02209.x
17. Wilson et al. 2019, *The Eighty Five Percent Rule*, doi:10.1038/s41467-019-12552-4
18. Pashler et al. 2008, doi:10.1111/j.1539-6053.2009.01038.x
19. Sweller 1988, doi:10.1207/s15516709cog1202_4
20. FSRS: github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm；Anki Manual docs.ankiweb.net/deck-options.html；前端库 ts-fsrs npm 5.4.2（MIT）
21. EdNet: github.com/riiid/ednet（784,309 学生 / 131,441,538 交互 / CC BY-NC 4.0）
22. PersonaPath, arXiv:2609.18861
23. 知识图谱+DRL 英语路径系统, doi:10.1038/s41598-025-17918-x
24. pyBKT: github.com/CAHLR/pyBKT
