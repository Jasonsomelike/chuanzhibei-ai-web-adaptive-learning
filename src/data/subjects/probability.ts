/**
 * 概率论与数理统计知识图谱与题库：40 个知识点 / 60 条先修边 / 120 题。
 *
 * 课程依据：国内高校《概率论与数理统计》通用教学大纲（浙大版体系）。
 * 每条边都是「不掌握前者，后者学不动」的真实依赖，不是按章节顺序硬连。
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";

export const probabilityGraph: KnowledgeGraph = {
  version: "kg-probability-v1",
  concepts: [
    // ── 第 1 章 随机事件与概率 ──
    { id: "r01", name: "样本空间与随机事件", chapter: "第1章 随机事件与概率", summary: "随机试验、样本空间、基本事件与随机事件的概念" },
    { id: "r02", name: "事件的关系与运算", chapter: "第1章 随机事件与概率", summary: "包含、并、交、差、对立及德摩根律" },
    { id: "r03", name: "概率的定义与性质", chapter: "第1章 随机事件与概率", summary: "概率的公理化定义、有限可加性、减法公式与加法公式" },
    { id: "r04", name: "古典概型", chapter: "第1章 随机事件与概率", summary: "等可能概型的计数方法与典型模型" },
    { id: "r05", name: "条件概率与乘法公式", chapter: "第1章 随机事件与概率", summary: "条件概率的定义、乘法公式及其应用" },
    { id: "r06", name: "全概率公式与贝叶斯公式", chapter: "第1章 随机事件与概率", summary: "完备事件组、全概率公式与后验概率计算" },

    // ── 第 2 章 随机变量及其分布 ──
    { id: "r07", name: "随机变量与分布函数", chapter: "第2章 随机变量及其分布", summary: "随机变量的定义、分布函数及其三条基本性质" },
    { id: "r08", name: "离散型随机变量", chapter: "第2章 随机变量及其分布", summary: "分布律、0-1 分布与分布函数的阶梯结构" },
    { id: "r09", name: "常用离散分布", chapter: "第2章 随机变量及其分布", summary: "二项分布、泊松分布及其应用条件" },
    { id: "r10", name: "连续型随机变量与概率密度", chapter: "第2章 随机变量及其分布", summary: "密度函数、连续型分布函数与区间概率计算" },
    { id: "r11", name: "常用连续分布", chapter: "第2章 随机变量及其分布", summary: "均匀分布、指数分布及其无记忆性" },
    { id: "r12", name: "正态分布", chapter: "第2章 随机变量及其分布", summary: "正态密度、标准化与查表计算" },
    { id: "r13", name: "随机变量函数的分布", chapter: "第2章 随机变量及其分布", summary: "离散与连续情形下求 Y=g(X) 的分布" },

    // ── 第 3 章 多维随机变量 ──
    { id: "r14", name: "二维随机变量与联合分布", chapter: "第3章 多维随机变量", summary: "联合分布函数、联合分布律与联合概率密度" },
    { id: "r15", name: "边缘分布", chapter: "第3章 多维随机变量", summary: "由联合分布求边缘分布律与边缘密度" },
    { id: "r16", name: "条件分布", chapter: "第3章 多维随机变量", summary: "离散与连续情形的条件分布及条件密度" },
    { id: "r17", name: "随机变量的独立性", chapter: "第3章 多维随机变量", summary: "独立性的定义、判别与不相关的区别" },
    { id: "r18", name: "二维随机变量函数的分布", chapter: "第3章 多维随机变量", summary: "和、商等函数的分布与卷积公式" },

    // ── 第 4 章 随机变量的数字特征 ──
    { id: "r19", name: "数学期望", chapter: "第4章 随机变量的数字特征", summary: "期望的定义、线性性质与随机变量函数的期望" },
    { id: "r20", name: "方差", chapter: "第4章 随机变量的数字特征", summary: "方差定义、计算公式与线性变换下的性质" },
    { id: "r21", name: "协方差与相关系数", chapter: "第4章 随机变量的数字特征", summary: "协方差、相关系数及不相关的含义" },
    { id: "r22", name: "矩与协方差矩阵", chapter: "第4章 随机变量的数字特征", summary: "原点矩、中心矩与协方差矩阵的结构" },
    { id: "r23", name: "条件期望", chapter: "第4章 随机变量的数字特征", summary: "条件期望的定义、性质与全期望公式" },

    // ── 第 5 章 大数定律与中心极限定理 ──
    { id: "r24", name: "切比雪夫不等式", chapter: "第5章 大数定律与中心极限定理", summary: "用方差估计偏离均值概率的上界" },
    { id: "r25", name: "大数定律", chapter: "第5章 大数定律与中心极限定理", summary: "切比雪夫、伯努利与辛钦大数定律" },
    { id: "r26", name: "中心极限定理", chapter: "第5章 大数定律与中心极限定理", summary: "独立同分布与棣莫弗-拉普拉斯中心极限定理" },

    // ── 第 6 章 数理统计基础 ──
    { id: "r27", name: "总体与样本", chapter: "第6章 数理统计基础", summary: "总体、简单随机样本与统计推断的基本思想" },
    { id: "r28", name: "统计量与样本矩", chapter: "第6章 数理统计基础", summary: "统计量、样本均值、样本方差与样本矩" },
    { id: "r29", name: "三大抽样分布", chapter: "第6章 数理统计基础", summary: "χ² 分布、t 分布、F 分布的定义与性质" },
    { id: "r30", name: "正态总体的抽样分布", chapter: "第6章 数理统计基础", summary: "样本均值与样本方差的分布及常用统计量" },
    { id: "r31", name: "经验分布函数与直方图", chapter: "第6章 数理统计基础", summary: "经验分布函数、频率直方图与数据初探" },

    // ── 第 7 章 参数估计 ──
    { id: "r32", name: "矩估计", chapter: "第7章 参数估计", summary: "用样本矩替换总体矩求估计量" },
    { id: "r33", name: "最大似然估计", chapter: "第7章 参数估计", summary: "似然函数、对数似然与最大似然估计" },
    { id: "r34", name: "估计量的评价标准", chapter: "第7章 参数估计", summary: "无偏性、有效性与相合性" },
    { id: "r35", name: "区间估计", chapter: "第7章 参数估计", summary: "置信区间、置信度与枢轴量法" },
    { id: "r36", name: "正态总体的区间估计", chapter: "第7章 参数估计", summary: "均值与方差的置信区间构造" },

    // ── 第 8 章 假设检验 ──
    { id: "r37", name: "假设检验的基本原理", chapter: "第8章 假设检验", summary: "原假设、备择假设、两类错误与 p 值" },
    { id: "r38", name: "正态总体均值的检验", chapter: "第8章 假设检验", summary: "U 检验与 t 检验的适用条件" },
    { id: "r39", name: "正态总体方差的检验", chapter: "第8章 假设检验", summary: "χ² 检验与 F 检验" },
    { id: "r40", name: "拟合优度检验与两类错误", chapter: "第8章 假设检验", summary: "χ² 拟合优度检验、功效与两类错误的控制" },
  ],
  edges: [
    // 第 1 章
    { before: "r01", after: "r02" },
    { before: "r02", after: "r03" },
    { before: "r02", after: "r04" },
    { before: "r03", after: "r05" },
    { before: "r05", after: "r06" },

    // 第 2 章
    { before: "r03", after: "r07" },
    { before: "r07", after: "r08" },
    { before: "r08", after: "r09" },
    { before: "r04", after: "r09" },
    { before: "r07", after: "r10" },
    { before: "r10", after: "r11" },
    { before: "r10", after: "r12" },
    { before: "r08", after: "r13" },
    { before: "r10", after: "r13" },

    // 第 3 章
    { before: "r08", after: "r14" },
    { before: "r10", after: "r14" },
    { before: "r14", after: "r15" },
    { before: "r14", after: "r16" },
    { before: "r05", after: "r16" },
    { before: "r15", after: "r17" },
    { before: "r14", after: "r18" },
    { before: "r13", after: "r18" },

    // 第 4 章
    { before: "r08", after: "r19" },
    { before: "r10", after: "r19" },
    { before: "r19", after: "r20" },
    { before: "r19", after: "r21" },
    { before: "r20", after: "r21" },
    { before: "r14", after: "r21" },
    { before: "r19", after: "r22" },
    { before: "r21", after: "r22" },
    { before: "r19", after: "r23" },
    { before: "r16", after: "r23" },

    // 第 5 章
    { before: "r20", after: "r24" },
    { before: "r24", after: "r25" },
    { before: "r19", after: "r25" },
    { before: "r20", after: "r26" },
    { before: "r12", after: "r26" },

    // 第 6 章
    { before: "r17", after: "r27" },
    { before: "r27", after: "r28" },
    { before: "r19", after: "r28" },
    { before: "r12", after: "r29" },
    { before: "r28", after: "r29" },
    { before: "r29", after: "r30" },
    { before: "r28", after: "r30" },
    { before: "r27", after: "r31" },

    // 第 7 章
    { before: "r28", after: "r32" },
    { before: "r08", after: "r33" },
    { before: "r10", after: "r33" },
    { before: "r28", after: "r34" },
    { before: "r19", after: "r34" },
    { before: "r20", after: "r34" },
    { before: "r29", after: "r35" },
    { before: "r30", after: "r36" },
    { before: "r35", after: "r36" },

    // 第 8 章
    { before: "r35", after: "r37" },
    { before: "r37", after: "r38" },
    { before: "r30", after: "r38" },
    { before: "r37", after: "r39" },
    { before: "r29", after: "r39" },
    { before: "r37", after: "r40" },
  ],
};

export const probabilityQuestions: readonly Question[] = [
  // ── r01 样本空间与随机事件 ──
  { id: "q-r01-1", kcId: "r01", difficulty: 1, stem: "掷一枚均匀骰子，其样本空间是：", options: ["{1,2,3}", "{1,2,3,4,5,6}", "{奇数,偶数}", "{0,1,2,3,4,5,6}"], answerIndex: 1, explanation: "样本空间是全部可能结果组成的集合，掷一枚骰子可能出现 1 到 6 点，故为 {1,2,3,4,5,6}；{奇数,偶数} 只是对结果的一种分类，不是基本结果本身。" },
  { id: "q-r01-2", kcId: "r01", difficulty: 2, stem: "连续掷两枚硬币，事件「恰有一枚正面」包含的样本点个数是：", options: ["1", "2", "3", "4"], answerIndex: 1, explanation: "样本空间为 {正正,正反,反正,反反}，恰有一枚正面包含「正反」与「反正」两个样本点；把两枚硬币视为不可区分会漏算，只得到 1 个。" },
  { id: "q-r01-3", kcId: "r01", difficulty: 3, stem: "连续掷一枚硬币直到首次出现正面，该试验的样本空间是：", options: ["{正,反}", "有限集", "可列无限集", "不可列无限集"], answerIndex: 2, explanation: "可能结果为「正」「反正」「反反正」等，每个结果对应一个正整数次，全体构成可列无限集；它不是有限集，也不涉及连续取值，因此不是不可列无限集。" },

  // ── r02 事件的关系与运算 ──
  { id: "q-r02-1", kcId: "r02", difficulty: 2, stem: "设事件 A⊂B，则 A∪B 等于：", options: ["A", "B", "A∩B", "∅"], answerIndex: 1, explanation: "A 包含于 B 意味着 A 的每个样本点都在 B 中，所以并集就是 B；A∩B 反而等于 A，不能与并集混淆。" },
  { id: "q-r02-2", kcId: "r02", difficulty: 3, stem: "对任意事件 A、B，A∪B 的对立事件等于：", options: ["A−B", "A 的对立事件 ∪ B 的对立事件", "A 的对立事件 ∩ B 的对立事件", "A∩B"], answerIndex: 2, explanation: "德摩根律指出「A 或 B 发生」的对立是「A 不发生且 B 不发生」，即两个对立事件的交；写成并集会错误地包含只发生其中一个的情形。" },
  { id: "q-r02-3", kcId: "r02", difficulty: 4, stem: "已知 P(A)=0.4，P(B)=0.7，且 A⊂B，则 P(B−A)=：", options: ["0.1", "0.3", "0.4", "0.7"], answerIndex: 1, explanation: "因为 A⊂B，B−A 与 A 互斥且并起来是 B，所以 P(B−A)=P(B)−P(A)=0.7−0.4=0.3；能直接相减的前提正是包含关系。" },

  // ── r03 概率的定义与性质 ──
  { id: "q-r03-1", kcId: "r03", difficulty: 1, stem: "对任意事件 A，P(A) 的取值范围是：", options: ["[0,+∞)", "(−∞,+∞)", "[0,1]", "(0,1)"], answerIndex: 2, explanation: "概率的公理化定义要求非负性与规范性，任何事件的概率都不小于 0 且不大于 1；取开区间会漏掉不可能事件与必然事件。" },
  { id: "q-r03-2", kcId: "r03", difficulty: 2, stem: "已知 P(A)=0.5，P(B)=0.4，P(A∪B)=0.7，则 P(A∩B)=：", options: ["0.4", "0.1", "0.2", "0.3"], answerIndex: 2, explanation: "由加法公式 P(A∪B)=P(A)+P(B)−P(A∩B)，代入得 0.7=0.5+0.4−P(A∩B)，所以 P(A∩B)=0.2；漏减交集会把并集概率算大。" },
  { id: "q-r03-3", kcId: "r03", difficulty: 3, stem: "若 P(A)=P(B)=0.7，则 P(A∩B) 的最小值是：", options: ["0.2", "0.3", "0.4", "0.7"], answerIndex: 2, explanation: "由加法公式 P(A∩B)=1.4−P(A∪B)，而并集概率不超过 1，所以交集概率至少为 0.4；当 A∪B 为必然事件时取到该下界。" },

  // ── r04 古典概型 ──
  { id: "q-r04-1", kcId: "r04", difficulty: 1, stem: "掷两枚均匀骰子，点数之和为 7 的概率是：", options: ["1/12", "1/6", "1/9", "1/3"], answerIndex: 1, explanation: "样本点共 36 个，和为 7 的有 (1,6)、(2,5)、(3,4)、(4,3)、(5,2)、(6,1) 共 6 个，概率 6/36=1/6；把两枚骰子当成相同会漏掉顺序，得到错误答案。" },
  { id: "q-r04-2", kcId: "r04", difficulty: 2, stem: "袋中有 5 个白球、3 个黑球，任取 2 个，恰有 1 个黑球的概率是：", options: ["3/8", "15/56", "15/28", "5/14"], answerIndex: 2, explanation: "从 8 个球取 2 个共 C(8,2)=28 种，恰有 1 黑即 1 黑 1 白，共 C(3,1)C(5,1)=15 种，概率 15/28；只算有利组合数而不除总数会得到大于 1 的结果。" },
  { id: "q-r04-3", kcId: "r04", difficulty: 3, stem: "5 本不同的书随机排成一排，其中指定的两本书相邻的概率是：", options: ["1/2", "1/5", "2/5", "1/4"], answerIndex: 2, explanation: "两本指定书相邻可捆绑成一个整体，与其余 3 本共 4 个对象排列，内部还有 2 种顺序，故有利排列 4!×2=48，总排列 5!=120，概率 48/120=2/5；忘记内部顺序会得到 1/5。" },

  // ── r05 条件概率与乘法公式 ──
  { id: "q-r05-1", kcId: "r05", difficulty: 2, stem: "当 P(A)>0 时，条件概率 P(B|A) 的定义是：", options: ["P(A∩B)/P(B)", "P(A)/P(A∩B)", "P(A∪B)/P(A)", "P(A∩B)/P(A)"], answerIndex: 3, explanation: "条件概率把 A 看作新的样本空间，用 A 与 B 同时发生的概率除以 A 的概率作归一化；分母写成 P(B) 会得到相反方向的条件概率。" },
  { id: "q-r05-2", kcId: "r05", difficulty: 3, stem: "已知 P(A)=0.5，P(B|A)=0.4，则 P(A∩B)=：", options: ["0.4", "0.1", "0.2", "0.3"], answerIndex: 2, explanation: "由乘法公式 P(A∩B)=P(A)P(B|A)=0.5×0.4=0.2；条件概率不是交集的概率，必须乘以前提事件的概率。" },
  { id: "q-r05-3", kcId: "r05", difficulty: 4, stem: "已知 P(A)=0.6，P(A∪B)=0.8，P(B|A)=0.5，则 P(B)=：", options: ["0.4", "0.5", "0.6", "0.3"], answerIndex: 1, explanation: "先由乘法公式得 P(A∩B)=0.6×0.5=0.3，再由加法公式 0.8=0.6+P(B)−0.3，解得 P(B)=0.5；漏掉交集项会误得 0.2。" },

  // ── r06 全概率公式与贝叶斯公式 ──
  { id: "q-r06-1", kcId: "r06", difficulty: 2, stem: "全概率公式要求事件组 B1,B2,…,Bn 满足：", options: ["两两独立", "概率都相等", "每个都是必然事件", "两两互斥且并为样本空间"], answerIndex: 3, explanation: "全概率公式把样本空间按互斥完备事件组切开，再用条件概率加权求和；若事件组不覆盖整个样本空间，就会漏掉部分概率，独立或等概率都不是必要条件。" },
  { id: "q-r06-2", kcId: "r06", difficulty: 3, stem: "甲箱有 2 白 1 黑，乙箱有 1 白 2 黑，等概率选一箱后取一球，取到白球的概率是：", options: ["2/3", "5/6", "1/3", "1/2"], answerIndex: 3, explanation: "由全概率公式，P(白)=1/2×2/3+1/2×1/3=1/3+1/6=1/2；只把两箱白球数简单平均会忽略取球是在选中箱子的条件下进行的。" },
  { id: "q-r06-3", kcId: "r06", difficulty: 4, stem: "承上题，若取到的是白球，则它来自甲箱的概率是：", options: ["2/3", "3/4", "1/3", "1/2"], answerIndex: 0, explanation: "由贝叶斯公式，P(甲|白)=P(甲)P(白|甲)/P(白)=(1/2×2/3)/(1/2)=2/3；分母必须用全概率算出的总概率，不能只用甲箱的先验 1/2。" },

  // ── r07 随机变量与分布函数 ──
  { id: "q-r07-1", kcId: "r07", difficulty: 1, stem: "随机变量 X 的分布函数定义为：", options: ["P(X=x)", "P(X>x)", "P(X<x)", "P(X≤x)"], answerIndex: 3, explanation: "分布函数 F(x)=P(X≤x)，包含等号，因此是右连续的；定义成 P(X<x) 会使跳跃点的取值不同，破坏右连续性。" },
  { id: "q-r07-2", kcId: "r07", difficulty: 2, stem: "设 F 为 X 的分布函数，则 P(a<X≤b)=：", options: ["F(b)+F(a)", "1−F(b)+F(a)", "F(a)−F(b)", "F(b)−F(a)"], answerIndex: 3, explanation: "P(a<X≤b)=P(X≤b)−P(X≤a)=F(b)−F(a)；端点是否取等会影响结果，左开右闭恰好对应两个分布函数之差。" },
  { id: "q-r07-3", kcId: "r07", difficulty: 3, stem: "设 X 的分布函数为 F(x)=0（x<0），F(x)=1−e^(−x)（x≥0），则 P(1<X≤2)=：", options: ["e^(−1)−e^(−2)", "e^(−2)−e^(−1)", "1−e^(−2)", "e^(−1)"], answerIndex: 0, explanation: "由 P(1<X≤2)=F(2)−F(1)=(1−e^(−2))−(1−e^(−1))=e^(−1)−e^(−2)；直接用 1−e^(−2) 会把 X≤1 的部分也算进去。" },

  // ── r08 离散型随机变量 ──
  { id: "q-r08-1", kcId: "r08", difficulty: 2, stem: "离散型随机变量 X 的分布律中，所有概率之和必须等于：", options: ["样本容量", "期望", "0", "1"], answerIndex: 3, explanation: "分布律列出全部可能取值及其概率，这些取值互斥且穷尽样本空间，所以概率总和为 1；总和为 0 或等于样本容量都不符合概率的规范性。" },
  { id: "q-r08-2", kcId: "r08", difficulty: 3, stem: "设 X 的分布函数在 x=2 处由 0.3 跳到 0.8，则 P(X=2)=：", options: ["1", "0.3", "0.5", "0.8"], answerIndex: 2, explanation: "离散型随机变量在取值点的概率等于分布函数在该点的跳跃高度，即 0.8−0.3=0.5；取 0.8 是把累积概率误当成点概率。" },
  { id: "q-r08-3", kcId: "r08", difficulty: 4, stem: "设 P(X=k)=c/2^k，k=1,2,…，则常数 c=：", options: ["1/2", "1", "2", "4"], answerIndex: 1, explanation: "由规范性，Σ_{k≥1} c/2^k=c×(1/2)/(1−1/2)=c=1，所以 c=1；若把级数首项 c/2 直接当成总和，会误得 c=2。" },

  // ── r09 常用离散分布 ──
  { id: "q-r09-1", kcId: "r09", difficulty: 1, stem: "若 X~B(10,0.3)，则 E(X)=：", options: ["3", "7", "10", "0.3"], answerIndex: 0, explanation: "二项分布 B(n,p) 的期望为 np=10×0.3=3；0.3 是单次成功概率，7 是失败次数的期望，都不是 X 的期望。" },
  { id: "q-r09-2", kcId: "r09", difficulty: 2, stem: "若 X~P(λ) 且 P(X=0)=e^(−2)，则 λ=：", options: ["1", "2", "e", "1/2"], answerIndex: 1, explanation: "泊松分布 P(X=0)=e^(−λ)，由 e^(−λ)=e^(−2) 得 λ=2；把 e^(−2) 直接当作 λ 会混淆参数与概率值。" },
  { id: "q-r09-3", kcId: "r09", difficulty: 3, stem: "某射手命中率为 0.02，独立射击 200 次，用泊松近似，恰有一次命中的概率约为：", options: ["4e^(−4)", "e^(−4)", "4e^(−2)", "2e^(−2)"], answerIndex: 0, explanation: "λ=np=200×0.02=4，泊松近似下 P(X=1)=λe^(−λ)=4e^(−4)；用 λ=2 是把 200 次误当成 100 次，导致指数与系数都不对。" },

  // ── r10 连续型随机变量与概率密度 ──
  { id: "q-r10-1", kcId: "r10", difficulty: 1, stem: "连续型随机变量的概率密度 f(x) 必须满足：", options: ["f(x)≤1 且积分等于 1", "f(x)≥0 且积分等于 1", "f(x) 单调递增", "f(x) 在每点都连续"], answerIndex: 1, explanation: "密度的两条基本性质是非负性与积分为 1；密度值可以大于 1，只要积分仍为 1，所以 f(x)≤1 不是必要条件，连续与单调也不是定义要求。" },
  { id: "q-r10-2", kcId: "r10", difficulty: 2, stem: "设 X 的密度为 f(x)=c（0≤x≤2），其他为 0，则 c=：", options: ["1", "2", "1/4", "1/2"], answerIndex: 3, explanation: "由密度积分为 1，∫_0^2 c dx=2c=1，所以 c=1/2；c=1 会使总概率变成 2，违反规范性。" },
  { id: "q-r10-3", kcId: "r10", difficulty: 3, stem: "设 X 的密度为 f(x)=2x（0≤x≤1），则 P(X≤0.5)=：", options: ["0.125", "0.25", "0.5", "0.75"], answerIndex: 1, explanation: "P(X≤0.5)=∫_0^0.5 2x dx=x² 在 0 到 0.5 上的增量=0.25；把密度在端点的值 1 当成概率会误得 0.5。" },

  // ── r11 常用连续分布 ──
  { id: "q-r11-1", kcId: "r11", difficulty: 2, stem: "若 X~U(1,5)，则 P(2<X<4)=：", options: ["1/4", "1/2", "3/4", "1"], answerIndex: 1, explanation: "均匀分布在区间 (1,5) 上密度为 1/4，区间 (2,4) 长度为 2，概率为 2×1/4=1/2；直接用区间长度 2 当概率会超过 1。" },
  { id: "q-r11-2", kcId: "r11", difficulty: 3, stem: "指数分布的无记忆性可表示为：", options: ["P(X>s+t|X>s)=P(X>t)", "P(X>s+t)=P(X>s)+P(X>t)", "P(X>s|X>t)=P(X>s)", "P(X<s+t)=P(X<s)P(X<t)"], answerIndex: 0, explanation: "无记忆性指已经存活 s 的条件下再存活 t 的概率与从头算起相同；把它写成概率相加或相乘都混淆了条件概率与联合概率。" },
  { id: "q-r11-3", kcId: "r11", difficulty: 4, stem: "设 X~E(λ)，且 P(X>2)=0.25，则 P(X>4)=：", options: ["1/2", "1/16", "1/8", "1/4"], answerIndex: 1, explanation: "由 P(X>2)=e^(−2λ)=0.25 得 e^(−λ)=1/2，于是 P(X>4)=e^(−4λ)=(e^(−λ))^4=1/16；若把概率随区间长度线性外推，会错误地得到 1/8 或 0.5，指数尾概率是按指数衰减的。" },

  // ── r12 正态分布 ──
  { id: "q-r12-1", kcId: "r12", difficulty: 1, stem: "若 X~N(μ,σ²)，将其标准化应令 Z=：", options: ["(X−σ)/μ", "(X−μ)/σ²", "(X+μ)/σ", "(X−μ)/σ"], answerIndex: 3, explanation: "标准化用标准差 σ 而不是方差 σ² 去除中心化后的偏差，得到均值 0、方差 1 的标准正态变量；除以 σ² 会使方差变成 1/σ²。" },
  { id: "q-r12-2", kcId: "r12", difficulty: 2, stem: "若 X~N(2,4)，则 P(X<2)=：", options: ["0.5", "0.75", "1", "0.25"], answerIndex: 0, explanation: "正态分布关于均值 μ=2 对称，均值左侧的概率恰为 0.5；注意第二个参数 4 是方差，标准差为 2，但不影响中位数位置。" },
  { id: "q-r12-3", kcId: "r12", difficulty: 3, stem: "若 X~N(10,4)，则 P(8<X<12) 约为：", options: ["0.6826", "0.9544", "0.9973", "0.3413"], answerIndex: 0, explanation: "标准化后区间对应 −1<Z<1，标准正态在 ±1 内的概率约为 0.6826；0.9544 对应 ±2 倍标准差，说明把方差 4 误当成了标准差。" },

  // ── r13 随机变量函数的分布 ──
  { id: "q-r13-1", kcId: "r13", difficulty: 2, stem: "若 X~U(0,1)，令 Y=2X，则 Y 服从：", options: ["指数分布", "U(0,1)", "U(0,2)", "U(1,2)"], answerIndex: 2, explanation: "线性变换把区间 (0,1) 拉伸为 (0,2)，均匀性保持，故 Y~U(0,2)；区间端点由变换直接决定，不能仍写 U(0,1)。" },
  { id: "q-r13-2", kcId: "r13", difficulty: 3, stem: "若 X~N(0,1)，令 Y=X²，则 Y 服从：", options: ["F(1,1)", "N(0,1)", "χ²(1)", "t(1)"], answerIndex: 2, explanation: "标准正态变量的平方服从自由度为 1 的卡方分布，这是卡方分布的定义；t 分布是正态除以卡方开方，F 分布是两个卡方之比，都不是平方本身。" },
  { id: "q-r13-3", kcId: "r13", difficulty: 4, stem: "设 X 的密度为 f_X(x)，令 Y=X²，则 Y 的密度为：", options: ["f_X(√y)+f_X(−√y)", "2√y·f_X(√y)", "f_X(√y)/(2√y)", "[f_X(√y)+f_X(−√y)]/(2√y)"], answerIndex: 3, explanation: "Y=X² 有两个原像 ±√y，两个分支的概率都要计入，再乘雅可比 1/(2√y)；只写正分支会漏掉 X 取负值的那一半概率。" },

  // ── r14 二维随机变量与联合分布 ──
  { id: "q-r14-1", kcId: "r14", difficulty: 2, stem: "二维连续型随机变量 (X,Y) 的联合密度 f(x,y) 满足：", options: ["对 x 的积分为 1", "二重积分为 1", "f(x,y)≤1", "f(x,y) 关于 x 单调"], answerIndex: 1, explanation: "联合密度在整个平面上的二重积分等于 1，表示总概率为 1；只对 x 积分得到的是边缘密度而非 1，密度值也可以大于 1。" },
  { id: "q-r14-2", kcId: "r14", difficulty: 3, stem: "设 (X,Y) 在单位正方形 0<x<1,0<y<1 上服从均匀分布，则 P(X+Y≤1)=：", options: ["2/3", "1/4", "1/3", "1/2"], answerIndex: 3, explanation: "单位正方形中满足 x+y≤1 的部分是下三角，面积 1/2，均匀分布下概率等于面积比 1/2；把区域当成整块正方形会误得 1。" },
  { id: "q-r14-3", kcId: "r14", difficulty: 4, stem: "设 f(x,y)=cxy（0<x<1，0<y<1），其他为 0，则 c=：", options: ["2", "4", "8", "1"], answerIndex: 1, explanation: "二重积分 ∫_0^1∫_0^1 cxy dxdy=c×(1/2)×(1/2)=c/4，令其等于 1 得 c=4；只对一个变量积分会误得 c=2。" },

  // ── r15 边缘分布 ──
  { id: "q-r15-1", kcId: "r15", difficulty: 1, stem: "由联合分布求 X 的边缘分布，本质上是：", options: ["对 Y 的所有取值求和或积分", "对 X 的所有取值求和或积分", "求条件分布", "求期望"], answerIndex: 0, explanation: "边缘分布是把另一个变量「积掉」：离散时对 Y 求和，连续时对 y 积分，从而只剩 X 的分布；对 X 本身求和会得到总概率 1。" },
  { id: "q-r15-2", kcId: "r15", difficulty: 2, stem: "设联合密度 f(x,y)=e^(−(x+y))（x>0,y>0），则 X 的边缘密度为：", options: ["e^(−(x+y))", "1", "e^(−x)", "e^(−y)"], answerIndex: 2, explanation: "f_X(x)=∫_0^∞ e^(−(x+y))dy=e^(−x)∫_0^∞ e^(−y)dy=e^(−x)；保留联合密度说明没有完成对 y 的积分。" },
  { id: "q-r15-3", kcId: "r15", difficulty: 3, stem: "设联合密度 f(x,y)=2（0<x<y<1），则 X 的边缘密度在 0<x<1 上为：", options: ["2x", "1−x", "2", "2(1−x)"], answerIndex: 3, explanation: "对给定 x，y 的范围是 x<y<1，故 f_X(x)=∫_x^1 2dy=2(1−x)；写成 2x 是把积分上下限弄反，写成 2 是忘记积分。" },

  // ── r16 条件分布 ──
  { id: "q-r16-1", kcId: "r16", difficulty: 2, stem: "连续情形下条件密度 f_{X|Y}(x|y) 等于：", options: ["f(x,y)/f_Y(y)", "f_X(x)f_Y(y)", "f_Y(y)/f(x,y)", "f(x,y)/f_X(x)"], answerIndex: 0, explanation: "条件密度用联合密度除以条件变量 Y 的边缘密度作归一化；除以 X 的边缘密度会得到反方向的条件密度，乘积则是独立时的联合密度。" },
  { id: "q-r16-2", kcId: "r16", difficulty: 3, stem: "联合分布律为 P(X=0,Y=0)=0.2，P(X=0,Y=1)=0.3，P(X=1,Y=0)=0.1，P(X=1,Y=1)=0.4，则 P(X=1|Y=0)=：", options: ["0.1", "0.4", "1/3", "1/2"], answerIndex: 2, explanation: "P(Y=0)=0.2+0.1=0.3，P(X=1,Y=0)=0.1，故条件概率 0.1/0.3=1/3；直接用 0.1 是忘了除以条件事件的概率。" },
  { id: "q-r16-3", kcId: "r16", difficulty: 4, stem: "设 f(x,y)=2（0<y<x<1），则在给定 Y=y 时 X 的条件密度为：", options: ["1/(1−y)（y<x<1）", "1/y（0<x<y）", "2（0<x<1）", "1−y（y<x<1）"], answerIndex: 0, explanation: "先求 f_Y(y)=∫_y^1 2dx=2(1−y)，再用 f(x,y)/f_Y(y)=2/[2(1−y)]=1/(1−y)，定义域为 y<x<1；分母若仍用 2 会忘记归一化。" },

  // ── r17 随机变量的独立性 ──
  { id: "q-r17-1", kcId: "r17", difficulty: 1, stem: "随机变量 X 与 Y 相互独立的充要条件是：", options: ["X 与 Y 不相关", "对任意 x,y，F(x,y)=F_X(x)F_Y(y)", "Cov(X,Y)=0", "E(XY)=E(X)E(Y)"], answerIndex: 1, explanation: "独立性要求联合分布函数等于两个边缘分布函数之积，这是对全部取值成立的分布层面条件；协方差为零只是独立性的一个必要条件，不能反推独立。" },
  { id: "q-r17-2", kcId: "r17", difficulty: 2, stem: "联合分布律为 P(0,0)=0.2，P(0,1)=0.2，P(1,0)=0.3，P(1,1)=0.3，则 X 与 Y：", options: ["无法判断", "独立", "不独立", "相关"], answerIndex: 1, explanation: "边缘概率分别为 P(X=0)=0.4、P(X=1)=0.6、P(Y=0)=0.5、P(Y=1)=0.5，每个联合概率都等于对应边缘概率之积，故独立；仅凭表格对称不能直接下结论，需逐格验证。" },
  { id: "q-r17-3", kcId: "r17", difficulty: 3, stem: "若 X 与 Y 相互独立，则下列结论一定成立的是：", options: ["Var(X+Y)=Var(X)+Var(Y)+2Cov(X,Y)", "Cov(X,Y)=0", "X 与 Y 服从同一分布", "X+Y 服从正态分布"], answerIndex: 1, explanation: "独立可推出协方差为零，从而不相关；同分布、和的分布为正态都需要额外条件，而方差公式本身对任意变量都成立，并不是独立带来的特殊结论。" },

  // ── r18 二维随机变量函数的分布 ──
  { id: "q-r18-1", kcId: "r18", difficulty: 2, stem: "设 X、Y 相互独立且都服从 U(0,1)，则 P(X+Y≤1)=：", options: ["3/4", "1/4", "1/3", "1/2"], answerIndex: 3, explanation: "(X,Y) 在单位正方形均匀分布，x+y≤1 对应下三角区域，面积为 1/2，故概率为 1/2；把区域当成整个正方形会误得 1。" },
  { id: "q-r18-2", kcId: "r18", difficulty: 3, stem: "设 X~P(λ1)，Y~P(λ2) 且相互独立，则 X+Y 服从：", options: ["N(λ1+λ2,λ1+λ2)", "P(λ1+λ2)", "P(λ1λ2)", "B(λ1,λ2)"], answerIndex: 1, explanation: "独立泊松变量之和仍为泊松分布，参数相加，这可由卷积或母函数证明；参数相乘或直接套正态近似都不对。" },
  { id: "q-r18-3", kcId: "r18", difficulty: 4, stem: "设 X、Y 独立同分布 U(0,1)，Z=X+Y，则 f_Z(1.5)=：", options: ["1", "0.25", "0.5", "0.75"], answerIndex: 2, explanation: "两个均匀分布之和的密度在 1<z<2 上为 2−z，代入 z=1.5 得 0.5；在 0<z<1 上才是 z，混用分段会得到 1.5 这种不可能大于 1 的密度值。" },

  // ── r19 数学期望 ──
  { id: "q-r19-1", kcId: "r19", difficulty: 1, stem: "对任意常数 a,b，E(aX+b)=：", options: ["E(X)+b", "aE(X)+b", "aE(X)", "aE(X)+ab"], answerIndex: 1, explanation: "期望具有线性性质，常数倍提出、常数项直接加上；漏掉 b 或把 b 也乘 a 都是把线性运算与乘积运算混淆。" },
  { id: "q-r19-2", kcId: "r19", difficulty: 2, stem: "设 X 的分布律为 P(X=−1)=0.2，P(X=0)=0.3，P(X=1)=0.5，则 E(X)=：", options: ["1", "0.1", "0.3", "0.5"], answerIndex: 2, explanation: "E(X)=−1×0.2+0×0.3+1×0.5=0.3；只加正项会得到 0.5，忽略负值贡献是常见错误。" },
  { id: "q-r19-3", kcId: "r19", difficulty: 3, stem: "设 X~U(0,1)，则 E(X²)=：", options: ["1/3", "1/4", "1", "1/2"], answerIndex: 0, explanation: "E(X²)=∫_0^1 x²dx=1/3；注意 E(X²) 与 [E(X)]²=1/4 不同，前者是二阶原点矩，后者是均值平方。" },

  // ── r20 方差 ──
  { id: "q-r20-1", kcId: "r20", difficulty: 2, stem: "对任意常数 a,b，Var(aX+b)=：", options: ["aVar(X)", "aVar(X)+b", "a²Var(X)", "a²Var(X)+b"], answerIndex: 2, explanation: "方差衡量离散程度，平移 b 不改变离散程度，乘 a 后偏差放大 a 倍、平方后放大 a² 倍；把 b 加进方差是最常见的错误。" },
  { id: "q-r20-2", kcId: "r20", difficulty: 3, stem: "设 E(X)=2，E(X²)=5，则 Var(X)=：", options: ["1", "3", "5", "9"], answerIndex: 0, explanation: "Var(X)=E(X²)−[E(X)]²=5−4=1；直接用 E(X²) 减 E(X) 会误得 3，忘记均值要平方。" },
  { id: "q-r20-3", kcId: "r20", difficulty: 4, stem: "设 X、Y 相互独立，Var(X)=4，Var(Y)=9，则 Var(2X−Y)=：", options: ["25", "97", "7", "17"], answerIndex: 0, explanation: "独立时 Var(2X−Y)=4Var(X)+Var(Y)=16+9=25，负号在平方后消失；把系数 2 只乘一次会得到 8+9=17。" },

  // ── r21 协方差与相关系数 ──
  { id: "q-r21-1", kcId: "r21", difficulty: 1, stem: "Cov(X,Y) 的计算式是：", options: ["E(X²)−[E(X)]²", "E(X+Y)", "E(XY)−E(X)E(Y)", "E(XY)+E(X)E(Y)"], answerIndex: 2, explanation: "协方差按定义展开为 E[(X−EX)(Y−EY)]=E(XY)−E(X)E(Y)；选项 E(X²)−[E(X)]² 是方差公式，把协方差与方差混为一谈是最常见的错误，另两个选项则把乘积的期望与和式搞混。" },
  { id: "q-r21-2", kcId: "r21", difficulty: 2, stem: "相关系数 ρ_XY 的取值范围是：", options: ["(−∞,+∞)", "[−1,0]", "[0,1]", "[−1,1]"], answerIndex: 3, explanation: "由柯西-施瓦茨不等式可得 |ρ_XY|≤1，取 −1 表示完全负线性相关，取 1 表示完全正线性相关；限定为非负会漏掉负相关的情形。" },
  { id: "q-r21-3", kcId: "r21", difficulty: 3, stem: "若 Var(X)=4，Var(Y)=9，Cov(X,Y)=3，则 ρ_XY=：", options: ["1/2", "1/3", "3/4", "1/4"], answerIndex: 0, explanation: "ρ=Cov(X,Y)/[σ_X σ_Y]=3/(2×3)=1/2；直接用协方差除以方差之积 36 会得到 1/12，忘记开方是典型错误。" },

  // ── r22 矩与协方差矩阵 ──
  { id: "q-r22-1", kcId: "r22", difficulty: 1, stem: "随机变量 X 的 k 阶原点矩定义为：", options: ["E[(X−EX)^k]", "E(X)", "E(X²)", "E(X^k)"], answerIndex: 3, explanation: "k 阶原点矩是 E(X^k)，k 阶中心矩才是 E[(X−EX)^k]；一阶原点矩是均值，二阶中心矩是方差，二者不能混用。" },
  { id: "q-r22-2", kcId: "r22", difficulty: 2, stem: "二维随机变量 (X,Y) 的协方差矩阵，其主对角线元素分别是：", options: ["两个变量的相关系数", "两个变量的协方差", "两个变量的均值", "两个变量的方差"], answerIndex: 3, explanation: "协方差矩阵第 i 个对角元是 Cov(Xi,Xi)=Var(Xi)，非对角元才是协方差；对角线放均值或相关系数都不符合定义。" },
  { id: "q-r22-3", kcId: "r22", difficulty: 3, stem: "关于协方差矩阵，下列说法正确的是：", options: ["它一定是对角矩阵", "它的行列式一定为正", "它的迹一定等于 1", "它一定是对称半正定矩阵"], answerIndex: 3, explanation: "协方差矩阵对称，且对任意向量 a 有 aᵀΣa=Var(aᵀX)≥0，故半正定；只有各分量互不相关时才是对角阵，退化情形行列式可以为 0。" },

  // ── r23 条件期望 ──
  { id: "q-r23-1", kcId: "r23", difficulty: 2, stem: "离散情形下 E(X|Y=y) 等于：", options: ["Σ_y y·P(Y=y)", "E(X)E(Y)", "Σ_x x·P(X=x|Y=y)", "Σ_x x·P(X=x)"], answerIndex: 2, explanation: "条件期望是在给定 Y=y 的条件分布下对 X 求加权平均，权重必须是条件概率；用无条件概率求和得到的是 E(X)，与条件无关。" },
  { id: "q-r23-2", kcId: "r23", difficulty: 3, stem: "全期望公式可写成：", options: ["E(X)=E[E(X|Y)]", "E(X)=E(X|Y)", "E(X|Y)=E(X)E(Y)", "E(XY)=E(X|Y)E(Y)"], answerIndex: 0, explanation: "先按 Y 分层求条件期望，再对 Y 的分布取期望，就回到 X 的无条件期望；直接把 E(X|Y) 当成常数 E(X) 忽略了它仍是随机变量。" },
  { id: "q-r23-3", kcId: "r23", difficulty: 4, stem: "若 X 与 Y 相互独立，则 E(X|Y) 等于：", options: ["E(Y)", "E(XY)", "E(X)", "Y"], answerIndex: 2, explanation: "独立意味着 Y 的取值不提供关于 X 的任何信息，条件分布等于边缘分布，故条件期望退化为常数 E(X)；它并不等于 Y 或 E(Y)。" },

  // ── r24 切比雪夫不等式 ──
  { id: "q-r24-1", kcId: "r24", difficulty: 1, stem: "切比雪夫不等式给出的是：", options: ["P(|X−μ|≥ε)≥σ²/ε²", "P(|X−μ|≤ε)≤σ²/ε²", "P(X≥ε)≤σ/ε", "P(|X−μ|≥ε)≤σ²/ε²"], answerIndex: 3, explanation: "不等式用方差给出偏离均值超过 ε 的概率上界 σ²/ε²，从而得到落在 ε 内的概率至少为 1−σ²/ε²；把方向写成下界会得出无意义的结论。" },
  { id: "q-r24-2", kcId: "r24", difficulty: 2, stem: "设 E(X)=10，Var(X)=4，由切比雪夫不等式，P(|X−10|<3) 至少为：", options: ["5/9", "8/9", "1", "1/9"], answerIndex: 0, explanation: "取 ε=3，偏离至少 3 的概率不超过 4/9，所以落在 3 以内的概率至少为 1−4/9=5/9；把上界 4/9 直接当成下界是方向性错误。" },
  { id: "q-r24-3", kcId: "r24", difficulty: 3, stem: "切比雪夫不等式的主要特点是：", options: ["结果总是精确值", "只要求期望和方差存在，不要求分布已知", "只适用于正态分布", "必须知道密度函数"], answerIndex: 1, explanation: "该不等式只依赖均值与方差，因此对任何分布都成立，代价是给出的界通常较松；它并非正态分布专属，也不是精确等式。" },

  // ── r25 大数定律 ──
  { id: "q-r25-1", kcId: "r25", difficulty: 2, stem: "伯努利大数定律表明，当试验次数增大时：", options: ["事件发生的频率依概率收敛于其概率", "事件发生的频率等于概率", "样本方差趋于零", "随机变量趋于常数"], answerIndex: 0, explanation: "频率依概率收敛于概率，是「用频率估计概率」的理论依据；收敛是概率意义下的，不意味着某次试验后频率恰好等于概率。" },
  { id: "q-r25-2", kcId: "r25", difficulty: 3, stem: "辛钦大数定律要求的条件是：", options: ["独立同分布且数学期望存在", "独立同分布且方差存在", "相互独立但不必同分布", "方差有界即可"], answerIndex: 0, explanation: "辛钦大数定律只要求独立同分布、期望存在，不要求方差存在，这是它强于切比雪夫大数定律之处；把方差存在当成必要条件会低估其适用范围。" },
  { id: "q-r25-3", kcId: "r25", difficulty: 4, stem: "切比雪夫大数定律与辛钦大数定律的关键区别是：", options: ["前者要求同分布，后者不要求", "前者只适用于离散型，后者只适用于连续型", "两者条件完全相同", "前者要求方差存在且有界，后者只要求期望存在"], answerIndex: 3, explanation: "切比雪夫大数定律依靠方差有界来控制偏差，辛钦大数定律用特征函数方法把条件放宽到只需期望存在；因此二者的核心区别在于是否要求方差，而不是同分布要求。" },

  // ── r26 中心极限定理 ──
  { id: "q-r26-1", kcId: "r26", difficulty: 2, stem: "独立同分布中心极限定理说明，当 n 充分大时，样本均值 X̄ 近似服从：", options: ["N(0,1)", "N(0,σ²/n)", "N(μ,σ²)", "N(μ,σ²/n)"], answerIndex: 3, explanation: "X̄ 的均值仍为 μ，方差为 σ²/n，故近似服从 N(μ,σ²/n)；写成 N(μ,σ²) 忽略了样本均值比单个观测更集中这一关键事实。" },
  { id: "q-r26-2", kcId: "r26", difficulty: 3, stem: "设总体均值 10、方差 4，样本量 100，用中心极限定理近似，P(X̄≤10.4) 约为：", options: ["0.8413", "0.9772", "0.5", "0.1587"], answerIndex: 1, explanation: "X̄ 的标准差为 2/10=0.2，标准化得 z=(10.4−10)/0.2=2，Φ(2)=0.9772；若误把总体标准差 2 当作 X̄ 的标准差，会得到 z=0.2 附近的错误结论。" },
  { id: "q-r26-3", kcId: "r26", difficulty: 4, stem: "棣莫弗-拉普拉斯中心极限定理处理的是：", options: ["二项分布的正态近似", "泊松分布的指数近似", "均匀分布的均匀近似", "指数分布的正态近似"], answerIndex: 0, explanation: "该定理指出二项分布 B(n,p) 在 n 大时可用正态分布 N(np,np(1−p)) 近似，是历史上最早的中心极限定理；其他选项都不是该定理的内容。" },

  // ── r27 总体与样本 ──
  { id: "q-r27-1", kcId: "r27", difficulty: 1, stem: "简单随机样本要求样本 X1,…,Xn：", options: ["相互独立但分布可不同", "同分布但可以相关", "只需样本量足够大", "相互独立且与总体同分布"], answerIndex: 3, explanation: "简单随机抽样要求每个样本与总体同分布，且各次抽样相互独立，通常对应有放回抽样；缺少独立性或同分布性都会使后续统计量分布结论失效。" },
  { id: "q-r27-2", kcId: "r27", difficulty: 2, stem: "下列哪一项不是统计量？", options: ["样本均值", "样本方差", "样本最大值", "含未知参数 μ 的表达式 X̄−μ"], answerIndex: 3, explanation: "统计量是样本的函数且不能含未知参数，否则无法由数据算出；X̄−μ 中的 μ 未知，故不是统计量，而均值、方差、最大值都只依赖样本。" },
  { id: "q-r27-3", kcId: "r27", difficulty: 3, stem: "统计推断的基本逻辑是：", options: ["用样本替代总体逐一观测", "通过增加变量消除随机性", "由样本信息推断总体特征", "由总体参数直接算出样本"], answerIndex: 2, explanation: "总体通常无法全面观测，只能抽取样本，再借助样本的分布规律对总体参数作估计或检验；反向由总体推样本属于概率论的正问题，不是统计推断。" },

  // ── r28 统计量与样本矩 ──
  { id: "q-r28-1", kcId: "r28", difficulty: 1, stem: "样本均值 X̄ 的定义是：", options: ["(1/n)ΣXi", "ΣXi", "(1/(n−1))Σ(Xi−X̄)²", "max Xi"], answerIndex: 0, explanation: "样本均值是 n 个观测的算术平均，即 (1/n)ΣXi；不除 n 得到的是总和，而 (1/(n−1))Σ(Xi−X̄)² 是样本方差，三者含义完全不同。" },
  { id: "q-r28-2", kcId: "r28", difficulty: 2, stem: "样本方差 S² 的分母取 n−1 而不是 n，原因是：", options: ["使 S² 一定为正", "n−1 是自由度上限", "使 S² 成为总体方差的无偏估计", "计算更简单"], answerIndex: 2, explanation: "用样本均值代替总体均值会损失一个自由度，分母取 n−1 才能保证 E(S²)=σ²；分母取 n 得到的是有偏估计，通常偏小。" },
  { id: "q-r28-3", kcId: "r28", difficulty: 3, stem: "设总体方差为 σ²，样本量为 n，则 E(S²)=：", options: ["(n−1)σ²/n", "σ²/n", "σ²", "σ²/(n−1)"], answerIndex: 2, explanation: "样本方差 S² 是 σ² 的无偏估计，故其期望恰为 σ²；σ²/n 是样本均值的方差，两者容易混淆，注意区分统计量本身与其方差。" },

  // ── r29 三大抽样分布 ──
  { id: "q-r29-1", kcId: "r29", difficulty: 1, stem: "χ²(n) 分布可以表示为：", options: ["n 个独立标准正态变量平方和", "n 个独立正态变量之和", "两个卡方变量之比", "标准正态除以卡方"], answerIndex: 0, explanation: "卡方分布的定义就是 n 个相互独立的标准正态变量平方和，自由度即项数；正态变量之和仍是正态，不会得到卡方分布。" },
  { id: "q-r29-2", kcId: "r29", difficulty: 2, stem: "t(n) 分布可表示为：", options: ["Z/√(χ²(n)/n)，Z 与 χ²(n) 独立", "Z+χ²(n)", "χ²(n)/n", "两个 χ² 之比"], answerIndex: 0, explanation: "t 分布是一个标准正态变量除以独立卡方变量除以其自由度后的平方根；缺少独立性或忘记除以自由度都会改变分布。" },
  { id: "q-r29-3", kcId: "r29", difficulty: 3, stem: "若 F~F(m,n)，则 1/F 服从：", options: ["t(m)", "χ²(n)", "F(n,m)", "F(m,n)"], answerIndex: 2, explanation: "F 分布是两个卡方变量各除自由度之比，取倒数后分子分母互换，自由度也随之交换，故 1/F~F(n,m)；自由度不交换是常见错误。" },

  // ── r30 正态总体的抽样分布 ──
  { id: "q-r30-1", kcId: "r30", difficulty: 2, stem: "设总体 X~N(μ,σ²)，样本量为 n，则 X̄ 服从：", options: ["N(μ,σ²/n)", "N(0,1)", "χ²(n)", "N(μ,σ²)"], answerIndex: 0, explanation: "样本均值是独立正态变量的线性组合，仍为正态，均值为 μ、方差为 σ²/n；方差不会保持 σ²，这正是增大样本能提高精度的原因。" },
  { id: "q-r30-2", kcId: "r30", difficulty: 3, stem: "在正态总体下，(n−1)S²/σ² 服从：", options: ["χ²(n−1)", "χ²(n)", "t(n−1)", "F(n−1,n−1)"], answerIndex: 0, explanation: "该统计量是 n−1 个独立标准正态平方和，自由度为 n−1，因为样本均值占去一个自由度；写成 n 会高估自由度。" },
  { id: "q-r30-3", kcId: "r30", difficulty: 4, stem: "总体正态、σ 未知时，检验均值所用统计量 (X̄−μ)/(S/√n) 服从：", options: ["N(0,1)", "χ²(n−1)", "F(1,n−1)", "t(n−1)"], answerIndex: 3, explanation: "用样本标准差 S 替代 σ 后，分母本身带随机性，统计量服从自由度为 n−1 的 t 分布而不是标准正态；这正是小样本必须查 t 表的原因。" },

  // ── r31 经验分布函数与直方图 ──
  { id: "q-r31-1", kcId: "r31", difficulty: 1, stem: "经验分布函数 Fn(x) 表示：", options: ["样本密度函数", "样本均值", "样本中不超过 x 的观测比例", "总体的真实分布函数"], answerIndex: 2, explanation: "经验分布函数统计样本里取值不大于 x 的个数再除以 n，是总体分布函数的估计；它由数据直接构造，不需要知道真实分布。" },
  { id: "q-r31-2", kcId: "r31", difficulty: 2, stem: "绘制频率直方图时，若组距为 h、某组频率为 f，则该组对应的高度应取：", options: ["f·h", "h/f", "f", "f/h"], answerIndex: 3, explanation: "直方图用面积表示频率，矩形面积为高×组距，故高应为 f/h；直接把频率当高度会使总面积等于 1/h 而不是 1。" },
  { id: "q-r31-3", kcId: "r31", difficulty: 3, stem: "格里汶科定理说明，当 n→∞ 时经验分布函数：", options: ["逐点收敛但不一致", "收敛于正态分布", "不收敛", "以概率 1 一致收敛于总体分布函数"], answerIndex: 3, explanation: "格里汶科定理给出的是几乎必然的一致收敛，比逐点收敛更强，它是用经验分布估计总体分布的理论基础；收敛对象是总体分布函数而非正态分布。" },

  // ── r32 矩估计 ──
  { id: "q-r32-1", kcId: "r32", difficulty: 1, stem: "矩估计法的基本思想是：", options: ["用先验信息修正估计", "用样本矩替换总体矩建立方程", "最大化似然函数", "最小化残差平方和"], answerIndex: 1, explanation: "矩估计令样本矩等于总体矩，从中解出未知参数；最大化似然属于最大似然估计，最小化残差是最小二乘，三者方法不同。" },
  { id: "q-r32-2", kcId: "r32", difficulty: 2, stem: "设总体服从参数为 λ 的指数分布，E(X)=1/λ，则 λ 的矩估计量为：", options: ["X̄", "1/X̄", "X̄²", "1/X̄²"], answerIndex: 1, explanation: "令 X̄=1/λ 解得 λ=1/X̄，故矩估计量为 1/X̄；直接把 X̄ 当作 λ 忽略了参数在分母上这一关系。" },
  { id: "q-r32-3", kcId: "r32", difficulty: 3, stem: "关于矩估计法，下列说法正确的是：", options: ["估计量可能不唯一，且不一定存在", "估计量一定唯一且无偏", "一定比最大似然估计有效", "只适用于离散型总体"], answerIndex: 0, explanation: "方程个数与参数个数可能不匹配，导致多个解或无解，且矩估计一般不保证无偏与有效；它对离散和连续总体都适用，并非只限离散型。" },

  // ── r33 最大似然估计 ──
  { id: "q-r33-1", kcId: "r33", difficulty: 1, stem: "最大似然估计的基本思想是：", options: ["使估计量的方差最小", "使样本均值等于总体均值", "使置信区间最短", "选择使观测样本出现概率最大的参数值"], answerIndex: 3, explanation: "最大似然把已观测到的样本视为最可能发生的结果，选取使似然函数最大的参数；方差最小、区间最短都是评价估计的其他标准。" },
  { id: "q-r33-2", kcId: "r33", difficulty: 2, stem: "设 X~B(1,p)，样本为 x1,…,xn，则 p 的最大似然估计为：", options: ["1−X̄", "X̄²", "1/X̄", "X̄"], answerIndex: 3, explanation: "似然函数为 p^Σxi(1−p)^(n−Σxi)，取对数求导得 p̂=Σxi/n=X̄，即样本中成功的比例；1−X̄ 是失败比例的估计。" },
  { id: "q-r33-3", kcId: "r33", difficulty: 3, stem: "求最大似然估计时通常先取对数，主要原因是：", options: ["把连乘化为连加，便于求导并避免数值下溢", "对数一定使似然函数变大", "取对数后估计量不变但分布改变", "只有取对数才能得到无偏估计"], answerIndex: 0, explanation: "对数把乘积变成求和，简化求导且避免多个小概率相乘造成下溢，由于对数单调，最大值点不变；它并不改变估计量，也与无偏性无关。" },

  // ── r34 估计量的评价标准 ──
  { id: "q-r34-1", kcId: "r34", difficulty: 1, stem: "若 E(θ̂)=θ，则称 θ̂ 是 θ 的：", options: ["无偏估计", "有效估计", "相合估计", "一致估计"], answerIndex: 0, explanation: "无偏性指估计量的期望等于被估参数，即没有系统偏差；有效性比较的是方差大小，相合性讨论的是样本量趋于无穷时的收敛性。" },
  { id: "q-r34-2", kcId: "r34", difficulty: 2, stem: "两个无偏估计量中，更有效的是：", options: ["均值较大的那个", "样本量较大的那个", "方差较小的那个", "方差较大的那个"], answerIndex: 2, explanation: "在都无偏的前提下，方差越小估计值越集中，有效性越高；比较有效性必须在无偏这一共同前提下进行，否则方差小可能来自有偏估计。" },
  { id: "q-r34-3", kcId: "r34", difficulty: 3, stem: "估计量的相合性是指：", options: ["方差达到最小值", "对任何样本都等于参数真值", "样本量趋于无穷时依概率收敛于参数真值", "期望等于参数真值"], answerIndex: 2, explanation: "相合性描述大样本性质，要求 n→∞ 时估计量依概率收敛到真值；无偏性与最小方差都是有限样本下的性质，不能替代相合性。" },

  // ── r35 区间估计 ──
  { id: "q-r35-1", kcId: "r35", difficulty: 2, stem: "置信度为 0.95 的置信区间的含义是：", options: ["该区间包含 95% 的样本", "参数真值有 95% 的可能性等于区间中点", "反复抽样得到的区间中约 95% 包含参数真值", "参数落在该区间的概率为 0.95"], answerIndex: 2, explanation: "频率学派下参数是固定的，随机的是区间，置信度描述的是重复抽样时区间覆盖真值的比例；说参数落在某固定区间的概率为 0.95 在概念上不严谨。" },
  { id: "q-r35-2", kcId: "r35", difficulty: 3, stem: "枢轴量法的关键是构造一个量，它：", options: ["只依赖样本均值", "必须服从正态分布", "取值一定在置信区间内", "分布已知且不依赖未知参数"], answerIndex: 3, explanation: "枢轴量是样本与参数的函数，其分布完全已知且不含未知参数，由此可解出参数的区间；不要求它服从正态分布，也不要求只依赖均值。" },
  { id: "q-r35-3", kcId: "r35", difficulty: 4, stem: "在样本量不变的情况下，提高置信度会使置信区间：", options: ["不变", "先窄后宽", "变宽", "变窄"], answerIndex: 2, explanation: "提高置信度需要更大的临界值，区间随之变宽，精度下降；置信度与精度之间存在权衡，不能同时无限提高。" },

  // ── r36 正态总体的区间估计 ──
  { id: "q-r36-1", kcId: "r36", difficulty: 2, stem: "总体正态且 σ 已知时，均值 μ 的置信区间使用：", options: ["标准正态分位数 z", "t 分位数", "χ² 分位数", "F 分位数"], answerIndex: 0, explanation: "σ 已知时统计量 (X̄−μ)/(σ/√n) 服从标准正态，故用 z 分位数；只有 σ 未知需用 S 替代时才改用 t 分布。" },
  { id: "q-r36-2", kcId: "r36", difficulty: 3, stem: "总体正态但 σ 未知、样本量较小时，均值 μ 的置信区间应使用：", options: ["z 分位数", "χ²(n−1) 分位数", "F 分位数", "t(n−1) 分位数"], answerIndex: 3, explanation: "σ 未知时用样本标准差 S 替代，统计量服从 t(n−1)，小样本下 t 分布尾部更厚，区间比用 z 更宽；大样本时两者才近似一致。" },
  { id: "q-r36-3", kcId: "r36", difficulty: 4, stem: "正态总体方差的置信区间所依据的统计量是：", options: ["(X̄−μ)/(S/√n)~t(n−1)", "(X̄−μ)/(σ/√n)~N(0,1)", "S²/σ²~F(n−1,n−1)", "(n−1)S²/σ²~χ²(n−1)"], answerIndex: 3, explanation: "方差区间估计利用 (n−1)S²/σ² 服从卡方分布，从不等式解出 σ² 的范围；t 统计量用于均值，F 统计量用于两个方差之比。" },

  // ── r37 假设检验的基本原理 ──
  { id: "q-r37-1", kcId: "r37", difficulty: 1, stem: "假设检验中的原假设 H0 通常表示：", options: ["研究者希望证明的假设", "一定为假的假设", "备择假设的对立结论", "维持现状或没有差异的假设"], answerIndex: 3, explanation: "原假设通常取保守的、维持现状的陈述，检验是在 H0 成立的前提下考察样本是否出现小概率事件；研究者希望证明的往往是备择假设。" },
  { id: "q-r37-2", kcId: "r37", difficulty: 2, stem: "假设检验中的第一类错误是指：", options: ["H0 为假时拒绝 H0", "H0 为真时拒绝 H0", "H0 为假时接受 H0", "H0 为真时接受 H0"], answerIndex: 1, explanation: "第一类错误是「弃真」，即原假设本来成立却被拒绝，其概率记为 α；「存伪」即 H0 为假却未拒绝，属于第二类错误。" },
  { id: "q-r37-3", kcId: "r37", difficulty: 3, stem: "p 值的含义是：", options: ["H0 成立时出现当前或更极端样本结果的概率", "H0 为真的概率", "H1 为真的概率", "犯第二类错误的概率"], answerIndex: 0, explanation: "p 值是在原假设成立的前提下，样本统计量达到当前值或更极端值的概率，p<α 时拒绝 H0；它不是原假设为真的概率，这是最普遍的误读。" },

  // ── r38 正态总体均值的检验 ──
  { id: "q-r38-1", kcId: "r38", difficulty: 1, stem: "总体正态、σ 已知时，检验均值应使用：", options: ["F 检验", "U 检验（z 检验）", "t 检验", "χ² 检验"], answerIndex: 1, explanation: "σ 已知时构造的统计量服从标准正态，称为 U 检验或 z 检验；t 检验用于 σ 未知，卡方与 F 检验分别用于方差与方差比。" },
  { id: "q-r38-2", kcId: "r38", difficulty: 2, stem: "总体正态、σ 未知且样本量较小时，检验均值应使用：", options: ["F 检验", "t 检验", "U 检验", "χ² 检验"], answerIndex: 1, explanation: "σ 未知时用样本标准差替代，统计量服从 t(n−1)，故用 t 检验；此时若仍用 z 检验会低估尾部概率，使拒绝率偏离显著性水平。" },
  { id: "q-r38-3", kcId: "r38", difficulty: 3, stem: "对于右侧检验 H0:μ≤μ0，H1:μ>μ0，拒绝域应取：", options: ["两端各取 α/2 的区域", "整个样本空间", "统计量大于临界值的右侧区域", "统计量小于临界值的左侧区域"], answerIndex: 2, explanation: "备择假设指向 μ 偏大，样本均值显著大于 μ0 才支持 H1，因此拒绝域在右侧；两侧各取 α/2 对应的是双侧检验。" },

  // ── r39 正态总体方差的检验 ──
  { id: "q-r39-1", kcId: "r39", difficulty: 2, stem: "检验正态总体方差 σ² 是否等于某给定值，应使用：", options: ["χ² 检验", "U 检验", "t 检验", "F 检验"], answerIndex: 0, explanation: "方差检验基于 (n−1)S²/σ0² 服从 χ²(n−1)，通过与卡方分位数比较判断；U 与 t 检验针对均值，F 检验用于比较两个方差。" },
  { id: "q-r39-2", kcId: "r39", difficulty: 3, stem: "比较两个正态总体的方差是否相等，应使用：", options: ["U 检验", "F 检验", "t 检验", "χ² 检验"], answerIndex: 1, explanation: "两个样本方差之比在 H0 成立时服从 F(n1−1,n2−1)，故用 F 检验；t 检验比较均值，单样本卡方检验只处理一个方差。" },
  { id: "q-r39-3", kcId: "r39", difficulty: 4, stem: "对方差作双侧检验时，若显著性水平为 α，则两侧尾部面积应各取：", options: ["α/4", "α/2", "α", "1−α"], answerIndex: 1, explanation: "双侧检验把拒绝域放在卡方分布的两端，总显著性水平 α 需均分到两侧，各为 α/2；两侧都取 α 会使实际第一类错误概率加倍。" },

  // ── r40 拟合优度检验与两类错误 ──
  { id: "q-r40-1", kcId: "r40", difficulty: 2, stem: "χ² 拟合优度检验统计量衡量的是：", options: ["相关系数的平方", "实际频数与理论频数的相对偏差", "样本均值与总体均值的差", "两个样本方差之比"], answerIndex: 1, explanation: "拟合优度统计量为 Σ(观测频数−理论频数)²/理论频数，偏差越大统计量越大，越倾向拒绝理论分布；它与均值差、方差比都不是一回事。" },
  { id: "q-r40-2", kcId: "r40", difficulty: 3, stem: "检验的功效（power）是指：", options: ["H0 为真时接受 H0 的概率", "样本量除以显著性水平", "H0 为假时正确拒绝 H0 的概率", "H0 为真时拒绝 H0 的概率"], answerIndex: 2, explanation: "功效等于 1 减去第二类错误概率，即在备择假设成立时成功拒绝原假设的概率；H0 为真却拒绝属于第一类错误，不是功效。" },
  { id: "q-r40-3", kcId: "r40", difficulty: 4, stem: "在样本量固定的情况下，减小第一类错误概率 α 会：", options: ["使功效提高到 1", "增大第二类错误概率 β", "同时减小 β", "使 β 保持不变"], answerIndex: 1, explanation: "α 与 β 在样本量固定时此消彼长，降低显著性水平会使拒绝域变小，更不容易拒绝 H0，从而更容易犯存伪错误；要同时降低两者只能增大样本量。" },
];
