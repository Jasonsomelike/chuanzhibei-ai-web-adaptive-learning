/**
 * 学术英语写作知识图谱与题库：40 个知识点 / 60 条先修边 / 120 题。
 *
 * 课程依据：国内高校《学术英语写作》通用教学大纲（从句子到语篇的学术写作训练）。
 * 每条边都是「不掌握前者，后者学不动」的真实依赖，不是按章节顺序硬连：
 * 例如文献综述依赖衔接手段，引言中的空白陈述依赖文献综述的收束，讨论中的解释依赖模糊限制语。
 *
 * 题目形态：中文题干 + 英文例句/选项混排，考「哪种表达更符合学术规范」「句间逻辑关系是什么」，
 * 而不是单词翻译；解析用中文说明，并引用英文例句。
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";

export const academicWritingGraph: KnowledgeGraph = {
  version: "kg-academic-writing-v1",
  concepts: [
    // ── 第 1 章 句子结构与语法 ──
    { id: "w01", name: "句子成分与基本句型", chapter: "第1章 句子结构与语法", summary: "主谓宾补等成分与五种基本句型的识别" },
    { id: "w02", name: "主谓一致", chapter: "第1章 句子结构与语法", summary: "中心词、就近原则与插入成分对一致关系的影响" },
    { id: "w03", name: "时态与语态选择", chapter: "第1章 句子结构与语法", summary: "背景、方法、结果与普遍事实各自的时态语态" },
    { id: "w04", name: "名词化表达", chapter: "第1章 句子结构与语法", summary: "把动作与从句压缩为名词短语，提高信息密度" },
    { id: "w05", name: "修饰语与悬垂修饰", chapter: "第1章 句子结构与语法", summary: "修饰语位置、辖域与悬垂结构的识别和修正" },

    // ── 第 2 章 段落组织 ──
    { id: "w06", name: "主题句", chapter: "第2章 段落组织", summary: "限定段落中心、预示展开方向的控制句" },
    { id: "w07", name: "支持句与细节", chapter: "第2章 段落组织", summary: "用证据、解释与限定支撑主题句" },
    { id: "w08", name: "段落统一性", chapter: "第2章 段落组织", summary: "所有句子服务于同一中心，剔除离题材料" },
    { id: "w09", name: "衔接与过渡", chapter: "第2章 段落组织", summary: "连接词、指代与已知信息-新信息顺序" },
    { id: "w10", name: "段落展开模式", chapter: "第2章 段落组织", summary: "比较对比、因果、分类等展开结构的组织" },

    // ── 第 3 章 论证逻辑 ──
    { id: "w11", name: "论点与论据", chapter: "第3章 论证逻辑", summary: "可检验的主张与支撑证据的对应关系" },
    { id: "w12", name: "逻辑谬误识别", chapter: "第3章 论证逻辑", summary: "诉诸大众、滑坡、以偏概全等常见谬误" },
    { id: "w13", name: "因果关系的表达", chapter: "第3章 论证逻辑", summary: "区分相关与因果，避免后此谬误" },
    { id: "w14", name: "让步与反驳", chapter: "第3章 论证逻辑", summary: "承认对立观点后回应，避免稻草人" },
    { id: "w15", name: "论证的充分性与范围限定", chapter: "第3章 论证逻辑", summary: "结论强度与证据强度匹配，避免过度概括" },

    // ── 第 4 章 学术词汇与搭配 ──
    { id: "w16", name: "正式语体与口语化表达", chapter: "第4章 学术词汇与搭配", summary: "书面语体、缩略形式与口语短语的替换" },
    { id: "w17", name: "学术动词与报告动词", chapter: "第4章 学术词汇与搭配", summary: "argue、suggest、corroborate 等动词的语义强度" },
    { id: "w18", name: "常见搭配与介词", chapter: "第4章 学术词汇与搭配", summary: "research on、consistent with 等固定搭配" },
    { id: "w19", name: "模糊限制语", chapter: "第4章 学术词汇与搭配", summary: "may、suggest、tend to 等表达认识上的谨慎" },
    { id: "w20", name: "词汇重复与同义替换", chapter: "第4章 学术词汇与搭配", summary: "术语一致性与避免口语化、夸张化替换" },

    // ── 第 5 章 引用与文献 ──
    { id: "w21", name: "引用功能与引用类型", chapter: "第5章 引用与文献", summary: "叙述性引用与括号引用，以及引用的论证功能" },
    { id: "w22", name: "直接引用与改写", chapter: "第5章 引用与文献", summary: "引号使用、规范转述与拼凑式抄袭" },
    { id: "w23", name: "文献综述的组织", chapter: "第5章 引用与文献", summary: "按主题综合文献，并在结尾指出空白" },
    { id: "w24", name: "引用格式与参考文献", chapter: "第5章 引用与文献", summary: "作者-年份制、文献表排序与同年多篇区分" },
    { id: "w25", name: "学术诚信与抄袭规避", chapter: "第5章 引用与文献", summary: "自我抄袭、规范标注与不当使用的界限" },

    // ── 第 6 章 摘要与引言 ──
    { id: "w26", name: "摘要的功能与结构", chapter: "第6章 摘要与引言", summary: "目的、方法、结果、结论四要素与结构式摘要" },
    { id: "w27", name: "摘要的时态与信息密度", chapter: "第6章 摘要与引言", summary: "背景用现在时、方法用过去时与高密度表达" },
    { id: "w28", name: "引言 CARS 模型", chapter: "第6章 摘要与引言", summary: "确立领域、指出空白、占据研究空间三语步" },
    { id: "w29", name: "研究空白与问题陈述", chapter: "第6章 摘要与引言", summary: "具体化空白，并与研究问题一一对应" },
    { id: "w30", name: "研究目的与贡献陈述", chapter: "第6章 摘要与引言", summary: "明确研究要做什么、填补什么空白" },

    // ── 第 7 章 方法与结果 ──
    { id: "w31", name: "方法部分的语步与语态", chapter: "第7章 方法与结果", summary: "方法部分的语步顺序与主动被动的选择" },
    { id: "w32", name: "研究对象与材料描述", chapter: "第7章 方法与结果", summary: "样本量、来源、关键特征与可复现性" },
    { id: "w33", name: "数据呈现与图表描述", chapter: "第7章 方法与结果", summary: "描述趋势、突出关键发现而非复述数字" },
    { id: "w34", name: "结果陈述与统计显著性", chapter: "第7章 方法与结果", summary: "significant 的统计含义与不显著结果的表述" },
    { id: "w35", name: "结果与方法的一致性", chapter: "第7章 方法与结果", summary: "只报告预设分析，避免在结果中解释因果" },

    // ── 第 8 章 讨论与结论 ──
    { id: "w36", name: "讨论部分的结构", chapter: "第8章 讨论与结论", summary: "重述发现、解释、比较、意义与局限的顺序" },
    { id: "w37", name: "结果解释与文献对比", chapter: "第8章 讨论与结论", summary: "与既有研究一致或冲突时的解释策略" },
    { id: "w38", name: "局限性与未来研究", chapter: "第8章 讨论与结论", summary: "说明局限的具体影响并据此提出研究方向" },
    { id: "w39", name: "结论与建议的写法", chapter: "第8章 讨论与结论", summary: "收束发现、说明启示，建议不超出证据" },
    { id: "w40", name: "全文一致性与修订", chapter: "第8章 讨论与结论", summary: "问题-方法-结果-结论对应与反向提纲检查" },
  ],
  edges: [
    // 第 1 章：句子层面的依赖
    { before: "w01", after: "w02" },
    { before: "w01", after: "w03" },
    { before: "w01", after: "w04" },
    { before: "w01", after: "w05" },

    // 第 2 章：从句子到段落
    { before: "w01", after: "w06" },
    { before: "w06", after: "w07" },
    { before: "w06", after: "w08" },
    { before: "w07", after: "w09" },
    { before: "w08", after: "w10" },
    { before: "w09", after: "w10" },
    { before: "w05", after: "w07" },

    // 第 3 章：论证逻辑
    { before: "w07", after: "w11" },
    { before: "w08", after: "w11" },
    { before: "w11", after: "w12" },
    { before: "w11", after: "w13" },
    { before: "w12", after: "w14" },
    { before: "w13", after: "w15" },
    { before: "w11", after: "w15" },
    { before: "w14", after: "w15" },

    // 第 4 章：学术词汇
    { before: "w04", after: "w16" },
    { before: "w16", after: "w17" },
    { before: "w16", after: "w18" },
    { before: "w17", after: "w19" },
    { before: "w18", after: "w19" },
    { before: "w17", after: "w20" },
    { before: "w18", after: "w20" },
    { before: "w15", after: "w19" },

    // 第 5 章：引用与文献
    { before: "w11", after: "w21" },
    { before: "w21", after: "w22" },
    { before: "w21", after: "w23" },
    { before: "w22", after: "w24" },
    { before: "w23", after: "w24" },
    { before: "w22", after: "w25" },
    { before: "w09", after: "w23" },
    { before: "w20", after: "w22" },

    // 第 6 章：摘要与引言
    { before: "w23", after: "w28" },
    { before: "w21", after: "w28" },
    { before: "w28", after: "w29" },
    { before: "w29", after: "w30" },
    { before: "w26", after: "w27" },
    { before: "w30", after: "w26" },

    // 第 7 章：方法与结果
    { before: "w03", after: "w31" },
    { before: "w04", after: "w31" },
    { before: "w31", after: "w32" },
    { before: "w32", after: "w33" },
    { before: "w32", after: "w34" },
    { before: "w33", after: "w34" },
    { before: "w34", after: "w35" },
    { before: "w31", after: "w35" },

    // 第 8 章：讨论与结论
    { before: "w30", after: "w36" },
    { before: "w34", after: "w36" },
    { before: "w36", after: "w37" },
    { before: "w36", after: "w38" },
    { before: "w37", after: "w39" },
    { before: "w38", after: "w39" },
    { before: "w15", after: "w36" },
    { before: "w39", after: "w40" },
    { before: "w10", after: "w40" },
    { before: "w25", after: "w40" },
    { before: "w35", after: "w40" },
  ],
};

export const academicWritingQuestions: readonly Question[] = [
  // ── w01 句子成分与基本句型 ──
  { id: "q-w01-1", kcId: "w01", difficulty: 1, stem: "句子 'The results suggest a strong correlation.' 的主干成分划分是：", options: ["主语 The results + 系动词 suggest + 表语 a strong correlation", "主语 The results suggest + 谓语 a strong correlation", "主语 The results + 谓语 suggest + 宾语 a strong correlation", "主语 The results + 谓语 suggest + 补语 a strong correlation"], answerIndex: 2, explanation: "suggest 在此为及物动词，后接名词短语作宾语，构成主谓宾（SVO）结构。若把 suggest 当系动词，则需形容词或名词作表语，但 a strong correlation 是 suggest 的动作对象，并非说明主语身份或状态。" },
  { id: "q-w01-2", kcId: "w01", difficulty: 2, stem: "下列句子属于「主语 + 谓语 + 间接宾语 + 直接宾语」（SVOO）结构的是：", options: ["The committee awarded a prize to the team.", "The committee was awarded a prize.", "The committee's award surprised the team.", "The committee awarded the team a prize."], answerIndex: 3, explanation: "awarded the team a prize 中 the team 是间接宾语、a prize 是直接宾语，两个名词短语依次跟在动词后，构成 SVOO。选项 1 用介词 to 引出接受者，属于 SVOA；选项 2 是被动结构；选项 3 的主语是 award，只有 surprised the team 一个宾语。" },
  { id: "q-w01-3", kcId: "w01", difficulty: 3, stem: "下列句子属于「主语 + 谓语 + 宾语 + 宾语补足语」（SVOC）结构的是：", options: ["The findings supported the hypothesis.", "The findings made the hypothesis plausible.", "The findings were made by the hypothesis.", "The findings made a plausible hypothesis."], answerIndex: 1, explanation: "made the hypothesis plausible 中 plausible 描述宾语 the hypothesis 的状态，是宾语补足语，去掉后句子意义不完整。选项 1 只有一个宾语；选项 3 是被动句；选项 4 的 a plausible hypothesis 整体作宾语，plausible 只是定语，不是补足语。" },

  // ── w02 主谓一致 ──
  { id: "q-w02-1", kcId: "w02", difficulty: 2, stem: "选择正确形式：'The number of participants ___ increasing steadily.'", options: ["were", "was", "have been", "are"], answerIndex: 1, explanation: "主语中心词是 The number（单数），of participants 只是修饰语，因此谓语用单数 was。若写成 A number of participants 则中心词变为复数 participants，谓语才用 were 或 are，这是两种容易混淆的句式。" },
  { id: "q-w02-2", kcId: "w02", difficulty: 3, stem: "选择正确形式：'Neither the participants nor the researcher ___ aware of the assignment.'", options: ["were", "have been", "was", "are"], answerIndex: 2, explanation: "neither...nor 连接两个主语时遵循就近原则，谓语与最靠近的 the researcher 保持一致，用单数 was。若把并列主语整体视为复数而选 were，或误用完成时 have been，都忽略了这一规则。" },
  { id: "q-w02-3", kcId: "w02", difficulty: 4, stem: "选择正确形式：'The committee, together with its external reviewers, ___ the proposal before the deadline.'", options: ["has approved", "have approved", "have been approving", "are approving"], answerIndex: 0, explanation: "主语是 The committee（单数集合名词），together with its external reviewers 是插入的伴随成分，不改变主谓一致，故用 has approved。若被 reviewers 干扰而选复数形式，是学术写作中常见的一致错误。" },

  // ── w03 时态与语态选择 ──
  { id: "q-w03-1", kcId: "w03", difficulty: 1, stem: "描述已有研究反复证实的普遍结论时，最常用的时态是：", options: ["一般过去时（Research showed that...）", "一般将来时（Research will show that...）", "过去完成时（Research had shown that...）", "一般现在时（Research shows that...）"], answerIndex: 3, explanation: "被普遍接受的知识被视为当前仍然成立，用一般现在时，如 Research shows that...。一般过去时适合报告某一项已完成的具体研究，将来时用于计划，过去完成时表示更早的过去，都不适合陈述普遍结论。" },
  { id: "q-w03-2", kcId: "w03", difficulty: 2, stem: "方法部分描述本研究已完成的实验操作，最典型的表达是：", options: ["Samples are collected from three sites.", "Samples were collected from three sites.", "Samples will be collected from three sites.", "Samples have been being collected from three sites."], answerIndex: 1, explanation: "方法部分叙述本研究已经完成的操作用一般过去时被动，强调操作与材料而非执行者，故为 were collected。一般现在时会让读者误以为这是普遍做法，将来时指尚未进行，选项 4 的时态形式本身不成立。" },
  { id: "q-w03-3", kcId: "w03", difficulty: 3, stem: "结果部分描述图表所反映的一般规律，较合适的时态是：", options: ["一般将来时，如 The data will indicate that...", "过去完成时，如 The data had indicated that...", "一般现在时，如 The data indicate that...", "现在完成进行时，如 The data have been indicating that..."], answerIndex: 2, explanation: "图表是读者当前可见的证据，其显示的规律通常用一般现在时陈述，如 The data indicate that...。将来时把结论推后，过去完成时暗示在另一过去事件之前，完成进行时强调持续过程，都不符合此处功能。" },

  // ── w04 名词化表达 ──
  { id: "q-w04-1", kcId: "w04", difficulty: 2, stem: "下列哪一句更符合学术写作的正式语体？", options: ["The implementation of the policy led to a reduction in costs.", "They implemented the policy and then costs went down.", "They put the policy in place and costs dropped.", "The policy got implemented, so costs went down."], answerIndex: 0, explanation: "第一句把 implement 与 reduce 转为名词 implementation、reduction，信息密度高、语体正式。其余句子使用口语化的动词短语、get 被动和 then、so 等衔接，适合日常表达而非学术论文。" },
  { id: "q-w04-2", kcId: "w04", difficulty: 3, stem: "过度使用名词化最可能导致的问题是：", options: ["句子时态无法确定", "句子变成被动语态", "文章自动变得不连贯", "动作的施事被隐藏，句子冗长且难以判断谁做了什么"], answerIndex: 3, explanation: "名词化把动词压缩成抽象名词后，动作的执行者常被省略，如 the reduction of costs 看不出是谁削减的，多个抽象名词叠加还会使句子沉重。名词化本身不决定时态，也不等于被动语态，更不会自动破坏连贯性。" },
  { id: "q-w04-3", kcId: "w04", difficulty: 4, stem: "把 'We analyzed the data and found that...' 改写为更正式的名词化表达，最恰当的是：", options: ["The data were analyzed and it was found that...", "An analysis of the data revealed that...", "Our analysis was found that...", "Analyzing the data, the finding was that..."], answerIndex: 1, explanation: "An analysis of the data revealed that 把两个动作整合为名词短语作主语，既正式又简洁。选项 1 仍用两个分句且冗长，选项 3 的 Our analysis was found that 结构不成立，选项 4 中 the finding 不会执行 analyzing，构成悬垂修饰。" },

  // ── w05 修饰语与悬垂修饰 ──
  { id: "q-w05-1", kcId: "w05", difficulty: 1, stem: "下列句子中，存在悬垂修饰（dangling modifier）的是：", options: ["Having collected the samples, we conducted the analysis.", "After we collected the samples, the analysis was conducted.", "Having collected the samples, the analysis was conducted.", "We collected the samples and then conducted the analysis."], answerIndex: 2, explanation: "分词短语的逻辑主语应与主句主语一致，但 the analysis 不会收集样本，分词因此悬垂。选项 1 的主语 we 与分词动作一致；选项 2 用从句明确施事；选项 3 用并列谓语，都不存在该问题。" },
  { id: "q-w05-2", kcId: "w05", difficulty: 2, stem: "修正 'To improve accuracy, the model was retrained.' 的最佳方式是：", options: ["To improve accuracy, the model retrained.", "The model was retrained to improve accuracy by us.", "Improving accuracy, the model was retrained.", "To improve accuracy, we retrained the model."], answerIndex: 3, explanation: "目的状语的逻辑主语应是有能力执行该动作的人，we retrained the model 明确了施事。选项 1 让 model 自己训练，逻辑不通；选项 2 冗赘且 by us 位置生硬；选项 3 仍是悬垂结构。" },
  { id: "q-w05-3", kcId: "w05", difficulty: 3, stem: "'The researcher only reviewed the data.' 与 'The researcher reviewed only the data.' 的差别在于：", options: ["前者强调只做了回顾这一动作，后者强调只回顾了数据而未做其他处理", "两句完全相同，只是语序不同", "前者语法错误，后者正确", "前者是被动语态，后者是主动语态"], answerIndex: 0, explanation: "only 的位置决定其辖域：放在 reviewed 前修饰整个动作，放在 the data 前则限定宾语范围，两句的语义焦点因此不同。两句都合乎语法，也都是主动语态，不能视为完全等义。" },

  // ── w06 主题句 ──
  { id: "q-w06-1", kcId: "w06", difficulty: 2, stem: "下列哪句最适合作为一段学术段落的主题句？", options: ["Remote work is a very important topic today.", "According to a 2022 survey, 43 percent of respondents worked from home.", "Remote work has reshaped urban commuting patterns in three measurable ways.", "Many people have different opinions about remote work."], answerIndex: 2, explanation: "主题句应限定话题范围并预示展开结构，three measurable ways 明确告诉读者段落将如何组织。选项 1 过泛，选项 2 是具体证据而非中心判断，选项 3 只说明存在分歧，没有表明本段要论证什么。" },
  { id: "q-w06-2", kcId: "w06", difficulty: 3, stem: "主题句在段落中的主要功能是：", options: ["提供段落中最有力的数据", "限定段落的中心与范围，并预示后续展开方向", "总结上一段的内容", "引出全篇的参考文献"], answerIndex: 1, explanation: "主题句是段落的控制句，既表明本段讨论什么，也暗示如何展开，后续支持句都应服务于它。具体数据属于支持句，总结上一段通常是过渡句的功能，参考文献则不属于主题句的职责。" },
  { id: "q-w06-3", kcId: "w06", difficulty: 4, stem: "以 'Technology has changed education.' 作为主题句的主要问题是：", options: ["使用了现在完成时", "没有出现具体数字", "句子太短", "过于宽泛，无法在一个段落内用具体证据充分支撑"], answerIndex: 3, explanation: "该句涵盖范围过大，读者无法预期段落将聚焦哪一方面，作者也难以在有限篇幅内完成论证。时态、数字和句长都不是主题句成立与否的关键，关键在于中心是否具体到一段可支撑的程度。" },

  // ── w07 支持句与细节 ──
  { id: "q-w07-1", kcId: "w07", difficulty: 1, stem: "支持句与主题句之间最理想的关系是：", options: ["每句都直接解释、例证或限定主题句提出的判断", "每句都引入一个全新的话题", "每句都重复主题句的措辞", "每句都引用不同文献"], answerIndex: 0, explanation: "支持句的任务是为主题句提供证据、解释或限定，使中心判断可信。引入新话题会破坏段落统一性，机械重复不增加信息，引用文献也只是提供证据的一种手段，不能替代与主题句的逻辑关联。" },
  { id: "q-w07-2", kcId: "w07", difficulty: 2, stem: "主题句为 'Regular exercise improves cognitive function.'，下列哪句最不适合作为支持句？", options: ["A meta-analysis of 29 trials found moderate improvements in memory.", "The campus cafeteria now offers more vegetarian options.", "Aerobic activity increases blood flow to the hippocampus.", "However, the effect is smaller in adults over 70."], answerIndex: 1, explanation: "食堂菜谱与运动改善认知没有直接关系，属于偏离主题。其余三句分别提供元分析证据、生理机制和范围限定，都能从不同角度支撑主题句，其中最后一句还体现了学术写作中必要的限定意识。" },
  { id: "q-w07-3", kcId: "w07", difficulty: 3, stem: "一个支持句写道 'This is obvious.'，其最主要的问题是：", options: ["它使用了被动语态", "它引用了过多数据", "它没有提供证据或解释，只是断言", "它偏离了段落主题"], answerIndex: 2, explanation: "学术论证要求以证据或推理支撑判断，This is obvious 只是重复作者的确信态度，没有增加任何可检验的信息。该句既没有被动语态，也没有数据，更谈不上偏离主题，问题在于论证内容为空。" },

  // ── w08 段落统一性 ──
  { id: "q-w08-1", kcId: "w08", difficulty: 2, stem: "段落统一性（unity）指的是：", options: ["段落中每个句子长度相同", "段落中必须使用相同的连接词", "段落中只能出现一个数据", "段落中所有句子都围绕同一个中心展开"], answerIndex: 3, explanation: "统一性要求段落有一个可辨认的中心，其他句子都服务于它，与句子长短、连接词是否相同无关，也不限制数据数量。判断统一性时应问：这句话是否推进了本段的中心判断。" },
  { id: "q-w08-2", kcId: "w08", difficulty: 3, stem: "一段讨论 'Online learning expands access to higher education' 的段落中，出现 'The university also renovated its library.' 这句最应：", options: ["删除或移到其他段落，因为它与段落中心无关", "保留，因为它也是学校的变化", "改成被动语态后保留", "加一个 however 后保留"], answerIndex: 0, explanation: "图书馆翻新与在线教育扩大受教育机会之间没有论证关系，保留会破坏段落统一性，应删除或移入讨论校园设施的段落。仅改变语态或添加连接词不能弥补内容上的偏离，反而会制造虚假的逻辑关系。" },
  { id: "q-w08-3", kcId: "w08", difficulty: 4, stem: "若某段主题句聚焦成本，但其中一句讨论教学质量，最合理的处理是：", options: ["把主题句改成质量与成本都重要", "将该句删除或另起一段，并在新段中给出自己的主题句", "保留该句，因为教学质量也重要", "把该句改为被动语态以弱化冲突"], answerIndex: 1, explanation: "保持段落统一性的做法是让材料与中心匹配，偏离的句子应删除或独立成段并配备相应主题句。把主题句改得包罗万象会让段落失去焦点，仅改语态也无法解决内容错位。" },

  // ── w09 衔接与过渡 ──
  { id: "q-w09-1", kcId: "w09", difficulty: 1, stem: "连接词 'however' 通常表达什么逻辑关系？", options: ["递进", "举例", "转折或对比", "因果"], answerIndex: 2, explanation: "however 用于引出与前文预期相反或不同的信息，属于转折/对比关系。递进常用 moreover、furthermore，举例用 for example，因果用 therefore、consequently，不能与 however 混用。" },
  { id: "q-w09-2", kcId: "w09", difficulty: 2, stem: "选择最合适的连接词：'The sample size was small; ___, the findings may not generalize to other settings.'", options: ["moreover", "therefore", "likewise", "for instance"], answerIndex: 1, explanation: "前句是原因（样本小），后句是由此推出的结果（难以推广），应使用因果连接词 therefore。moreover 表示递进，likewise 表示类似，for instance 表示举例，都与这里的推理方向不符。" },
  { id: "q-w09-3", kcId: "w09", difficulty: 3, stem: "下列哪一组句子衔接最自然？", options: ["Previous studies focused on adults. Children, by contrast, have received little attention.", "Children have received little attention. By contrast, previous studies focused on adults.", "Previous studies focused on adults, by contrast children have received little attention.", "By contrast, previous studies focused on adults. Children have received little attention."], answerIndex: 0, explanation: "第一组先给出已知信息（既有研究关注成人），再用 by contrast 引出新信息（儿童研究不足），符合已知到未知的信息推进顺序。选项 2 颠倒信息顺序，选项 3 用逗号连接两个独立句造成逗号粘连，选项 4 在段首使用 by contrast 缺乏对比对象。" },

  // ── w10 段落展开模式 ──
  { id: "q-w10-1", kcId: "w10", difficulty: 2, stem: "比较-对比段落的组织方式，下列说法正确的是：", options: ["只能先讲甲再讲乙", "可以先逐点比较，也可以先分块介绍再比较", "必须使用表格", "必须按时间顺序"], answerIndex: 1, explanation: "比较-对比段落常见两种组织：逐点比较（point-by-point）和分块比较（block），选择取决于比较维度的多少与读者需要，并非只能二选一，也不要求表格或时间顺序。" },
  { id: "q-w10-2", kcId: "w10", difficulty: 3, stem: "关于因果段落的展开，较合理的说法是：", options: ["必须先因后果，不能先果后因", "只需列出两个事实，不必说明机制", "因果段落必须使用第一人称", "无论先因后果还是先果后因，都要有清晰的因果链"], answerIndex: 3, explanation: "因果段落的顺序可以灵活安排，先果后因常用于制造问题意识，但无论哪种顺序都必须说明原因如何导致结果，不能只并置两个事实。人称选择与因果链是否成立无关。" },
  { id: "q-w10-3", kcId: "w10", difficulty: 4, stem: "主题为 'the causes of urban heat islands'，最合适的段落展开模式是：", options: ["按时间顺序叙述事件", "按空间位置描述布局", "按原因类别分点展开，如经济、环境与政策因素", "按作者姓氏字母顺序排列"], answerIndex: 2, explanation: "该主题要求解释成因，按原因类别（如地表材料、绿地减少、建筑密度）分点展开最贴合任务。时间顺序适合过程叙述，空间顺序适合场景描述，按姓氏排序与内容组织无关。" },

  // ── w11 论点与论据 ──
  { id: "q-w11-1", kcId: "w11", difficulty: 1, stem: "论点（claim）与论据（evidence）的关系是：", options: ["论据是作者的个人立场，论点是数据", "论据为论点提供支持，论点需要论据才能成立", "两者可以互相替代", "论点必须由论据直接引用原文构成"], answerIndex: 1, explanation: "论点是作者要读者接受的判断，论据是支持该判断的数据、事实或推理，二者角色不同、不能互换。论点也不必然以直接引用形式出现，转述、统计数据或实验结果都可以充当论据。" },
  { id: "q-w11-2", kcId: "w11", difficulty: 2, stem: "下列哪一句最接近可被数据检验的学术论点？", options: ["Students who sleep less than six hours perform worse on memory tasks.", "Sleeping is very important for everyone.", "I feel that students should sleep more.", "Sleep is a fascinating topic."], answerIndex: 0, explanation: "第一句给出可操作的自变量（睡眠时长）、因变量（记忆任务表现）与比较方向，能被数据支持或反驳。其余句子分别是价值判断、个人感受和话题陈述，缺乏可检验的变量关系。" },
  { id: "q-w11-3", kcId: "w11", difficulty: 3, stem: "当现有论据只能支持较弱结论时，较恰当的做法是：", options: ["保持强结论，因为论点应鲜明", "删掉所有论据，只保留结论", "增加更多形容词来增强语气", "缩小结论范围或使用模糊限制语，使主张与证据强度匹配"], answerIndex: 3, explanation: "论证的可信度取决于主张与证据的匹配，证据有限时应限定范围或使用 may suggest 等表达。强撑结论或堆砌形容词只会削弱可信度，删除论据则使论点完全失去支撑。" },

  // ── w12 逻辑谬误识别 ──
  { id: "q-w12-1", kcId: "w12", difficulty: 2, stem: "'Many people believe that this method works, so it must be effective.' 属于哪种逻辑谬误？", options: ["循环论证", "人身攻击", "诉诸大众（ad populum）", "虚假两难"], answerIndex: 2, explanation: "该论证以相信者众多作为方法有效的依据，而不是提供证据，属于诉诸大众。循环论证是把结论当前提，人身攻击针对提出者而非论点，虚假两难只给两个极端选项，三者都与本句结构不同。" },
  { id: "q-w12-2", kcId: "w12", difficulty: 3, stem: "'If we allow students to use laptops in class, they will soon demand phones, then games, and eventually no one will pay attention.' 的主要问题是：", options: ["滑坡谬误，把一连串未必发生的后果当作必然链条", "样本量不足", "循环论证", "诉诸权威"], answerIndex: 0, explanation: "该论证从一个允许推出逐步升级的灾难性后果，却未证明每一步的必然性，属于滑坡谬误。它没有涉及样本、循环前提或权威意见，问题在于因果链条被无限放大。" },
  { id: "q-w12-3", kcId: "w12", difficulty: 4, stem: "'Our survey of 12 volunteers shows that all users prefer the new design.' 最明显的逻辑问题是：", options: ["使用了被动语态", "没有引用文献", "结论过于谨慎", "以偏概全，样本过小且不足以支持 all users 的结论"], answerIndex: 3, explanation: "12 名志愿者无法代表全部用户，用 all users 作全称结论属于以偏概全。语态和引用格式与推理有效性无关，而结论显然不是过于谨慎，恰恰相反，它超出了样本能支持的范围。" },

  // ── w13 因果关系的表达 ──
  { id: "q-w13-1", kcId: "w13", difficulty: 1, stem: "'Correlation does not imply causation' 的意思是：", options: ["相关分析不能计算相关系数", "两个变量相关并不等于其中一个导致另一个", "因果关系一定伴随负相关", "只要相关就一定有因果"], answerIndex: 1, explanation: "相关可能来自共同原因、反向因果或巧合，因此不能仅凭相关推断因果。该说法并不否定相关系数的计算，也不涉及相关方向，更不主张相关必然带来因果。" },
  { id: "q-w13-2", kcId: "w13", difficulty: 2, stem: "观察到 'Ice cream sales and drowning rates rise together in summer.'，最合理的解释是：", options: ["吃冰淇淋必然导致溺水", "溺水导致冰淇淋销量上升", "可能存在共同原因（气温），不能直接断定冰淇淋导致溺水", "两者没有相关关系"], answerIndex: 2, explanation: "高温同时促使冰淇淋销售和游泳活动增加，属于共同原因造成的虚假因果。数据确实显示两者同向变化，因此不能说毫无关系，但也不能直接推出任一方向的因果。" },
  { id: "q-w13-3", kcId: "w13", difficulty: 3, stem: "'Event B happened after Event A, so A caused B.' 这一推理的问题在于：", options: ["把时间先后当作因果，属于后此谬误（post hoc）", "B 发生在 A 之后，所以因果成立", "它使用了太多样本", "它没有给出变量的定义"], answerIndex: 0, explanation: "先后发生只是因果的必要条件之一，还需排除共同原因、反向因果和巧合，单凭时间顺序下结论是后此谬误。该推理的问题不是样本多或定义缺失，而是把时间关系误当因果证据。" },

  // ── w14 让步与反驳 ──
  { id: "q-w14-1", kcId: "w14", difficulty: 2, stem: "在论证中先承认对立观点的合理之处，再加以回应，这种策略称为：", options: ["循环论证", "诉诸权威", "以偏概全", "让步与反驳（concession and rebuttal）"], answerIndex: 3, explanation: "让步表明作者理解不同立场，反驳则说明为何本立场仍成立，能增强论证的可信度。其余三项都是应避免的逻辑问题，不是论证策略，其中诉诸权威和以偏概全都属于证据使用不当。" },
  { id: "q-w14-2", kcId: "w14", difficulty: 3, stem: "下列哪一句最完整地体现了让步加反驳的结构？", options: ["Remote work is good because it saves time.", "While remote work reduces commuting time, it may weaken informal collaboration; nevertheless, structured virtual meetings can partly offset this loss.", "Some people dislike remote work, but they are wrong.", "Remote work has both advantages and disadvantages."], answerIndex: 1, explanation: "该句先用 while 承认协作方面的代价，再用 nevertheless 提出可缓解的反驳，结构完整。选项 1 只有单方面理由，选项 3 只是否定对方而未回应其理由，选项 4 泛泛而谈，均未形成让步加反驳。" },
  { id: "q-w14-3", kcId: "w14", difficulty: 4, stem: "论证中把对方观点歪曲成更极端版本再加以攻击，这种错误称为：", options: ["让步", "类比论证", "稻草人谬误（straw man）", "因果推理"], answerIndex: 2, explanation: "稻草人谬误攻击的是被夸大或扭曲后的观点，而非对方真实主张，因而看似获胜实则未回应。让步是承认对方合理处，类比与因果则是另外的论证方式，都不以歪曲对方为特征。" },

  // ── w15 论证的充分性与范围限定 ──
  { id: "q-w15-1", kcId: "w15", difficulty: 1, stem: "学术写作中使用 may、suggest、tend to 等模糊限制语的主要目的是：", options: ["使结论强度与证据强度相匹配，避免过度断言", "让文章显得不确定而不可信", "增加文章的字数", "替代所有数据和引用"], answerIndex: 0, explanation: "模糊限制语表达的是认识上的谨慎，说明结论是在现有证据下的合理推断，而非绝对真理。它不是故作含糊，也不能代替证据，恰恰相反，它帮助读者准确判断证据支持到什么程度。" },
  { id: "q-w15-2", kcId: "w15", difficulty: 2, stem: "研究只有 20 名参与者，下列结论表述最恰当的是：", options: ["The results prove that the two variables are causally linked.", "The results demonstrate a universal law.", "The results leave no doubt about the effect.", "The results suggest a possible association between the two variables."], answerIndex: 3, explanation: "小样本不足以支撑 prove、universal law 或 no doubt 这类强断言，suggest a possible association 与证据强度相符。其余选项都把有限数据升级为普遍规律或确定因果，属于过度概括。" },
  { id: "q-w15-3", kcId: "w15", difficulty: 3, stem: "下列哪一句最可能构成过度概括？", options: ["Many students in this sample preferred online courses.", "All students always prefer online courses to face-to-face classes.", "The findings may reflect the specific context of the study.", "Further research is needed to confirm the pattern."], answerIndex: 1, explanation: "all 与 always 构成全称断言，而研究通常只基于有限样本，容易过度概括。其余句子分别使用限定样本、可能性和进一步研究等谨慎表达，把结论控制在了数据可支持的范围内。" },

  // ── w16 正式语体与口语化表达 ──
  { id: "q-w16-1", kcId: "w16", difficulty: 2, stem: "下列表达中，最符合学术正式语体的是：", options: ["a lot of participants", "tons of participants", "a large number of participants", "loads of participants"], answerIndex: 2, explanation: "a large number of 是中性、正式的书面表达，适合描述样本规模。a lot of、tons of、loads of 带有口语或夸张色彩，通常不适合学术论文，尤其 tons of 和 loads of 更接近非正式口语。" },
  { id: "q-w16-2", kcId: "w16", difficulty: 3, stem: "学术论文中处理缩略形式（如 don't、isn't）的常规做法是：", options: ["展开为 do not、is not 等完整形式", "保留缩略形式以显得亲切", "全部改为大写", "用斜体标注缩略形式"], answerIndex: 0, explanation: "学术语体偏正式，通常避免缩略形式，将其展开为完整形式。保留缩略形式会显得口语化，大写或斜体并不能改变语体，反而可能造成强调或格式上的误解。" },
  { id: "q-w16-3", kcId: "w16", difficulty: 4, stem: "下列哪一句最符合学术语体？", options: ["This study looks into how peer feedback changes writing.", "This study investigates the effects of peer feedback on revision quality.", "This study digs into the peer feedback thing.", "This study checks out what peer feedback does."], answerIndex: 1, explanation: "investigates、effects 属于学术常用词汇，表述准确且正式。look into、dig into、check out 都是口语化短语动词，thing 也过于笼统，无法准确说明研究对象，因此不适合学术论文。" },

  // ── w17 学术动词与报告动词 ──
  { id: "q-w17-1", kcId: "w17", difficulty: 1, stem: "在 'Smith (2020) ___ that feedback improves revision.' 中，若想中性陈述作者观点而不夸大其证明力，最合适的是：", options: ["proves", "screams", "guesses", "argues"], answerIndex: 3, explanation: "argues 中性报告作者的论证立场，不暗示已被证明。proves 把主张升级为定论，screams 带有情绪色彩，guesses 则带有贬低意味，三者都不适合客观的学术引用。" },
  { id: "q-w17-2", kcId: "w17", difficulty: 2, stem: "'suggest' 与 'demonstrate' 在报告研究结果时的强度差别是：", options: ["两者完全等义", "suggest 更强，demonstrate 更弱", "suggest 语气较弱，demonstrate 表示更强的证据支持", "demonstrate 只能用于否定结果"], answerIndex: 2, explanation: "suggest 表示结果提示某种可能，留有余地；demonstrate 表示证据较充分地显示，语气更强。作者应根据证据强度选择，不能随意互换，否则会误导读者对结论可靠性的判断。" },
  { id: "q-w17-3", kcId: "w17", difficulty: 3, stem: "在文献综述中，若要表达某项研究「支持」另一项研究的发现，较恰当的动词是：", options: ["contradict", "corroborate", "ignore", "postpone"], answerIndex: 1, explanation: "corroborate 意为用独立证据证实或支持既有发现，正合语境。contradict 表示相反，ignore 与 postpone 分别表示忽视和推迟，都与「支持」的语义不符，不能用于描述研究之间的一致性。" },

  // ── w18 常见搭配与介词 ──
  { id: "q-w18-1", kcId: "w18", difficulty: 2, stem: "下列搭配正确的是：", options: ["research on second language acquisition", "research of second language acquisition", "research about second language acquisition", "research to second language acquisition"], answerIndex: 0, explanation: "表示某领域的研究通常用 research on，英式学术写作中也常用 research into。research of 多表示「对……的研究」但不地道，about 偏口语，to 不构成该名词的常见搭配。" },
  { id: "q-w18-2", kcId: "w18", difficulty: 3, stem: "下列介词搭配正确的是：", options: ["The results are consistent to previous findings.", "The results are consistent of previous findings.", "The results are consistent for previous findings.", "The results are consistent with previous findings."], answerIndex: 3, explanation: "consistent 的固定搭配是 be consistent with，表示与……一致。to、of、for 都不符合该形容词的搭配习惯，这类介词错误在非母语写作中很常见，需作为固定搭配整体记忆。" },
  { id: "q-w18-3", kcId: "w18", difficulty: 4, stem: "下列表达中，学术搭配最自然的是：", options: ["The study provides insight on the underlying mechanism.", "The study provides insight of the underlying mechanism.", "The study provides insight into the underlying mechanism.", "The study provides insight about the underlying mechanism."], answerIndex: 2, explanation: "provide insight into 是学术写作中的固定搭配，表示对某机制的深入理解。on、of、about 虽偶有出现，但不如 into 规范，尤其与 mechanism 搭配时 into 更符合学术语感。" },

  // ── w19 模糊限制语 ──
  { id: "q-w19-1", kcId: "w19", difficulty: 1, stem: "下列哪一句对研究结论的表述最谨慎？", options: ["The findings prove that one factor causes the other.", "The findings may indicate a link between the two factors.", "The findings settle the question once and for all.", "The findings are unquestionably correct."], answerIndex: 1, explanation: "may indicate 表明结论是初步的、有待验证的，符合学术谨慎。prove、settle once and for all、unquestionably 都是绝对化表达，超出单次研究能提供的证据范围。" },
  { id: "q-w19-2", kcId: "w19", difficulty: 2, stem: "'It could be argued that...' 这一表达的主要功能是：", options: ["引入一种可讨论的观点，同时与作者本人保持距离", "表示作者完全反对该观点", "表示该观点已被证明", "用于提出实验步骤"], answerIndex: 0, explanation: "该句式把观点置于可争辩的位置，作者既提出它又不完全背书，常用于讨论不同解释。它不表示反对或已证明，也不用于描述实验操作，而是典型的学术模糊限制手段。" },
  { id: "q-w19-3", kcId: "w19", difficulty: 3, stem: "一段文字中几乎每句都使用 might、possibly、perhaps、it seems，最可能造成的问题是：", options: ["文章自动变成被动语态", "引用格式会出错", "句子时态必须全部改为过去时", "论证显得缺乏信心，读者难以判断作者的实际主张"], answerIndex: 3, explanation: "模糊限制语应服务于证据强度，过度使用会让主张变得模糊，读者无法确定作者到底支持什么。它与语态、引用格式和时态选择没有必然联系，问题在于认识立场的表达失去了层次。" },

  // ── w20 词汇重复与同义替换 ──
  { id: "q-w20-1", kcId: "w20", difficulty: 2, stem: "关于学术写作中关键词的重复，下列说法正确的是：", options: ["任何重复都必须替换成同义词", "重复关键词一定会被判为抄袭", "核心术语应保持一致的措辞，避免用不同词指同一概念", "同义替换越多越显得专业"], answerIndex: 2, explanation: "术语一致性有助于读者准确追踪概念，随意换词可能暗示概念不同，反而造成歧义。重复关键词与抄袭无关，机械同义替换也不是专业性的标志，关键是概念指称是否清晰稳定。" },
  { id: "q-w20-2", kcId: "w20", difficulty: 3, stem: "下列哪一组替换在学术语境中最恰当？", options: ["increase → go up", "increase → rise", "increase → skyrocket", "increase → get bigger"], answerIndex: 1, explanation: "rise 与 increase 同属中性书面语，可安全替换。go up 与 get bigger 偏口语，skyrocket 带有夸张色彩，用于客观陈述数据变化会显得不严谨，因此不如 rise 合适。" },
  { id: "q-w20-3", kcId: "w20", difficulty: 4, stem: "在同一篇文章中把 'participants' 依次替换为 'subjects'、'respondents'、'informants'，可能带来的问题是：", options: ["读者可能误以为指代不同群体，破坏概念的一致性", "文章会立刻变得不合法", "句子会变成被动语态", "参考文献会自动重复"], answerIndex: 0, explanation: "这些词在研究方法中含义并不完全相同，随意换用会让读者怀疑样本是否一致。术语选择应服务于概念准确性，而不是单纯避免重复；语态、法律问题和文献重复都与该替换无关。" },

  // ── w21 引用功能与引用类型 ──
  { id: "q-w21-1", kcId: "w21", difficulty: 1, stem: "学术写作中引用文献的主要功能不包括：", options: ["标示观点或数据的来源", "区分他人观点与作者自己的贡献", "为论点提供证据支持", "用引用数量代替论证本身"], answerIndex: 3, explanation: "引用用于标明来源、支撑论点并划清与他人成果的界限，但堆砌引用不能替代论证。把引用数量当作论证力度是常见误区，引用的价值在于其与论点的相关性，而非数量。" },
  { id: "q-w21-2", kcId: "w21", difficulty: 2, stem: "'Smith (2020) argues that...' 与 '(Smith, 2020)' 的主要区别是：", options: ["前者是抄袭，后者不是", "前者把作者作为句子成分（叙述性引用），后者只标注来源（括号引用）", "后者不需要出现在参考文献中", "前者只能用于直接引用"], answerIndex: 1, explanation: "叙述性引用让原作者成为句子主语，突出其观点；括号引用把注意力留给作者自己的论述。两者都必须列入参考文献，也都可用于转述，并不存在前者合法后者抄袭的区别。" },
  { id: "q-w21-3", kcId: "w21", difficulty: 3, stem: "下列哪种情况最适合使用直接引用而非转述？", options: ["原文很长且包含大量细节时", "只需要概括原文大意时", "需要保留原文精确措辞或权威定义时", "原文的观点与自己完全一致时"], answerIndex: 2, explanation: "直接引用适合保留不可替代的措辞、定义或关键表述。长段落应概括，仅需大意时转述更简洁，观点一致也不能成为省略转述的理由，否则容易造成不必要的逐字复制。" },

  // ── w22 直接引用与改写 ──
  { id: "q-w22-1", kcId: "w22", difficulty: 2, stem: "关于改写（paraphrase），下列说法正确的是：", options: ["用自己的语言重述原意，并标注来源", "只替换几个同义词，不必标注来源", "改变原意以支持自己的论点", "必须逐字保留原句结构"], answerIndex: 0, explanation: "合格改写同时改变措辞与句法、保留原意，并注明出处。仅换同义词属于拼凑式改写，改变原意是歪曲，保留原结构则接近抄袭，三者都不符合规范转述的要求。" },
  { id: "q-w22-2", kcId: "w22", difficulty: 3, stem: "仅替换原文中的若干词语而保留句子结构和逻辑，这种做法通常被称为：", options: ["规范转述", "文献综述", "直接引用", "拼凑式抄袭（patchwriting）"], answerIndex: 3, explanation: "patchwriting 是在原句骨架上替换词汇，仍高度依赖原文表达，属于学术写作中应避免的做法。规范转述需要重构句法与措辞，文献综述是文体类型，直接引用则需引号与出处。" },
  { id: "q-w22-3", kcId: "w22", difficulty: 4, stem: "原文为 'The rapid expansion of online platforms has reduced the cost of publishing.'，下列改写最合格的是：", options: ["The rapid expansion of online platforms has decreased the cost of publishing.", "Online platforms expanded rapidly and reduced publishing cost.", "Publishing has become cheaper largely because online platforms expanded quickly.", "The fast growth of online platforms has lowered how much publishing costs."], answerIndex: 2, explanation: "选项 3 重构了主谓与从句结构，把原因和结果重新组织并保留原意。选项 1 只换了一个词，选项 2 仍沿用原句的并列结构，选项 4 的 lowered how much...costs 既口语化又与原句结构近似，都不如选项 3 彻底。" },

  // ── w23 文献综述的组织 ──
  { id: "q-w23-1", kcId: "w23", difficulty: 1, stem: "文献综述较理想的组织方式是：", options: ["按发表时间逐篇介绍每篇文献", "按主题或学术争论分组，综合多篇文献的发现", "按作者姓氏字母顺序逐篇介绍", "只列出支持自己观点的文献"], answerIndex: 1, explanation: "综述的价值在于围绕问题整合证据、呈现争论与研究脉络。逐篇罗列只是清单，按字母排序缺乏逻辑，只选支持性文献则带有选择性偏差，无法呈现领域的真实状况。" },
  { id: "q-w23-2", kcId: "w23", difficulty: 2, stem: "下列哪一句体现了综合（synthesis）而非简单罗列？", options: ["Taken together, these studies suggest that feedback timing matters more than feedback quantity.", "Smith (2019) studied feedback. Jones (2020) studied feedback. Lee (2021) studied feedback.", "Smith (2019) found an effect. Jones (2020) found an effect.", "Many studies have examined feedback."], answerIndex: 0, explanation: "Taken together 表明作者在比较多项研究后提炼出共同结论，属于综合。其余句子只是并列罗列或空泛概括，没有形成跨研究的判断，读者无法从中看出研究之间的关系。" },
  { id: "q-w23-3", kcId: "w23", difficulty: 3, stem: "文献综述结尾最常见的功能是：", options: ["重复正文开头的研究背景", "列出所有参考文献的出版信息", "给出最终实验数据", "指出已有研究的空白，并自然引出本研究"], answerIndex: 3, explanation: "综述收束时通常从「已知」转向「未知」，为研究问题提供合法性。重复背景不会推进论证，出版信息属于参考文献列表，实验数据应在结果部分，三者都不能承担引出本研究的功能。" },

  // ── w24 引用格式与参考文献 ──
  { id: "q-w24-1", kcId: "w24", difficulty: 2, stem: "某期刊要求正文引用写成 (Smith, 2020)，且文末文献表按作者姓氏字母排序。这最可能采用哪种引用体系？", options: ["作者-年份制（如 APA）", "作者-页码制（如 MLA）", "数字编号制（如 IEEE）", "脚注制"], answerIndex: 0, explanation: "括号内给出作者姓氏与年份、文献表按姓氏字母排序，是作者-年份制的典型特征。MLA 通常在正文给作者与页码，IEEE 使用方括号数字编号，脚注制则把信息放在页下，均与题干描述不符。" },
  { id: "q-w24-2", kcId: "w24", difficulty: 3, stem: "在 APA 格式的参考文献列表中，条目通常如何排序？", options: ["按文献发表年份从新到旧", "按在正文中出现的顺序", "按第一作者姓氏的字母顺序", "按文献标题长度"], answerIndex: 2, explanation: "APA 参考文献表按作者姓氏字母顺序排列，同作者再按年份排序。按出现顺序编号是 IEEE 等数字制体系的做法，按年份或标题长度都不是 APA 规则。" },
  { id: "q-w24-3", kcId: "w24", difficulty: 4, stem: "同一作者在同一年有多篇文献被引用时，APA 格式通常如何区分？", options: ["在作者名后加数字，如 Smith1、Smith2", "在年份后加小写字母，如 2020a、2020b", "只保留最早发表的一篇", "用不同颜色的标注"], answerIndex: 1, explanation: "年份后加 a、b 既区分条目，又与参考文献列表中的对应条目一致。作者名后加数字不符合 APA 规范，删除文献会丢失信息，颜色标注也不是学术格式。" },

  // ── w25 学术诚信与抄袭规避 ──
  { id: "q-w25-1", kcId: "w25", difficulty: 1, stem: "某作者把已发表论文中的方法段落原样搬入新论文，既未加引号也未说明出处。这属于：", options: ["规范引用", "自我抄袭", "文献综述", "同行评审"], answerIndex: 1, explanation: "自我抄袭的关键是未披露地重复使用自己已发表的内容，可能涉及版权与原创性问题。规范引用需要标注出处，文献综述与同行评审是另外的学术活动，与这种重复使用不是一回事。" },
  { id: "q-w25-2", kcId: "w25", difficulty: 2, stem: "引用自己以前论文中的观点时，正确做法是：", options: ["因为是自己的观点，可以不标注", "改几个词就可以不标注", "只在致谢中提一句即可", "像引用他人成果一样标注出处"], answerIndex: 3, explanation: "学术诚信要求区分已发表内容与新贡献，引用自己的旧作同样需要标注，否则读者无法判断哪些是本文的新工作。改写措辞或仅在致谢中提及都不能替代规范引用。" },
  { id: "q-w25-3", kcId: "w25", difficulty: 3, stem: "下列做法中，不属于抄袭的是：", options: ["转述他人观点并在文中标注来源", "直接复制他人段落但不加引号", "改写他人句子但不标注来源", "把多篇文献的原文拼接成一段"], answerIndex: 0, explanation: "转述并标注来源是合法的学术使用。未加引号的复制、改写不标注以及拼接原文都构成不同程度的抄袭，区别只在于形式，共同点是未如实标明思想与表述的来源。" },

  // ── w26 摘要的功能与结构 ──
  { id: "q-w26-1", kcId: "w26", difficulty: 2, stem: "下列哪一组内容最完整地覆盖了学术摘要应报告的核心信息？", options: ["研究目的、方法、主要结果、结论", "研究背景、致谢、作者简介", "文献列表、附录、图表", "研究目的、参考文献、投稿信"], answerIndex: 0, explanation: "摘要要让读者快速判断论文是否相关，需覆盖目的、方法、结果和结论四个核心信息。致谢、作者简介、文献列表、附录与投稿信都不属于摘要内容，图表通常也不放入摘要。" },
  { id: "q-w26-2", kcId: "w26", difficulty: 3, stem: "下列哪项最不适合出现在摘要中？", options: ["研究目的的一句话概括", "样本量与主要方法", "正文未报告的新实验结果", "最重要的定量结果"], answerIndex: 2, explanation: "摘要应是正文的忠实浓缩，不能引入正文没有的新数据或新结论。目的、方法和关键结果都是摘要的常规内容，其中定量结果还能帮助读者迅速判断研究的证据强度。" },
  { id: "q-w26-3", kcId: "w26", difficulty: 4, stem: "结构式摘要（structured abstract）的主要特点是：", options: ["全文只有一句话", "用小标题把背景、方法、结果、结论等分节呈现", "不使用任何数字", "必须包含全部参考文献"], answerIndex: 1, explanation: "结构式摘要通过 Background、Methods、Results、Conclusions 等小标题提高可读性与信息定位效率，常见于医学期刊。它并不限制篇幅为一句话，也不排斥数据或要求列参考文献。" },

  // ── w27 摘要的时态与信息密度 ──
  { id: "q-w27-1", kcId: "w27", difficulty: 1, stem: "摘要中陈述研究背景或普遍事实时，通常使用：", options: ["一般将来时", "过去完成时", "现在进行时", "一般现在时"], answerIndex: 3, explanation: "普遍成立的事实与当前研究背景用一般现在时，如 Many students struggle with academic writing。将来时用于计划，过去完成时用于更早的过去，进行时强调正在发生，都不适合陈述背景事实。" },
  { id: "q-w27-2", kcId: "w27", difficulty: 2, stem: "摘要中描述本研究已完成的数据收集过程，通常使用：", options: ["一般现在时", "一般过去时", "一般将来时", "现在完成进行时"], answerIndex: 1, explanation: "本研究已完成的具体操作属于过去事件，用一般过去时，如 Data were collected from two schools。一般现在时用于普遍事实，将来时与完成进行时都不符合该语境的时间指向。" },
  { id: "q-w27-3", kcId: "w27", difficulty: 3, stem: "摘要写作强调信息密度，这意味着：", options: ["每句话都应承载实质信息，避免空泛过渡", "句子越长越好", "必须使用尽可能多的专业术语", "省略所有研究方法"], answerIndex: 0, explanation: "摘要篇幅有限，应删去无关铺垫与重复表述，让每句都提供目的、方法、结果或结论信息。长度和术语数量不等于信息量，省略方法则会使摘要不完整，读者无法判断证据来源。" },

  // ── w28 引言 CARS 模型 ──
  { id: "q-w28-1", kcId: "w28", difficulty: 2, stem: "某引言先说明研究领域的重要性，再指出已有研究的不足，最后说明本文如何填补这些不足。这最符合哪种引言模型的语步顺序？", options: ["给出结论、回顾方法、列出局限", "介绍样本、报告结果、讨论意义", "确立研究领域、指出研究空白、占据研究空间", "引用文献、致谢、列出参考文献"], answerIndex: 2, explanation: "这正是 Swales 的 CARS 模型：先建立研究领域，再指出空白，最后说明本研究如何占据该空间。其余选项分别混入了结论、方法、结果或文末部分的功能，不符合引言的推进顺序。" },
  { id: "q-w28-2", kcId: "w28", difficulty: 3, stem: "'Although many studies have examined X, little is known about Y.' 在引言中主要承担的功能是：", options: ["报告本研究的主要结果", "描述实验仪器的型号", "总结全文的局限性", "指出研究空白，为本文问题提供依据"], answerIndex: 3, explanation: "该句先承认已有研究，再用 little is known 标示空白，是典型的空白语步。它不报告结果、不描述仪器，也不是结论部分的局限说明，而是为后续研究问题提供合法性。" },
  { id: "q-w28-3", kcId: "w28", difficulty: 4, stem: "引言开头段落最应避免的是：", options: ["说明研究主题的重要性", "直接给出本研究的最终结论和具体数据", "概括当前领域的总体状况", "引出已有研究的不足"], answerIndex: 1, explanation: "引言应从背景与问题逐步推进，过早抛出结论和数据会打乱论证节奏，也让读者缺少理解结论所需的语境。重要性、领域概况与不足都是引言的正常内容，不能与结论前置混为一谈。" },

  // ── w29 研究空白与问题陈述 ──
  { id: "q-w29-1", kcId: "w29", difficulty: 1, stem: "下列表达中，最常用于标示研究空白的是：", options: ["however, little is known about...", "for example, ...", "in conclusion, ...", "first, ... second, ..."], answerIndex: 0, explanation: "however 与 little is known 组合是标示空白的典型信号，既承认已有研究又指出未知。for example 用于举例，in conclusion 用于收束，first/second 用于列举，都不专门承担空白语步。" },
  { id: "q-w29-2", kcId: "w29", difficulty: 2, stem: "下列哪一句研究空白的表述最具体、最可用？", options: ["More research is needed.", "This topic is understudied.", "Few studies have examined how feedback timing affects revision quality among EFL undergraduates.", "Researchers should pay attention to this area."], answerIndex: 2, explanation: "具体空白需说明对象、变量与人群，才能自然导出研究问题。其余句子只是泛泛呼吁，读者无法判断究竟缺少哪方面的证据，也无法据此设计研究。" },
  { id: "q-w29-3", kcId: "w29", difficulty: 3, stem: "从研究空白过渡到研究问题时，最关键的是：", options: ["研究问题越多越好", "研究问题必须直接对应空白所指出的未解之处", "研究问题必须使用疑问句", "空白部分应尽量简短"], answerIndex: 1, explanation: "空白的价值在于为问题提供逻辑依据，二者应一一对应，否则论证出现断裂。问题数量、句式和篇幅都不是关键，过多问题反而会分散焦点，使读者难以看出哪个问题对应哪处空白。" },

  // ── w30 研究目的与贡献陈述 ──
  { id: "q-w30-1", kcId: "w30", difficulty: 2, stem: "下列哪一句最像规范的研究目的陈述？", options: ["This study is about writing.", "Writing is an important skill.", "We hope this paper will be interesting.", "This study aims to examine whether peer feedback improves revision quality."], answerIndex: 3, explanation: "目的陈述应说明研究要检验什么关系或回答什么问题，动词与对象明确。其余句子分别过于笼统、只是背景判断或表达主观期望，都无法指导研究设计，也无法让读者预期研究贡献。" },
  { id: "q-w30-2", kcId: "w30", difficulty: 3, stem: "研究目的陈述与贡献陈述的区别是：", options: ["目的说明要做什么，贡献说明填补了什么空白或带来什么新知", "两者完全相同", "目的必须放在结论部分", "贡献只能由审稿人撰写"], answerIndex: 0, explanation: "目的回答「本研究要做什么」，贡献回答「做完之后对领域意味着什么」，二者常相邻出现但功能不同。目的通常在引言，贡献可由作者在引言或结论中说明，并非审稿人的专属工作。" },
  { id: "q-w30-3", kcId: "w30", difficulty: 4, stem: "下列哪一句最清晰地界定了研究范围？", options: ["This study explores education.", "This study examines everything related to feedback.", "This study focuses on the short-term effects of peer feedback on revision quality in two Chinese universities.", "This study will change how people think about writing."], answerIndex: 2, explanation: "明确的对象、变量、时间范围与场景让读者知道研究边界与适用条件。其余句子要么范围过大，要么只是宣传性断言，无法指导研究设计，也无法帮助读者判断结论可推广到哪里。" },

  // ── w31 方法部分的语步与语态 ──
  { id: "q-w31-1", kcId: "w31", difficulty: 1, stem: "方法部分较多使用被动语态，主要原因是：", options: ["被动语态比主动语态更高级", "把信息焦点放在操作、材料或程序上，而非执行者", "被动语态可以省略所有主语", "学术写作禁止使用主动语态"], answerIndex: 1, explanation: "方法部分关注「怎么做」，执行者通常是作者本人，不必反复出现，因此常用被动。被动并非更高级，也不能在所有情况下省略主语，学术写作更不禁止主动语态。" },
  { id: "q-w31-2", kcId: "w31", difficulty: 2, stem: "方法部分较典型的语步顺序是：", options: ["研究结论、研究意义、未来方向", "文献综述、研究空白、研究问题", "致谢、参考文献、附录", "研究对象与材料、工具或程序、数据分析方法"], answerIndex: 3, explanation: "方法部分先交代样本与材料，再说明操作程序，最后交代数据分析方式，便于读者复现。结论与未来方向属于讨论，综述与空白属于引言，致谢和附录不是方法语步。" },
  { id: "q-w31-3", kcId: "w31", difficulty: 3, stem: "关于方法部分被动语态的使用，较合理的观点是：", options: ["应根据信息焦点灵活选择，主动与被动交替使用", "被动句越多越显得客观", "必须全部使用被动句", "被动句会降低研究的可信度"], answerIndex: 0, explanation: "语态选择取决于句子想突出什么，方法部分被动较多，但交代作者决策或强调执行者时主动更清楚。机械追求全被动会使行文单调，语态本身也不决定可信度。" },

  // ── w32 研究对象与材料描述 ──
  { id: "q-w32-1", kcId: "w32", difficulty: 2, stem: "描述研究参与者时，通常最需要报告的是：", options: ["参与者的姓名与联系方式", "参与者的全部个人信息", "人数、来源、关键特征与招募方式", "研究者对参与者的主观印象"], answerIndex: 2, explanation: "样本量、来源、年龄或语言水平等关键特征以及招募方式，决定研究能否被复现和推广。姓名与联系方式涉及隐私且无分析价值，主观印象不属于方法信息，全部个人信息也不应披露。" },
  { id: "q-w32-2", kcId: "w32", difficulty: 3, stem: "'A total of 60 participants were recruited from two secondary schools.' 中 'A total of' 的主要作用是：", options: ["表示参与者来自两个国家", "明确样本总量，避免读者对人数产生歧义", "说明研究使用了随机抽样", "强调研究结论具有普遍性"], answerIndex: 1, explanation: "A total of 直接给出最终样本量，是方法部分的常规写法。它不说明地域范围、抽样方式，也不能据此推断结论的普遍性，读者还需结合招募方式和样本特征判断外部效度。" },
  { id: "q-w32-3", kcId: "w32", difficulty: 4, stem: "材料描述过于简略最可能导致的后果是：", options: ["论文的参考文献数量不足", "统计分析会自动失效", "摘要会变得过长", "其他研究者无法复现研究，也难以判断结果的外部效度"], answerIndex: 3, explanation: "材料与程序的细节是复现的基础，缺失会让读者无法判断操作是否一致、结果能推广到何种情境。它与参考文献数量、统计方法有效性和摘要长度没有直接关系。" },

  // ── w33 数据呈现与图表描述 ──
  { id: "q-w33-1", kcId: "w33", difficulty: 1, stem: "描述图表中数据持续上升，较合适的表达是：", options: ["increased steadily", "went up a lot", "jumped like crazy", "got bigger and bigger"], answerIndex: 0, explanation: "increased steadily 准确且正式地表达持续上升。went up a lot 偏口语，jumped like crazy 夸张，got bigger and bigger 不适合描述数据趋势，三者都不符合学术图表描述所需的客观语气。" },
  { id: "q-w33-2", kcId: "w33", difficulty: 2, stem: "正文描述图表时，较推荐的做法是：", options: ["把图表中的每个数值都写进正文", "只写 'See Figure 1.' 不作任何说明", "在正文中重复图表的完整标题", "指出图表的关键发现或趋势，而不是逐项复述所有数字"], answerIndex: 3, explanation: "正文应帮助读者理解图表的意义，突出关键趋势并与论点关联。逐项复述浪费篇幅，完全不说明会让图表失去论证作用，重复标题也不提供解释，三者都没有完成「解释图表」的任务。" },
  { id: "q-w33-3", kcId: "w33", difficulty: 3, stem: "'Figure 2 shows that...' 与 'As can be seen from Figure 2, it is clear that...' 相比，前者更符合学术写作，因为：", options: ["使用了更多被动语态", "更简洁直接，避免空泛的元话语", "包含了更多数据", "语气更强烈"], answerIndex: 1, explanation: "Figure 2 shows that 直接引出图表信息，信息密度高。As can be seen from... it is clear that 属于可删除的铺垫，增加字数却不增加内容，是学术写作中应精简的元话语。" },

  // ── w34 结果陈述与统计显著性 ──
  { id: "q-w34-1", kcId: "w34", difficulty: 2, stem: "当 p<0.05 时，较规范的表述是：", options: ["The hypothesis was proved correct.", "The effect is important for all populations.", "The difference was statistically significant.", "The result is significant for society."], answerIndex: 2, explanation: "显著性检验只说明观察到的差异在统计上不太可能由抽样误差造成，不能证明假设为真，也不能推出实际重要性或普遍适用。因此应使用 statistically significant 的限定表述。" },
  { id: "q-w34-2", kcId: "w34", difficulty: 3, stem: "在学术语境中，significant 一词通常首先表示：", options: ["统计上显著", "非常重要", "数量很大", "意义深远"], answerIndex: 0, explanation: "在结果部分，significant 是统计术语，指差异或关系不太可能由偶然造成。若想表达重要性，应使用 important、substantial 等词，避免与统计含义混淆，否则读者会误判作者的意思。" },
  { id: "q-w34-3", kcId: "w34", difficulty: 4, stem: "若检验未发现显著差异，较准确的表述是：", options: ["The treatment had no effect whatsoever.", "No significant difference was found between the two groups.", "The two groups are exactly the same.", "The experiment failed and should be discarded."], answerIndex: 1, explanation: "未拒绝原假设只说明现有数据不足以支持差异存在，不等于证明无效果或两组完全相同，因此应限定为 no significant difference。绝对化结论或否定整个研究都超出了统计结果能支持的范围。" },

  // ── w35 结果与方法的一致性 ──
  { id: "q-w35-1", kcId: "w35", difficulty: 1, stem: "结果部分的内容应主要限于：", options: ["解释结果的深层原因", "提出政策建议", "讨论研究的局限", "报告方法中预先设定的分析所得到的结果"], answerIndex: 3, explanation: "结果部分负责客观呈现分析结果，解释原因属于讨论，政策建议属于结论或启示，局限通常在讨论中说明。把解释混入结果会模糊两者的界限，削弱论证结构的清晰度。" },
  { id: "q-w35-2", kcId: "w35", difficulty: 2, stem: "在结果部分加入大段因果解释，最主要的问题是：", options: ["会增加图表的数量", "混淆了结果呈现与结果解释，削弱论证结构的清晰度", "会违反参考文献格式", "会改变样本量"], answerIndex: 1, explanation: "结果与讨论分工不同，前者呈现发现，后者解释与比较。在结果中插入解释会让读者难以分辨哪些是数据、哪些是推断，也与图表数量、引用格式和样本量无关。" },
  { id: "q-w35-3", kcId: "w35", difficulty: 3, stem: "方法部分声明使用 t 检验，结果部分却只报告回归系数，这属于：", options: ["完全正常，统计方法可以随意更换", "只是格式问题，不影响可信度", "结果与方法不一致，需补充检验结果或修改方法说明", "说明结果一定不显著"], answerIndex: 2, explanation: "方法应预先说明分析方案，结果需与之对应，否则读者无法判断分析是否按计划执行，也可能引发选择性报告的质疑。这不是单纯格式问题，更不能据此推断显著性。" },

  // ── w36 讨论部分的结构 ──
  { id: "q-w36-1", kcId: "w36", difficulty: 2, stem: "讨论部分较典型的内容顺序是：", options: ["概括主要发现、解释其含义、与文献比较、指出意义与局限", "先列参考文献，再报告结果", "先给政策建议，再描述实验步骤", "只重复结果部分的全部数字"], answerIndex: 0, explanation: "讨论从发现出发，逐步回答「意味着什么」「与已有研究是否一致」「有什么价值与限制」。参考文献与实验步骤不属于讨论，单纯重复数字也没有推进解释，反而浪费篇幅。" },
  { id: "q-w36-2", kcId: "w36", difficulty: 3, stem: "讨论开头较合适的写法是：", options: ["再次列出所有统计表格", "直接介绍新的实验方法", "概括主要发现及其含义，而不是逐项重复结果数字", "只写 'The results were significant.'"], answerIndex: 2, explanation: "讨论开头应把读者从具体数字带到解释层面，点明最重要的发现意味着什么。重复表格浪费篇幅，新方法不属于讨论，单句断言则缺乏信息，无法支撑后续的解释与比较。" },
  { id: "q-w36-3", kcId: "w36", difficulty: 4, stem: "在讨论部分首次报告一项新的实验结果，是否合适？", options: ["合适，讨论可以随意补充数据", "不合适，新结果应在结果部分报告，讨论只作解释", "合适，只要数据支持作者观点", "不合适，因为讨论不能提及任何数据"], answerIndex: 1, explanation: "结果与讨论的分工要求所有发现先在结果部分呈现，讨论再解释其意义。在讨论中首次抛出数据会让读者无法判断分析是否预设，也破坏结构，但讨论可以引用已经报告过的数据。" },

  // ── w37 结果解释与文献对比 ──
  { id: "q-w37-1", kcId: "w37", difficulty: 1, stem: "将本研究结果与既有文献比较时，较常用的表达是：", options: ["next to", "instead of", "as long as", "consistent with"], answerIndex: 3, explanation: "consistent with 表示与……一致，in contrast to 表示与……相反，都是文献比较的常用搭配。next to、instead of、as long as 都不表达研究结果之间的一致性关系，不能用于此类比较。" },
  { id: "q-w37-2", kcId: "w37", difficulty: 2, stem: "当本研究结果与已有研究不一致时，较合理的讨论方式是：", options: ["分析样本、方法或情境差异，解释差异的可能来源", "直接断言已有研究错误", "删除不一致的结果", "忽略差异，只强调一致之处"], answerIndex: 0, explanation: "差异本身可能揭示边界条件或方法效应，应结合样本、测量和情境分析原因。断言他人错误缺乏依据，删除或回避数据则违反学术诚信，也会让读者失去理解差异的机会。" },
  { id: "q-w37-3", kcId: "w37", difficulty: 3, stem: "'Our findings are consistent with Smith (2020), who reported a similar effect in younger learners.' 这句话的主要功能是：", options: ["证明本研究方法存在缺陷", "否定 Smith 的研究", "用既有文献支持本研究结果，并说明其适用范围", "提出一个全新的研究问题"], answerIndex: 2, explanation: "该句通过一致结果增强本研究发现的可信度，同时用 younger learners 提示适用人群。它不涉及方法缺陷，也没有否定 Smith，更不是提出新问题，而是典型的文献对话。" },

  // ── w38 局限性与未来研究 ──
  { id: "q-w38-1", kcId: "w38", difficulty: 2, stem: "撰写研究局限时，较恰当的做法是：", options: ["只写 'This study has limitations.'", "说明局限对结论解释或推广的具体影响", "把局限写得越轻越好", "把局限全部归因于他人"], answerIndex: 1, explanation: "局限的价值在于帮助读者判断结论的边界，因此要具体说明影响。笼统一句没有信息量，刻意淡化或推卸责任则损害可信度，也会让读者怀疑作者对研究设计的理解。" },
  { id: "q-w38-2", kcId: "w38", difficulty: 3, stem: "下列哪一句局限陈述最具体、最有用？", options: ["The study has some limitations.", "There are limitations but they do not matter.", "All studies have limitations.", "The small sample limits the generalizability of the findings to other institutional contexts."], answerIndex: 3, explanation: "该句指出具体局限（样本小）及其后果（推广受限），读者能据此判断结论适用范围。其余句子只是套话或否认影响，没有提供有效信息，也无法帮助读者理解研究的边界。" },
  { id: "q-w38-3", kcId: "w38", difficulty: 4, stem: "未来研究建议与局限之间的关系，较理想的是：", options: ["未来研究与本文内容完全无关", "未来研究只需重复本文的方法", "未来研究直接针对局限或未解决的问题提出可操作的方案", "未来研究应回避本文的局限"], answerIndex: 2, explanation: "局限指出当前证据的缺口，未来研究据此设计更合适的样本、方法或变量，形成研究议程的连续性。无关建议缺乏针对性，简单重复无法弥补局限，回避局限则失去改进方向。" },

  // ── w39 结论与建议的写法 ──
  { id: "q-w39-1", kcId: "w39", difficulty: 1, stem: "结论部分较应避免的是：", options: ["引入正文未报告的新数据或新论点", "总结主要发现", "说明研究的理论与实践意义", "提出基于结果的建议"], answerIndex: 0, explanation: "结论应收束全文，重申已有发现与意义。突然出现的新数据或新论点会让读者无法追溯其依据，也破坏全文一致性；总结发现、说明意义和提出建议都是结论的正常内容。" },
  { id: "q-w39-2", kcId: "w39", difficulty: 2, stem: "提出实践建议时，较合理的原则是：", options: ["建议越宏大越好", "建议可以完全脱离研究结果", "建议必须使用祈使句", "建议应基于本研究结果，并说明适用条件"], answerIndex: 3, explanation: "建议的合法性来自结果与论证，超出证据范围会给读者错误指引，因此要说明适用对象与条件。宏大程度或句式形式都不是判据，脱离结果的建议更是缺乏依据。" },
  { id: "q-w39-3", kcId: "w39", difficulty: 3, stem: "结论与摘要中的结论句相比，主要区别是：", options: ["两者必须逐字相同", "结论部分展开说明意义、启示与边界，摘要中则高度压缩", "结论部分不能提到研究结果", "摘要中的结论句必须更长"], answerIndex: 1, explanation: "摘要受篇幅限制，结论句高度凝练；正文结论则展开讨论意义、启示和适用边界。两者在核心判断上应保持一致，不能互相矛盾，但详略与功能不同。" },

  // ── w40 全文一致性与修订 ──
  { id: "q-w40-1", kcId: "w40", difficulty: 2, stem: "检查全文一致性时，最核心的是确认：", options: ["每段长度完全一致", "所有句子都使用被动语态", "研究问题、方法、结果与结论之间相互对应", "参考文献数量足够多"], answerIndex: 2, explanation: "全文一致性要求论证链条闭合：问题由方法回答，结果支撑结论，结论不超出结果。段落长度、语态和文献数量都不是一致性的核心，机械统一格式也无法弥补逻辑断裂。" },
  { id: "q-w40-2", kcId: "w40", difficulty: 3, stem: "修订一篇论文时，较合理的优先级是：", options: ["先检查论证结构与段落逻辑，再润色句子和用词", "先逐字替换同义词，再考虑结构", "只检查拼写错误", "先调整字体和行距"], answerIndex: 0, explanation: "结构与论证决定论文是否成立，语言润色应建立在内容组织正确的基础上。过早纠结措辞可能白费功夫，拼写和排版属于更后期的细节，不能替代对论证链条的检查。" },
  { id: "q-w40-3", kcId: "w40", difficulty: 4, stem: "反向提纲（reverse outline）的主要用途是：", options: ["自动生成参考文献", "把论文倒序打印", "统计全文词频", "逐段概括现有内容，检查每段功能与全文结构是否匹配"], answerIndex: 3, explanation: "反向提纲从已写成的段落中提炼要点，帮助作者发现重复、缺失或错位的段落功能，是检查宏观结构的常用方法。它与文献生成、打印顺序和词频统计无关，重点在结构诊断。" },
];
