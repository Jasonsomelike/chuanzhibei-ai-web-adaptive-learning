# 03 · 竞品与开源项目调研（自适应学习路径规划）

> **⚠️ 本文的产品对比数据仍有效，但结论口径已被 `06-synthesis.md` 收紧（2026-10-22 第二次修订）。**
> - §4 能力矩阵是**自评**，逐格来源不全；06 §1.5 已注明「只用于内部取舍与叙事，不写进技术文档当事实」。
> - §6「建议的差异化定位」里的技术选型（BKT、图数据库、K12-KGraph 子图）**不再采用**：06 用 Beta-Bernoulli + PostgreSQL 递归 CTE，且首发场景改为高校一门课。
> - §5 的 G1–G6 空白点分析仍有效，是 06 选题创新的论证来源。
> 全文执行口径以 `06-synthesis.md` 为准。


> 调研日期 2026-10-21。选题背景见 `research/raw/track-10037-rules.md`：AI 教育与学习平台方向明确列出「自适应学习路径规划」；创新性占 25%（选题 10 + 技术方案 8 + 交互 7），且规则写明「鼓励创新应用方式，而非复刻已有产品」。
> 口径：每个产品写清 **做了什么 / 没做什么 / 面向谁**。「没做什么」只写有来源支撑的，不臆测。

---

## 0. 一页速览

1. **商业侧已经解决的是「诊断 + 推题」，没有解决「可解释、可干预、跨会话持久的路径规划」。** 调研到的头部产品，其自适应内核都是「专家建图 + 内容库 + 某种掌握度估计」的组合（逐条来源见 §1、§2），路径由系统单向决定（Knewton 官方博客明说推荐遵循 "frontier learning, building on prerequisites, and providing remediation"）。
2. **LLM Tutor 与自适应引擎是两条平行线。** Khanmigo 是对话式导师（官方定位 "personal tutor and teaching assistant"），Khan Academy 的 mastery 四级体系是另一套基于技能计数的进度系统；两年 RCT **未检测到显著额外增益**——点估计为 0.06–0.08 SD/学年，作者称与无 AI 的 Khan Academy 练习效果相近（「相近」不等于「为零」，该区间是正的点估计，见 §1 末尾）。
3. **开源侧存在明显断层**：知识图谱项目是**静态数据集**（K12-KGraph 数据 CC BY-NC-SA 4.0，禁商用）；知识追踪项目是**离线 benchmark**（pyKT 自陈评测「far away real-world educational contexts」，且警告 label leakage 导致虚高）；LMS 只有 **CAT 题选自适应**（Moodle Adaptive Quiz 用 Rasch/1PL，只管单维能力值，不管先修关系）。
4. **最接近的开源竞品是 OpenTutor**（MIT，148★）：LLM + FSRS + 知识图谱，但作者自述知识图谱与语义复习均为 `[Experimental]`，且「Multi-user SaaS/classroom mode is out of scope for this beta」。
5. **空白点集中在四处**：持久可解释的学习者模型、把先修约束变成 LLM 硬约束、教师/学生可干预的混合主动路径、冷启动。这四点分别对应评分表的选题创新（10）、技术方案创新（8）、交互创新（7）。

---

## 1. 商业产品 · 海外

| 产品 | 做了什么 | 没做什么 | 面向谁 |
| --- | --- | --- | --- |
| **Khanmigo** | 对话式 AI 导师 + 教师工具（教案、题目、分组、rubric）；写作教练；绑定 Khan Academy 内容库（[khanmigo.ai](https://www.khanmigo.ai/)） | 官方产品页**未说明**跨会话学习者模型或知识点级路径规划；教师不能给学生开通账号，课堂使用只能走学区采购（同上） | 教师免费；个人学习者 $4/月或 $44/年，且限 18+、美国账单地址；学区定制报价（[khanmigo.ai/pricing](https://www.khanmigo.ai/pricing)） |
| **Khan Academy mastery** | 四级掌握度 Attempted → Familiar → Proficient → Mastered；课程掌握度 = Proficient/Mastered 技能占比，Not started/Attempted/Familiar 不计入（Khan Academy 帮助中心 `How is my mastery percentage calculated`，**经搜索摘要读取，页面直连返回 403，未读到原文**） | 掌握度是「技能计数」，不是概率化的知识追踪；无先修图约束的路径求解 | K-12 到大学自学者 |
| **Duolingo Max** | 2023-03-14 上线，GPT-4 驱动 Roleplay + Explain My Answer（[TechCrunch](https://techcrunch.com/2023/03/14/duolingo-launches-new-subscription-tier-with-access-to-ai-tutor-powered-by-gpt-4/)）；当前官网还列有 Video Call（角色 Lily 会记得前几次通话）（[blog.duolingo.com/duolingo-max](https://blog.duolingo.com/duolingo-max/)） | 只覆盖语言学习；日语/韩语/中文只有 Video Call，无 Roleplay（同上） | 付费订阅者，$29.99/月或 $167.99/年（TechCrunch），188 国 |
| **Duolingo Birdbrain** | 预测「学习者答对某道题的概率」，Session Generator 据此挑难度合适的题；2020 年训练、3 月上线，10 月时 20%+ 课程已个性化；A/B 显示「consistently helped our learners learn more」（[Duolingo 工程博客](https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain/)） | 预测目标是**单题正确率**，不是知识点掌握状态；不产出「先修 → 后续」的路径解释 | 全量 Duolingo 用户（非 Max 专属） |
| **Knewton Alta** | 知识图谱：节点=learning objective，有向边=先修关系（A→B 表示必须先会 A）；按 "frontier learning, building on prerequisites, and providing remediation" 推荐；可跨学科补先修（化学用到数学技能）（[Wiley Alta 博客](https://www.wiley.com/en-us/grow/teach-learn/teacher-resources/courseware/knewton-alta/resources/alta-blog-what-are-knewtons-knowledge-graphs/)） | 官方页面未公开掌握度估计的统计模型；课程覆盖窄（数学 19 门、统计 3、化学 4、生物/物理/心理各 1、经济 4）（[Wiley Alta](https://www.wiley.com/en-us/education/alta)） | 高校通识课（higher-ed courseware） |
| **CENTURY Tech** | 英语/数学/科学 KS1–4 自适应课与测评 + 教师数据看板；宣称覆盖 70+ 国家（[century.tech](https://www.century.tech/)） | 官网**没有任何量化效果数据**，只有 "proven to increase student attainment and progress" 的定性表述（同上） | 中小学、FE 学院、培训机构、家庭（£8.33/月起） |

**关键旁证：Khanmigo 的两年集群随机对照试验**（18 所田纳西初中，Khanmigo 设为「引导而非给答案」）：
- 数学成绩提升 **1.3 个国家百分位/学期**，约 **0.06–0.08 SD/学年**；全年活跃参与约 **0.14 SD**；作者明确说这与**不含 AI 的 Khan Academy 练习**效果相近。
  **读法（2026-10-22 复核）**：0.06–0.08 SD 是**正的点估计**，不是零。正确的结论是「**未检测到显著优于无 AI 练习的额外增益**」，不是「没有效果」。且该区间本身可能落在统计不显著的范围内——原文的显著性检验结果本次未取得，不能替作者下「不显著」的判断。引用时写「点估计 0.06–0.08 SD，作者称与无 AI 练习相近」，不要写「零增益」。
- 96% 学生至少试过一次，但中位学生只在 **1/3 的练习日**发消息，在**答错 session 中仅 17%** 会求助；多数消息是裸答案或点预设提示。
- 结论原文：「The binding constraint appears to be engagement」（[NBER w35620](https://www.nber.org/papers/w35620)；[EdWorkingPapers ai26-1551](https://edworkingpapers.com/ai26-1551)）。

> 对选题的含义：**「接入 LLM」本身不构成效果**。评分表里 AI 技术深度 35% 要看的是「Agent/工作流 + RAG + 可控性」，而 Khanmigo 的教训说明**交互设计与学习者状态建模**才是差异点。

---

## 2. 商业产品 · 国内

| 产品 | 做了什么 | 没做什么 | 面向谁 |
| --- | --- | --- | --- |
| **松鼠 AI（乂学）** | 中学数学知识点拆到 **10,000+**（人教版教材约 3,000，ALEKS 约 1,000）；诊断测定位后**由系统决定学习顺序**，非学生自选；图谱随使用数据迭代（[Wikipedia: Squirrel AI](https://en.wikipedia.org/wiki/Squirrel_AI)） | 该条目**未给出任何独立效果数据**，且被标注含 promotional content；贝叶斯网络/BKT/IRT 的说法来自公司新闻稿（[PR Newswire 2019](https://www.prnewswire.com/news-releases/squirrel-ai-learning-by-yixue-group-at-world-summit-ai-americas-wsai-how-does-ai-upgrade-the-education-industry-300862396.html)），非同行评审 | 2019 年称 200 城 2,000 学习中心、100 万+ 学生；2021 年称 60,000+ 公立校（同上）；现主推学习机 + 线下督学（[新浪科技 2024-01-08](https://finance.sina.com.cn/tech/roll/2024-01-08/doc-inaaviqy6291122.shtml)） |
| **科大讯飞 · 个性化学习手册 / 智学网** | 用智学网考试与作业数据生成**知识图谱**，定位薄弱点，按人打印「本本不同」的错题+变式练习册；教师据此分层布置作业（[光明日报报道](https://edu.iflytek.com/about-us/news/media-report/609.html)） | 路径是「错题 → 同类题」的**题目级推荐**，公开材料未见知识点级的知识追踪模型或路径求解；知识图谱主要用于诊断与组卷 | 校内 B 端为主；官网称覆盖 33 个省级行政区、60,000+ 学校、累计 1.6 亿师生（[edu.iflytek.com](https://edu.iflytek.com/)） |
| **讯飞 AI 学习机** | T20 Pro 知识图谱称 **93,000+ 知识点、10 万+ 逻辑关系**；「精准学」按认知水平/目标/区域考情/薄弱点生成学习计划（[智东西](https://zhidx.com/p/362918.html)） | 依赖硬件销售；图谱规模数字为厂商口径，无第三方审计 | C 端家庭，按 3–8 / 8–12 / 12–18 分段 |
| **学而思学习机** | 「精准学 3.0」打通学情数据与知识图谱，做**过滤学**（自动生成课程思维导图）与**过滤练**（挑未掌握/易错/必考题）；底层是**大模型驱动的步骤级知识图谱**；双模型 = 自研九章 + DeepSeek；称 7 亿道题（[量子位 2025-05](https://www.qbitai.com/2025/05/280611.html)） | 「步骤级」指解题步骤粒度，公开材料未说明是否做跨会话的知识状态概率估计；仍是硬件 + 内容库模式 | C 端家庭，P/S/T 三档 |
| **猿辅导 · 海豚 AI 学** | 自研教育大模型首个落地产品；AI 学伴在课中随时提问、苏格拉底式引导；宣称按能力定制学习方案，覆盖 1–9 年级语文/数学/物理/英语（[海豚AI学官网](https://haitunaixue.com/)；[光明网](https://jyj.gmw.cn/2024-10/29/content_37644602.htm)） | 官网**未披露知识图谱或自适应路径的技术细节**，只写「个性化学习内容和规划」 | C 端 1–9 年级 |
| **超星学习通 / 泛雅** | 知识图谱作为**教师建课工具**：梳理课程知识点、可视化展示结构；AI 助教面向学生做学习提醒、难点答疑、资源推荐、智能出题；学情分析面向教师（[北建大教务处通知](https://jwc.bucea.edu.cn/tzgg/a96d71031ec44c6a851cbc77914e806a.htm)） | 公开材料中**没有知识追踪驱动的学习者路径引擎**；「基于错题数据推送薄弱知识点题目」属错题推荐，不是路径规划（同上） | 高校（课程平台 + 教务） |

> 国内产品的共同形态：**B 端进校或硬件售卖 + 专家/大模型建图 + 题目级推荐**。它们把「图谱规模」当卖点（10,000 / 93,000 / 步骤级），但**在我们查到的这 5 家里，未见公开可复现的路径算法或效果评估**（2026-10-22 收紧措辞：这是 5 个样本的观察，不是全称判断）。这对竞赛是机会：**小而可解释的图 + 可验证的路径**比「百万知识点」更适合 30 页技术文档讲清楚。

---

## 3. 开源项目

| 项目 | 做了什么 | 没做什么 | 许可 / 活跃度 |
| --- | --- | --- | --- |
| **K12-KGraph**（PKU-DCAI） | 人教版 K1–K12 数理化生知识图谱：**10,685 节点 / 23,278 边 / 48 册教材**；7 类节点（Book/Chapter/Section/Concept/Skill/Experiment/Exercise）、9 类边（含 `prerequisites_for`、`verifies`、`tests_concept`）；Fleiss κ=0.84，DAG 校验，每条边带教材原文 evidence；附 K12-Bench 23,640 题（[GitHub](https://github.com/haolpku/K12-KGraph)） | **是数据集不是系统**：无学习者模型、无路径求解、无前端；数据 **CC BY-NC-SA 4.0（禁商用）**；只覆盖人教版、只覆盖 4 科 | 数据 CC BY-NC-SA 4.0 / 代码 MIT；422★；NeurIPS 2026 D&B |
| **cn-k12-math-knowledge-graph** | 1–9 年级数学先修图：18 册 / 132 章 / 1,327 主题 / 1,204 条先修边（609 条来自 K12-KGraph + 420 审核补强 + 175 AI 补强）；离线单文件 Three.js 3D 浏览器（[GitHub](https://github.com/haojing8312/cn-k12-math-knowledge-graph)） | 只有「看」，没有「学」：无诊断、无推荐、无作答记录 | 数据 CC BY-NC-SA 4.0 / 代码 Apache-2.0（仓库内 LICENSE-DATA、LICENSE-CODE 两份）；50★ |
| **education_knowledge_graph_app** | Neo4j + Django：学科图谱展示、题目→知识点追踪（子→父→根）、关系查询、知识点预测（[GitHub](https://github.com/jiangnanboy/education_knowledge_graph_app)） | 2022-09 后停更；**无 LICENSE**；无学习者状态、无路径 | 无许可 / 150★ |
| **Open edX** | 平台本身；2018 年社区 wiki 记录的自适应方案全部是**外部 LTI 引擎**（SCALE/TutorGen/Domoscio），且承认要靠「隐藏 XBlock URL」「提交后等 2 秒传成绩」等 workaround（[Open edX Wiki](https://openedx.atlassian.net/wiki/spaces/AC/pages/575799401/Adaptive+Learning+Tools+and+Engines)） | **平台无原生自适应引擎**；内容打标与排序需平台外人工完成；Open edX 的 AI Course Creator 公告把 "Adaptive AI powered Learning paths" 列为**未来能力而非 v2 已发布功能**（[openedx.org 博客](https://openedx.org/blog/introducing-the-ai-course-creator-for-the-open-edx-platform/)） | 平台 **AGPL-3.0**（8.2k★）；自适应能力缺口仍在 |
| **Moodle mod_adaptivequiz** | 计算机自适应测验（CAT）：按 Wright 1988 "Practical Adaptive Testing CAT Algorithm"，用 Rasch/1PL 估单维能力值，答对升难度、答错降难度，达到精度即停（[middlebury README](https://github.com/middlebury/moodle-mod_adaptivequiz)；[MoodleDocs](https://docs.moodle.org/502/en/Adaptive_Quiz_-_Advanced_CAT_Module) 称其基础版为 1PL Rasch） | **只估一个标量能力值**，不区分知识点、不建先修图、不排学习路径；题目难度需教师预先标注；原仓库 archived（35★），开发转到 Moodle 插件目录的 fork | 仓库未声明 LICENSE 文件；Moodle 生态惯例 GPL |
| **Moodle mod_capquiz** | 计算机自适应**练习**：用 rating 衡量熟练度，答对升、答错降，需长期保持正确率才能提升；题目难度由系统随作答逐步校正（[KQMATH README](https://github.com/KQMATH/moodle-mod_capquiz)） | 同样是单维 rating，无知识结构；7★，2026-09 仍在更新 | GPL-3.0；7★ |
| **Moodle AI subsystem (4.5+)** | Providers / Placements / Actions 三层，把 LLM 能力接进 LMS；核心约束是「Placements 不知道 Providers，反之亦然」（[moodledev.io](https://moodledev.io/docs/4.5/apis/subsystems/ai)） | **不含任何学习者建模**：文档里的用例是摘要、生成、聊天；无 mastery tracking、无内容排序 | GPL；Moodle 核心 |
| **OATutor**（UC Berkeley CAHLR） | 开源 ITS：每个 knowledge component 有 mastery/transit/slip/guess 四参数，答完按 BKT 更新；默认选题策略 = 选「所有 KC 掌握概率均值最低」的题；带 hint/scaffold 路径与内置 A/B 测试（[GitHub](https://github.com/CAHLR/OATutor)） | **无 LLM**、无先修图、无自然语言讲解；内容是人工编写的 JSON 题库（内容在独立子模块 OATutor-Content） | 代码 MIT（Copyright 2023 Zachary A. Pardos / CAHL）；内容子模块 CC BY 4.0；268★；2026-10-21 仍在提交 |
| **ALOSI**（Harvard VPAL） | 自适应引擎 + Bridge + Python 包，曾是 Open edX 的推荐后端（[alosi](https://github.com/harvard-vpal/alosi)） | **事实性停更**：alosi 最后提交 2022-12（5★），adaptive-engine / bridge-adaptivity 最后提交 2021-06（各 38★） | Apache-2.0 / BSD-3 |
| **pyKT** | 深度知识追踪 benchmark：7 个数据集、10 个 DLKT 模型的标准化预处理与评测，NeurIPS 2022 D&B（[arXiv:2206.11460](https://arxiv.org/abs/2206.11460)） | **离线 benchmark，不是产品**；作者自陈现有评测 "far away real-world educational contexts"，且警告错误评测设置会导致 **label leakage** 与性能虚高，很多方法相对 Piech 原始 DKT 增益极小 | MIT；451★ |
| **EduKTM** | 知识追踪模型动物园：KPT / EKPT / DKT / DKT+ / DKVMN / GKT / AKT / LPKT / LBKT 共 9 个模型（[GitHub](https://github.com/bigdata-ustc/EduKTM)） | 同上：只到模型层，无服务化、无路径规划、无前端 | Apache-2.0；267★；2024-01 后未更新 |
| **OpenTutor** | 本地优先的 LLM 学习工作台：上传 PDF → 笔记/闪卡/测验/导师；FSRS 4.5 间隔重复；知识图谱（LOOM）追踪概念掌握与先修、生成学习路径；语义复习（LECTOR）（[GitHub](https://github.com/zijinz456/OpenTutor)） | 作者自标：知识图谱与语义复习 `[Experimental]`；**「Multi-user SaaS/classroom mode is out of scope for this beta」**；单用户本地部署 | MIT；148★；2026-10-20 仍在提交 |

**前沿论文（说明「技术可行但尚未产品化」）**
- **KnowLP**（[arXiv:2506.22303](https://arxiv.org/abs/2506.22303)）：指出只靠先修关系建路径会因「任一阶段卡住就阻断后续」，提出先修 + 相似度双关系，用 EDU-GraphRAG + 判别式强化学习（DLRL）生成路径，并给出可解释推理。
- **RAG-KT**（[arXiv:2604.10960](https://arxiv.org/abs/2604.10960)）：跨平台知识追踪 = 检索增强的 LLM 推断，解决传统 DKT「依赖平台私有 ID、难迁移难解释」的问题；预印本。
- **LOOM**（[arXiv:2511.21037](https://arxiv.org/abs/2511.21037)，AAAI 2026 PerFM Workshop）：从 LLM 对话推断学习者需求 + 动态 learner memory graph，生成「相邻概念相连、暴露 gap」的模块；仅 10 人形成性研究，用户反馈「想要更多一致性和控制权」。

---

## 4. 能力矩阵（● 有 / ◐ 部分 / ○ 无 / ? 未公开）

| 能力 | Khanmigo | Knewton Alta | 松鼠AI | 讯飞手册 | 学而思 | 超星 | OATutor | OpenTutor | Open edX | Moodle |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 知识点级知识追踪 | ? | ◐ | ◐ | ? | ? | ○ | ● (BKT) | ◐ | ○ | ○ |
| 先修关系图 | ○ | ● | ● | ● | ● | ◐ | ○ | ◐ | ○ | ○ |
| 路径生成（而非单题推荐） | ? | ● | ● | ◐ | ◐ | ○ | ◐ | ◐ | ○ | ○ |
| LLM 对话/讲解 | ● | ○ | ◐ | ◐ | ● | ● | ○ | ● | ◐ | ◐ |
| 学习者可解释的推荐理由 | ? | ◐ | ○ | ○ | ○ | ○ | ◐ | ? | ○ | ○ |
| 教师/学生可干预路径 | ○ | ○ | ○ | ◐ | ◐ | ◐ | ◐ | ◐ | ○ | ◐ |
| 开源可自部署 | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ● | ● |
| 免费面向个人 | ◐ ($4/月,限美国) | ○ | ○ | ○ | ○ | ◐ | ● | ● | ● | ● |

> 读图结论：**「LLM 讲解」与「知识追踪 + 先修图」没有在同一个开源产品里同时成立**（OATutor 有 BKT 无 LLM，OpenTutor 有 LLM 但 KG 仅 Experimental）；而「学习者可解释的推荐理由」「教师/学生可干预路径」两列**没有任何一个产品拿到 ●**。

---

## 5. 空白点 → 评分表映射

| # | 空白点（有来源支撑） | 能直接写进技术方案的做法 | 对应评分项 |
| --- | --- | --- | --- |
| **G1** | **学习者模型不持久、不可解释**。商业产品要么是专家图 + 静态诊断（松鼠：诊断后「learning is not student-directed」，[Wikipedia](https://en.wikipedia.org/wiki/Squirrel_AI)），要么是对话导师（Khanmigo 的 AI 层相对无 AI 的 Khan Academy 练习无额外增益，[NBER w35620](https://www.nber.org/papers/w35620)）。pyKT 又指出学界评测脱离真实场景（[arXiv:2206.11460](https://arxiv.org/abs/2206.11460)）。 | 双通道学习者模型：**BKT/DKT 输出每 KC 掌握概率（数值）+ LLM 输出错因归因（文本）**；每条推荐挂「证据链」：哪次作答 → 哪个 KC → 哪条先修边 → 为什么现在学它。掌握度随时间衰减，跨会话持久化到 DB。 | **选题创新 10**（未被满足的需求）+ **技术方案创新 8** |
| **G2** | **图谱与 LLM 脱节**。K12-KGraph 是静态数据集且禁商用（[GitHub](https://github.com/haolpku/K12-KGraph)）；RAG-KT / KnowLP 停留在论文（[arXiv:2604.10960](https://arxiv.org/abs/2604.10960)、[arXiv:2506.22303](https://arxiv.org/abs/2506.22303)）；没有产品把先修边变成生成内容的**硬约束**。 | Graph-constrained generation：先修边作为 **Function Calling / MCP tool 的 schema**（`get_prerequisites(kc_id)`、`next_candidate(learner_id)`），LLM 只能从图允许的候选集里选；RAG 用**图检索 + 向量检索双路**，命中先修链时强制注入上下文。 | **技术方案创新 8** + AI 技术深度（RAG 6%、Agent 8%、MCP 4%） |
| **G3** | **路径不可干预**。Knewton 的推荐遵循单向的 "frontier learning"（[Wiley Alta 博客](https://www.wiley.com/en-us/grow/teach-learn/teacher-resources/courseware/knewton-alta/resources/alta-blog-what-are-knewtons-knowledge-graphs/)）；松鼠明确「learning is not student-directed」（Wikipedia 同上）；LOOM 的用户反馈正是「想要更多控制权」（[arXiv:2511.21037](https://arxiv.org/abs/2511.21037)）。 | **Mixed-initiative 路径**：可视化 DAG 上直接拖拽重排；每次手动调整后 LLM 解释「这样改会缺哪条先修」并给出代价估计；提供 what-if 反事实（「跳过这个节点，预计正确率下降 X%」）。 | **交互模式创新 7**（权重最高的交互项） |
| **G4** | **冷启动无解**。BKT 要每 KC 四参数（[OATutor](https://github.com/CAHLR/OATutor)），DKT 要长序列（[pyKT](https://arxiv.org/abs/2206.11460)），松鼠靠百万学生数据（Wikipedia 同上）。新用户前 10 分钟没有任何作答。 | 三级冷启动：① LLM 先验初始化 KC 难度与先修强度 → ② 10–15 题 CAT（Rasch/IRT，参考 [Moodle Adaptive Quiz](https://github.com/middlebury/moodle-mod_adaptivequiz) 的做法）快速定位 → ③ 贝叶斯在线更新，并显式展示「当前置信度低」而不是假装确定。 | **技术方案创新 8** + 实用性（方案有效性 5%） |
| **G5** | **开源侧没有「多用户 + 可部署 + LLM + 知识追踪」四者兼备的项目**。OATutor 有 BKT 无 LLM；OpenTutor 有 LLM 但 KG 标 Experimental 且明说 multi-user 不在范围内（[GitHub](https://github.com/zijinz456/OpenTutor)）；Open edX / Moodle 只有 CAT（[Open edX Wiki](https://openedx.atlassian.net/wiki/spaces/AC/pages/575799401/Adaptive+Learning+Tools+and+Engines)）。 | 定位差异化：**面向高校课程/竞赛备赛的多人 Web 应用**（不是 K12 提分硬件，避开红海与监管），Next.js + 自建 BKT 服务 + 图数据库，Docker 一键起。 | **选题创新 10** + 社会价值（教育公平 5%） |
| **G6** | **路径呈现是列表/色块，不是可读的图**。松鼠官网描述其追踪方式是知识点在图上 red→green 变色（[squirrelai.com/how-it-works](https://squirrelai.com/how-it-works/)）；讯飞的产出是按人打印的错题练习册，学而思的「过滤练」是挑题清单（见 §2 来源）。 | 力导向/3D 知识图 + 时间轴双视图；节点颜色 = 掌握概率，边粗细 = 先修强度；点击节点展开「已学/待学/阻塞中」三态与推荐理由。 | **交互模式创新 7** + 用户体验（UI 4%、交互 3%） |

---

## 6. 建议的差异化定位（一句话）

> **不做「又一个 AI 讲题机器人」，也不做「又一个百万知识点的诊断报告」，而是做「一张会解释自己、也能被你和老师改写的学习路径图」**——把 BKT 的概率、先修图的约束、LLM 的讲解三者在同一个界面上对齐，且开源可部署。

三条可直接落地的技术选型：
1. **知识图谱**：以 K12-KGraph（10,685 节点、带 evidence、DAG 校验）为种子做**子图裁剪**（只取目标课程相关节点）。注意其数据为 **CC BY-NC-SA 4.0（禁止商业使用）**，竞赛提交需在 README 明确署名、注明许可并说明改动；若担心合规，可退到 cn-k12-math（同为 NC）或自建小图。**这一条建议在选题定稿前请指导老师确认。**
2. **知识追踪**：自实现 BKT（参考 OATutor 的四参数模型，MIT 可借鉴）+ 可选 DKT（参考 pyKT 的数据管线），**不要把 pyKT 的 AUC 当效果证据**——它自己说评测设置会导致虚高。
3. **LLM 层**：Vercel AI SDK 流式输出 + Function Calling 暴露图查询；RAG 用「图检索优先、向量兜底」的双路，避免纯向量检索把先修关系丢掉。

---

## 7. 未找到可靠来源 / 需谨慎的点

- **松鼠 AI 的算法细节与效果**：贝叶斯网络/BKT/IRT 的说法只见于公司新闻稿与媒体转述；Wikipedia 条目被标注含宣传内容，**无独立同行评审的效果数据**。不要引用「提分 XX%」类数字。
- **Knewton Alta 的掌握度估计模型**：官方博客只讲图结构与推荐原则（frontier / remediation），**未公开统计模型**。不要写「Knewton 用 BKT」。
- **讯飞/学而思/猿辅导的知识追踪算法**：公开材料只有「知识图谱」「步骤级图谱」「个性化规划」等营销表述，**无模型细节、无第三方评测**。可写「厂商称」，不可写「采用 XX 算法」。
- **超星学习通的用户规模**：官方 2019 年称注册用户 2,400 万（[超星官方](http://cxjfzx.ctld.chaoxing.com/pubcontent/info?id=159)）；「覆盖 95% 高校」来自 BOSS 直聘公司简介的媒体转述（[南方周末](https://www.infzm.com/contents/231259)），**属二手信息**。
- **自适应学习 meta 分析 g=0.70**：Wang et al. (2024), *Journal of Educational Computing Research*。检索结果中 ERIC 记录（EJ1441048）与 Sage 摘要页均显示该效应量，但**本次两次直连 ERIC / Sage 均被重置（ECONNRESET），未能读到原文全文**。引用时注明「据检索摘要」。
- **Khanmigo 是否有跨会话记忆**：仅检索到第三方博客的批评性说法（memu.pro），**未获 Khan Academy 官方文档确认**，故正文未作为事实断言，只写「未公开说明」。
