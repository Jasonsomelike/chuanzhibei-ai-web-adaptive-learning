/**
 * 线性代数知识图谱与题库：40 个知识点 / 60 条先修边 / 120 题。
 *
 * 课程依据：国内高校《线性代数》通用教学大纲（同济版体系）。
 * 每条边都是「不掌握前者，后者学不动」的真实依赖，不是按章节顺序硬连。
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";

export const linearAlgebraGraph: KnowledgeGraph = {
  version: "kg-linear-algebra-v1",
  concepts: [
    // ── 第 1 章 行列式 ──
    { id: "l01", name: "二阶与三阶行列式", chapter: "第1章 行列式", summary: "对角线法则与低阶行列式的直接计算" },
    { id: "l02", name: "n 阶行列式的定义", chapter: "第1章 行列式", summary: "全排列、逆序数与行列式的展开式定义" },
    { id: "l03", name: "行列式的性质", chapter: "第1章 行列式", summary: "转置、换行、倍乘与倍加对行列式的影响" },
    { id: "l04", name: "行列式按行展开", chapter: "第1章 行列式", summary: "余子式、代数余子式与展开定理" },
    { id: "l05", name: "克拉默法则", chapter: "第1章 行列式", summary: "用系数行列式判断并求解唯一解" },

    // ── 第 2 章 矩阵及其运算 ──
    { id: "l06", name: "矩阵的概念与特殊矩阵", chapter: "第2章 矩阵及其运算", summary: "零矩阵、单位矩阵、对角矩阵与三角矩阵" },
    { id: "l07", name: "矩阵的线性运算", chapter: "第2章 矩阵及其运算", summary: "矩阵加法与数乘的规则和运算律" },
    { id: "l08", name: "矩阵乘法", chapter: "第2章 矩阵及其运算", summary: "乘法定义、不满足交换律与零因子现象" },
    { id: "l09", name: "矩阵的转置与对称矩阵", chapter: "第2章 矩阵及其运算", summary: "转置运算律、对称矩阵与反对称矩阵" },
    { id: "l10", name: "方阵的行列式", chapter: "第2章 矩阵及其运算", summary: "乘积行列式、数乘行列式与逆矩阵行列式" },
    { id: "l11", name: "逆矩阵", chapter: "第2章 矩阵及其运算", summary: "可逆条件、伴随矩阵求逆与逆的运算律" },
    { id: "l12", name: "分块矩阵", chapter: "第2章 矩阵及其运算", summary: "分块运算、分块对角阵的行列式与逆" },

    // ── 第 3 章 矩阵的初等变换与线性方程组 ──
    { id: "l13", name: "初等变换与初等矩阵", chapter: "第3章 矩阵的初等变换与线性方程组", summary: "三类初等变换及初等矩阵与行变换的对应" },
    { id: "l14", name: "矩阵的秩", chapter: "第3章 矩阵的初等变换与线性方程组", summary: "最高阶非零子式、行阶梯形与秩的性质" },
    { id: "l15", name: "高斯消元法", chapter: "第3章 矩阵的初等变换与线性方程组", summary: "用初等行变换把增广矩阵化为行阶梯形" },
    { id: "l16", name: "齐次线性方程组的解", chapter: "第3章 矩阵的初等变换与线性方程组", summary: "非零解条件、基础解系与解空间维数" },
    { id: "l17", name: "非齐次线性方程组的解", chapter: "第3章 矩阵的初等变换与线性方程组", summary: "有解判定、特解与解的结构" },
    { id: "l18", name: "线性方程组的通解", chapter: "第3章 矩阵的初等变换与线性方程组", summary: "特解加齐次通解及通解的写法" },

    // ── 第 4 章 向量组的线性相关性 ──
    { id: "l19", name: "向量与向量组", chapter: "第4章 向量组的线性相关性", summary: "n 维向量、线性组合与向量组等价" },
    { id: "l20", name: "线性相关与线性无关", chapter: "第4章 向量组的线性相关性", summary: "线性相关的定义与基本判定事实" },
    { id: "l21", name: "线性相关性的判定", chapter: "第4章 向量组的线性相关性", summary: "用秩、行列式和部分组判定相关性" },
    { id: "l22", name: "极大线性无关组", chapter: "第4章 向量组的线性相关性", summary: "极大无关组的定义、存在性与求法" },
    { id: "l23", name: "向量组的秩", chapter: "第4章 向量组的线性相关性", summary: "向量组的秩与矩阵秩的关系" },
    { id: "l24", name: "向量空间", chapter: "第4章 向量组的线性相关性", summary: "对加法与数乘封闭的向量集合" },
    { id: "l25", name: "基、维数与坐标", chapter: "第4章 向量组的线性相关性", summary: "基的定义、维数与向量在基下的坐标" },

    // ── 第 5 章 特征值与相似矩阵 ──
    { id: "l26", name: "向量的内积与正交", chapter: "第5章 特征值与相似矩阵", summary: "内积、范数、夹角与正交向量组" },
    { id: "l27", name: "施密特正交化", chapter: "第5章 特征值与相似矩阵", summary: "由线性无关组构造规范正交基" },
    { id: "l28", name: "正交矩阵与正交变换", chapter: "第5章 特征值与相似矩阵", summary: "正交矩阵的性质与正交变换的不变量" },
    { id: "l29", name: "特征值与特征向量", chapter: "第5章 特征值与相似矩阵", summary: "定义、特征方程与具体求法" },
    { id: "l30", name: "特征值与特征向量的性质", chapter: "第5章 特征值与相似矩阵", summary: "迹与行列式的关系、不同特征值的特征向量" },
    { id: "l31", name: "相似矩阵与对角化", chapter: "第5章 特征值与相似矩阵", summary: "相似的定义、不变量与可对角化条件" },
    { id: "l32", name: "实对称矩阵的对角化", chapter: "第5章 特征值与相似矩阵", summary: "实对称矩阵必可正交相似对角化" },

    // ── 第 6 章 二次型 ──
    { id: "l33", name: "二次型及其矩阵表示", chapter: "第6章 二次型", summary: "二次型的对称矩阵表示与合同关系" },
    { id: "l34", name: "化二次型为标准形", chapter: "第6章 二次型", summary: "配方法与正交变换法化标准形" },
    { id: "l35", name: "惯性定理与规范形", chapter: "第6章 二次型", summary: "正负惯性指数的不变性与规范形" },
    { id: "l36", name: "正定二次型", chapter: "第6章 二次型", summary: "正定的定义、特征值判定与顺序主子式" },

    // ── 第 7 章 线性空间与线性变换 ──
    { id: "l37", name: "线性空间的定义", chapter: "第7章 线性空间与线性变换", summary: "线性空间的公理化定义与子空间" },
    { id: "l38", name: "线性变换", chapter: "第7章 线性空间与线性变换", summary: "线性变换的定义、核与像及维数定理" },
    { id: "l39", name: "线性变换的矩阵表示", chapter: "第7章 线性空间与线性变换", summary: "基下矩阵、过渡矩阵与相似关系" },
    { id: "l40", name: "线性代数的应用", chapter: "第7章 线性空间与线性变换", summary: "最小二乘、奇异值分解与低秩近似" },
  ],
  edges: [
    // 第 1 章
    { before: "l01", after: "l02" },
    { before: "l02", after: "l03" },
    { before: "l03", after: "l04" },
    { before: "l02", after: "l04" },
    { before: "l01", after: "l04" },
    { before: "l04", after: "l05" },

    // 第 2 章
    { before: "l06", after: "l07" },
    { before: "l07", after: "l08" },
    { before: "l08", after: "l09" },
    { before: "l08", after: "l10" },
    { before: "l03", after: "l10" },
    { before: "l10", after: "l11" },
    { before: "l08", after: "l11" },
    { before: "l11", after: "l12" },
    { before: "l08", after: "l12" },

    // 第 3 章
    { before: "l08", after: "l13" },
    { before: "l13", after: "l14" },
    { before: "l14", after: "l15" },
    { before: "l13", after: "l15" },
    { before: "l15", after: "l16" },
    { before: "l14", after: "l16" },
    { before: "l16", after: "l17" },
    { before: "l15", after: "l17" },
    { before: "l17", after: "l18" },

    // 第 4 章
    { before: "l19", after: "l20" },
    { before: "l20", after: "l21" },
    { before: "l14", after: "l21" },
    { before: "l21", after: "l22" },
    { before: "l22", after: "l23" },
    { before: "l14", after: "l23" },
    { before: "l19", after: "l24" },
    { before: "l24", after: "l25" },
    { before: "l22", after: "l25" },
    { before: "l23", after: "l25" },

    // 第 5 章
    { before: "l26", after: "l27" },
    { before: "l27", after: "l28" },
    { before: "l26", after: "l28" },
    { before: "l08", after: "l29" },
    { before: "l10", after: "l29" },
    { before: "l29", after: "l30" },
    { before: "l30", after: "l31" },
    { before: "l31", after: "l32" },
    { before: "l28", after: "l32" },
    { before: "l26", after: "l32" },
    { before: "l30", after: "l32" },

    // 第 6 章
    { before: "l33", after: "l34" },
    { before: "l32", after: "l34" },
    { before: "l33", after: "l35" },
    { before: "l34", after: "l35" },
    { before: "l35", after: "l36" },
    { before: "l34", after: "l36" },

    // 第 7 章
    { before: "l24", after: "l37" },
    { before: "l37", after: "l38" },
    { before: "l38", after: "l39" },
    { before: "l31", after: "l39" },
    { before: "l29", after: "l39" },
    { before: "l25", after: "l39" },
    { before: "l26", after: "l40" },
    { before: "l28", after: "l40" },
    { before: "l38", after: "l40" },
  ],
};

export const linearAlgebraQuestions: readonly Question[] = [
  // ── l01 二阶与三阶行列式 ──
  { id: "q-l01-1", kcId: "l01", difficulty: 1, stem: "二阶行列式 |2 1; 3 4| 的值是：", options: ["5", "8", "11", "−5"], answerIndex: 0, explanation: "二阶行列式按主对角线乘积减副对角线乘积计算：2×4−1×3=8−3=5；若误把两对角线相加会得到 11，属于符号规则记错。" },
  { id: "q-l01-2", kcId: "l01", difficulty: 2, stem: "三阶行列式 |1 2 3; 0 1 4; 5 6 0| 的值是：", options: ["1", "−1", "0", "5"], answerIndex: 0, explanation: "按第一行展开：1×(0−24)−2×(0−20)+3×(0−5)=−24+40−15=1；计算时容易漏掉第二项的负号或代数余子式符号，导致得到 −1。" },
  { id: "q-l01-3", kcId: "l01", difficulty: 3, stem: "关于对角线法则，下列说法正确的是：", options: ["只适用于二阶和三阶行列式", "适用于任意阶行列式", "只适用于上三角行列式", "只适用于元素全为正的行列式"], answerIndex: 0, explanation: "对角线法则只是二、三阶行列式的展开巧合，四阶及以上行列式共有 24 项以上，不能用几条对角线概括；上三角行列式虽可直接用对角线乘积，但那是由展开定理得到的性质。" },

  // ── l02 n 阶行列式的定义 ──
  { id: "q-l02-1", kcId: "l02", difficulty: 1, stem: "n 阶行列式按定义展开后共有多少项？", options: ["n", "n²", "n!", "2ⁿ"], answerIndex: 2, explanation: "行列式定义对 1 到 n 的全部排列求和，n 个元素的全排列共有 n! 个，因此展开式有 n! 项；n² 是元素个数，与展开项数不是一回事。" },
  { id: "q-l02-2", kcId: "l02", difficulty: 2, stem: "排列 321 的逆序数是：", options: ["1", "2", "3", "6"], answerIndex: 2, explanation: "逆序数统计前面比后面大的数对：3 大于 2 和 1 贡献 2 个，2 大于 1 贡献 1 个，共 3 个；逆序数为奇数，因此该排列对应的项取负号。" },
  { id: "q-l02-3", kcId: "l02", difficulty: 3, stem: "四阶行列式中，项 a13a21a32a44 前面的符号是：", options: ["正号", "负号", "零", "无法确定"], answerIndex: 0, explanation: "该项列指标排列为 3124，逆序数为 2（3 大于 1、2），是偶排列，所以取正号；判断符号只看列排列的逆序数奇偶性，与元素具体数值无关。" },

  // ── l03 行列式的性质 ──
  { id: "q-l03-1", kcId: "l03", difficulty: 1, stem: "交换行列式的两行，行列式的值：", options: ["不变", "变号", "变为原来的两倍", "变为零"], answerIndex: 1, explanation: "交换两行相当于对换排列中的两个指标，排列奇偶性改变，因此每一项都变号，行列式整体变号；这是行列式最基本的反对称性质。" },
  { id: "q-l03-2", kcId: "l03", difficulty: 2, stem: "将行列式某一行所有元素乘以 k，行列式的值：", options: ["乘以 k", "乘以 k²", "不变", "除以 k"], answerIndex: 0, explanation: "按该行展开时，每个代数余子式不变而元素都乘 k，因此行列式整体乘 k；注意 k 倍矩阵的行列式才是乘 kⁿ，两者不要混淆。" },
  { id: "q-l03-3", kcId: "l03", difficulty: 3, stem: "把行列式某一行元素的 k 倍加到另一行，行列式的值：", options: ["不变", "乘以 k", "变号", "变为零"], answerIndex: 0, explanation: "该操作相当于把行列式拆成原行列式与一个有两行成比例的行列式之和，后者为零，所以值不变；这一性质是消元法化简行列式的核心依据。" },

  // ── l04 行列式按行展开 ──
  { id: "q-l04-1", kcId: "l04", difficulty: 1, stem: "元素 aij 的代数余子式 Aij 与余子式 Mij 的关系是：", options: ["Aij = Mij", "Aij = (−1)^(i+j) Mij", "Aij = (−1)^i Mij", "Aij = −Mij"], answerIndex: 1, explanation: "代数余子式在余子式基础上乘以符号因子 (−1)^(i+j)，符号由元素所在行列位置决定，呈棋盘状交替；漏掉该符号是展开计算最常见的错误。" },
  { id: "q-l04-2", kcId: "l04", difficulty: 2, stem: "行列式按某一行展开的公式是：", options: ["该行元素与对应代数余子式乘积之和", "该行元素与对应余子式乘积之和", "该行元素之和乘以行列式", "任意一行元素与另一行代数余子式乘积之和"], answerIndex: 0, explanation: "展开定理要求元素与其自身位置的代数余子式配对求和，符号已包含在 Aij 中；若用余子式会漏掉符号，用另一行的代数余子式则结果为零。" },
  { id: "q-l04-3", kcId: "l04", difficulty: 3, stem: "行列式某一行元素与另一行对应元素的代数余子式乘积之和等于：", options: ["行列式的值", "0", "1", "该行元素之和"], answerIndex: 1, explanation: "这相当于把原行列式的另一行替换成该行后按另一行展开，此时行列式有两行相同，值为零；这一「异乘变零」性质常用于构造证明。" },

  // ── l05 克拉默法则 ──
  { id: "q-l05-1", kcId: "l05", difficulty: 1, stem: "克拉默法则适用的前提是：", options: ["方程个数等于未知数个数且系数行列式不为零", "方程个数大于未知数个数", "系数行列式等于零", "方程组一定是齐次的"], answerIndex: 0, explanation: "克拉默法则要求系数矩阵为方阵且行列式非零，此时方程组有唯一解 xj=Dj/D；若行列式为零，可能无解也可能无穷多解，法则失效。" },
  { id: "q-l05-2", kcId: "l05", difficulty: 2, stem: "若齐次线性方程组的系数行列式不为零，则方程组：", options: ["只有零解", "有无穷多解", "无解", "有两个不同解"], answerIndex: 0, explanation: "系数行列式非零时克拉默法则给出唯一解，而齐次方程组显然有零解，所以唯一解就是零解；只有系数行列式为零时才可能存在非零解。" },
  { id: "q-l05-3", kcId: "l05", difficulty: 3, stem: "方程组 x+y=3, x−y=1 的解是：", options: ["x=2, y=1", "x=1, y=2", "x=3, y=0", "x=0, y=3"], answerIndex: 0, explanation: "系数行列式 D=1×(−1)−1×1=−2，D1=(−4)，D2=(−2)，故 x=D1/D=2，y=D2/D=1；代入验证 2+1=3、2−1=1 均成立。" },

  // ── l06 矩阵的概念与特殊矩阵 ──
  { id: "q-l06-1", kcId: "l06", difficulty: 1, stem: "n 阶单位矩阵的特点是：", options: ["主对角线元素全为 1，其余元素全为 0", "所有元素全为 1", "主对角线元素全为 0", "上三角元素全为 0"], answerIndex: 0, explanation: "单位矩阵 E 的主对角线元素为 1、其余为 0，满足 EA=AE=A，是矩阵乘法的单位元；全 1 矩阵和对角线为 0 的矩阵都不具备这一性质。" },
  { id: "q-l06-2", kcId: "l06", difficulty: 2, stem: "两个同阶对角矩阵相乘，结果：", options: ["仍是对角矩阵，对角元为对应元素之积", "一定是零矩阵", "一般不是对角矩阵", "一定是单位矩阵"], answerIndex: 0, explanation: "对角矩阵只在主对角线有非零元，相乘时第 i 行第 j 列仅当 i=j 时可能非零，其值为两对角元之积，因此结果仍为对角矩阵。" },
  { id: "q-l06-3", kcId: "l06", difficulty: 3, stem: "若 n 阶方阵 A 满足 A²=O，则能否断定 A=O？", options: ["一定能", "不一定，例如 A=[0 1; 0 0]", "只有当 n=2 时才能", "只有当 A 对称时才能"], answerIndex: 1, explanation: "矩阵存在零因子，A=[0 1; 0 0] 的平方为零矩阵但自身非零；因此 A²=O 不能推出 A=O，这与实数中平方为零必为零有本质区别。" },

  // ── l07 矩阵的线性运算 ──
  { id: "q-l07-1", kcId: "l07", difficulty: 1, stem: "两个矩阵能够相加的条件是：", options: ["行数相同", "列数相同", "同型（行数和列数都相同）", "都是方阵"], answerIndex: 2, explanation: "矩阵加法按对应元素相加，要求两个矩阵行数、列数完全一致，即同型；仅行数或列数相同不足以逐元素对应，方阵也只是同型的一种特例。" },
  { id: "q-l07-2", kcId: "l07", difficulty: 2, stem: "设 A、B 为同型矩阵，k 为常数，下列等式正确的是：", options: ["(A+B)ᵀ=Aᵀ+Bᵀ", "(AB)ᵀ=AᵀBᵀ", "k(A+B)=kA+B", "(A+B)²=A²+2AB+B²"], answerIndex: 0, explanation: "转置对加法保持线性，故 (A+B)ᵀ=Aᵀ+Bᵀ；矩阵乘积转置要反序，数乘应作用于每一项，平方展开因乘法不交换而多出 BA 项。" },
  { id: "q-l07-3", kcId: "l07", difficulty: 3, stem: "设 A=[1 2; 3 4]，B=[0 1; 1 0]，则 2A−3B 等于：", options: ["[2 1; 3 8]", "[2 7; 9 8]", "[−2 1; 3 −8]", "[2 −1; 3 8]"], answerIndex: 0, explanation: "2A=[2 4; 6 8]，3B=[0 3; 3 0]，逐元素相减得 [2 1; 3 8]；若忘记数乘只作用于对应矩阵或符号处理错误，会得到其他选项。" },

  // ── l08 矩阵乘法 ──
  { id: "q-l08-1", kcId: "l08", difficulty: 1, stem: "矩阵乘积 AB 有意义的条件是：", options: ["A 的列数等于 B 的行数", "A 的行数等于 B 的列数", "A 与 B 同型", "A 与 B 都是方阵"], answerIndex: 0, explanation: "AB 的第 i 行第 j 列元素由 A 的第 i 行与 B 的第 j 列对应相乘求和，必须长度一致，因此要求 A 的列数等于 B 的行数；同型只是其中一种特例。" },
  { id: "q-l08-2", kcId: "l08", difficulty: 2, stem: "矩阵乘法一般不满足：", options: ["结合律", "分配律", "交换律", "与数乘的结合律"], answerIndex: 2, explanation: "一般情况下 AB≠BA，甚至 AB 有意义而 BA 无意义，因此乘法不满足交换律；结合律、分配律以及与数乘的结合律在维度相容时都成立。" },
  { id: "q-l08-3", kcId: "l08", difficulty: 3, stem: "若 AB=O，则下列结论正确的是：", options: ["A=O 或 B=O", "A 与 B 至少有一个不可逆", "A 与 B 都可逆", "A 与 B 都为零矩阵"], answerIndex: 1, explanation: "若 A、B 都可逆，两边左乘 A⁻¹、右乘 B⁻¹ 会得到 O=E，矛盾，故至少一个不可逆；但 A、B 都可以非零，例如 A=[1 0; 0 0]、B=[0 0; 1 0]。" },

  // ── l09 矩阵的转置与对称矩阵 ──
  { id: "q-l09-1", kcId: "l09", difficulty: 1, stem: "矩阵乘积的转置满足：", options: ["(AB)ᵀ=AᵀBᵀ", "(AB)ᵀ=BᵀAᵀ", "(AB)ᵀ=AB", "(AB)ᵀ=A⁻¹B⁻¹"], answerIndex: 1, explanation: "转置乘积要按相反顺序相乘，即 (AB)ᵀ=BᵀAᵀ；若顺序不变，在非交换情形下一般不相等，这是转置运算最需要注意的规则。" },
  { id: "q-l09-2", kcId: "l09", difficulty: 2, stem: "对称矩阵的定义是：", options: ["Aᵀ=A", "Aᵀ=−A", "A²=A", "AᵀA=E"], answerIndex: 0, explanation: "对称矩阵满足转置等于自身，即 aij=aji；Aᵀ=−A 是反对称矩阵，A²=A 是幂等矩阵，AᵀA=E 是正交矩阵的条件。" },
  { id: "q-l09-3", kcId: "l09", difficulty: 3, stem: "反对称矩阵的主对角线元素：", options: ["全为 1", "全为 0", "可以任意取值", "全为 −1"], answerIndex: 1, explanation: "反对称矩阵满足 aij=−aji，取 i=j 得 aii=−aii，故 aii=0；因此主对角线必须全为零，否则会推出元素等于其相反数。" },

  // ── l10 方阵的行列式 ──
  { id: "q-l10-1", kcId: "l10", difficulty: 1, stem: "设 A、B 为同阶方阵，则 |AB| 等于：", options: ["|A|+|B|", "|A||B|", "|A|−|B|", "|A|/|B|"], answerIndex: 1, explanation: "方阵乘积的行列式等于行列式之积，即 |AB|=|A||B|；加法与行列式没有这种分配关系，|A+B| 一般既不等于 |A|+|B| 也不等于 |AB|。" },
  { id: "q-l10-2", kcId: "l10", difficulty: 2, stem: "设 A 为 3 阶方阵且 |A|=2，则 |2A| 等于：", options: ["4", "8", "16", "2"], answerIndex: 2, explanation: "数乘矩阵时每个元素都乘 2，按行列式性质每行提出一个 2，3 阶共提出 2³=8，故 |2A|=8×2=16；直接写成 2|A| 是常见错误。" },
  { id: "q-l10-3", kcId: "l10", difficulty: 3, stem: "设 A 可逆且 |A|=3，则 |A⁻¹| 等于：", options: ["3", "1/3", "−3", "9"], answerIndex: 1, explanation: "由 AA⁻¹=E 得 |A||A⁻¹|=|E|=1，所以 |A⁻¹|=1/|A|=1/3；逆矩阵的行列式是原行列式的倒数，而不是相反数。" },

  // ── l11 逆矩阵 ──
  { id: "q-l11-1", kcId: "l11", difficulty: 1, stem: "n 阶方阵 A 可逆的充要条件是：", options: ["|A|≠0", "|A|=0", "A 是对称矩阵", "A 的主对角线元素非零"], answerIndex: 0, explanation: "A 可逆当且仅当存在 B 使 AB=E，由 |AB|=|A||B|=1 可知 |A|≠0；主对角线非零不足以保证行列式非零，对称也不是可逆的必要条件。" },
  { id: "q-l11-2", kcId: "l11", difficulty: 2, stem: "设 A、B 均可逆，则 (AB)⁻¹ 等于：", options: ["A⁻¹B⁻¹", "B⁻¹A⁻¹", "AB", "B A"], answerIndex: 1, explanation: "因为 (AB)(B⁻¹A⁻¹)=A(BB⁻¹)A⁻¹=E，所以逆矩阵要按相反顺序相乘；若写成 A⁻¹B⁻¹，一般不能与 AB 相乘得单位矩阵。" },
  { id: "q-l11-3", kcId: "l11", difficulty: 3, stem: "设 A 可逆，则 (Aᵀ)⁻¹ 等于：", options: ["A⁻¹ᵀ", "Aᵀ", "A", "−A⁻¹"], answerIndex: 0, explanation: "对 AA⁻¹=E 两边转置得 (A⁻¹)ᵀAᵀ=E，因此 (Aᵀ)⁻¹=(A⁻¹)ᵀ；即求逆与转置可以交换顺序，这是伴随矩阵运算中的常用结论。" },

  // ── l12 分块矩阵 ──
  { id: "q-l12-1", kcId: "l12", difficulty: 1, stem: "分块对角矩阵 diag(A1,A2) 可逆的条件是：", options: ["A1、A2 都可逆", "A1 可逆即可", "A1、A2 行列式都为零", "分块矩阵一定是方阵即可"], answerIndex: 0, explanation: "分块对角矩阵的行列式等于各对角块行列式之积，因此整体可逆当且仅当每个对角块都可逆；只要求 A1 可逆无法保证 A2 对应的部分可逆。" },
  { id: "q-l12-2", kcId: "l12", difficulty: 2, stem: "分块矩阵相乘时，要求：", options: ["两个矩阵的分块方式完全相容", "分块数量必须相同", "每块都必须是方阵", "每块都必须是单位矩阵"], answerIndex: 0, explanation: "分块乘法要求左矩阵列的划分与右矩阵行的划分一致，使各子块乘积有意义；分块数量相同但尺寸不匹配仍不能相乘，各块也无需是方阵。" },
  { id: "q-l12-3", kcId: "l12", difficulty: 3, stem: "分块对角矩阵 diag(A1,A2) 的行列式等于：", options: ["|A1|+|A2|", "|A1||A2|", "|A1|−|A2|", "|A1+A2|"], answerIndex: 1, explanation: "分块对角矩阵可通过块消元化为对角形式，其行列式等于各对角块行列式之积；这与普通对角矩阵行列式等于对角元乘积的道理一致。" },

  // ── l13 初等变换与初等矩阵 ──
  { id: "q-l13-1", kcId: "l13", difficulty: 1, stem: "矩阵的初等行变换不包括：", options: ["交换两行", "某行乘以非零常数", "某行的倍数加到另一行", "删除一行"], answerIndex: 3, explanation: "三类初等变换是换行、倍乘（倍数非零）和倍加，它们都保持矩阵的秩和行空间；删除一行会改变矩阵的行数和秩，不属于初等变换。" },
  { id: "q-l13-2", kcId: "l13", difficulty: 2, stem: "初等矩阵是：", options: ["单位矩阵经过一次初等变换得到的矩阵", "元素全为 1 的矩阵", "行列式为零的矩阵", "任意一个方阵"], answerIndex: 0, explanation: "初等矩阵由单位矩阵实施一次初等变换得到，因此可逆且逆矩阵仍是同类型初等矩阵；全 1 矩阵和零行列式矩阵一般不满足这一构造。" },
  { id: "q-l13-3", kcId: "l13", difficulty: 3, stem: "用初等矩阵 E 左乘矩阵 A，其效果是：", options: ["对 A 做与 E 对应的初等行变换", "对 A 做与 E 对应的初等列变换", "不改变 A", "把 A 变成单位矩阵"], answerIndex: 0, explanation: "左乘初等矩阵对应行变换，右乘才对应列变换，这是初等矩阵与初等变换之间的基本对应关系；记住「左行右列」可避免方向混淆。" },

  // ── l14 矩阵的秩 ──
  { id: "q-l14-1", kcId: "l14", difficulty: 1, stem: "矩阵 A 的秩 r(A) 的定义是：", options: ["A 中非零元素的个数", "A 中最高阶非零子式的阶数", "A 的行数", "A 中零元素的个数"], answerIndex: 1, explanation: "秩是最高阶非零子式的阶数，反映矩阵行（列）向量组的最大无关个数；它不等于非零元素个数，也不等于行数，零矩阵的秩为 0。" },
  { id: "q-l14-2", kcId: "l14", difficulty: 2, stem: "对矩阵施行初等变换后，矩阵的秩：", options: ["保持不变", "一定增大", "一定减小", "可能变为零"], answerIndex: 0, explanation: "初等变换对应乘以可逆的初等矩阵，可逆矩阵不改变矩阵的秩，因此秩保持不变；这正是可以用行阶梯形非零行数求秩的依据。" },
  { id: "q-l14-3", kcId: "l14", difficulty: 3, stem: "设 A 为 m×n 矩阵，B 为 n×s 矩阵，则 r(AB) 满足：", options: ["r(AB)=r(A)+r(B)", "r(AB)≤min{r(A),r(B)}", "r(AB)≥r(A)", "r(AB)=r(A)r(B)"], answerIndex: 1, explanation: "乘积的列空间包含在 A 的列空间中，行空间包含在 B 的行空间中，因此秩不会超过任一因子矩阵的秩；此外还有 r(AB)≥r(A)+r(B)−n 的下界。" },

  // ── l15 高斯消元法 ──
  { id: "q-l15-1", kcId: "l15", difficulty: 1, stem: "高斯消元法主要通过什么操作化简方程组？", options: ["初等行变换", "初等列变换", "求逆矩阵", "计算特征值"], answerIndex: 0, explanation: "高斯消元对增广矩阵实施初等行变换，化为行阶梯形后回代求解；列变换会改变未知量的对应关系，不能随意用于解方程组。" },
  { id: "q-l15-2", kcId: "l15", difficulty: 2, stem: "把增广矩阵化为行阶梯形后，非零行的行数等于：", options: ["未知数个数", "系数矩阵的秩", "方程组的解的个数", "矩阵的列数"], answerIndex: 1, explanation: "行阶梯形中非零行的个数就是矩阵的秩，对增广矩阵而言还需分别比较系数矩阵与增广矩阵的秩来判断解的情况；它不等于未知数个数或解的个数。" },
  { id: "q-l15-3", kcId: "l15", difficulty: 3, stem: "对于 n 元线性方程组，若 r(A)=r(A|b)=r<n，则方程组：", options: ["有唯一解", "有无穷多解", "无解", "只有零解"], answerIndex: 1, explanation: "系数矩阵与增广矩阵秩相等保证有解，秩 r 小于未知数个数 n 说明有 n−r 个自由未知量，因此有无穷多解；r=n 时才是唯一解。" },

  // ── l16 齐次线性方程组的解 ──
  { id: "q-l16-1", kcId: "l16", difficulty: 1, stem: "齐次线性方程组 Ax=0：", options: ["一定有零解", "一定没有解", "一定有非零解", "只有零解"], answerIndex: 0, explanation: "把 x=0 代入恒有 A0=0，所以齐次方程组至少存在零解；是否有非零解取决于系数矩阵的秩是否小于未知数个数，不能一概而论。" },
  { id: "q-l16-2", kcId: "l16", difficulty: 2, stem: "n 元齐次线性方程组有非零解的充要条件是：", options: ["r(A)<n", "r(A)=n", "r(A)>n", "|A|≠0"], answerIndex: 0, explanation: "自由未知量个数为 n−r(A)，只有 n−r(A)>0 即 r(A)<n 时才存在非零解；r(A)=n 或方阵行列式非零时只有零解。" },
  { id: "q-l16-3", kcId: "l16", difficulty: 3, stem: "若 n 元齐次方程组系数矩阵的秩为 r，则其基础解系含有的向量个数是：", options: ["r", "n−r", "n", "n+r"], answerIndex: 1, explanation: "解空间维数等于未知数个数减去系数矩阵的秩，即 n−r，基础解系正是解空间的一组基，因此含 n−r 个线性无关的解向量。" },

  // ── l17 非齐次线性方程组的解 ──
  { id: "q-l17-1", kcId: "l17", difficulty: 1, stem: "非齐次线性方程组 Ax=b 有解的充要条件是：", options: ["r(A)=r(A|b)", "r(A)<r(A|b)", "|A|≠0", "b=0"], answerIndex: 0, explanation: "增广矩阵的秩等于系数矩阵的秩，说明 b 可由 A 的列向量线性表示，方程组才有解；若 r(A)<r(A|b)，则出现矛盾方程，无解。" },
  { id: "q-l17-2", kcId: "l17", difficulty: 2, stem: "非齐次线性方程组的通解结构是：", options: ["特解 + 对应齐次方程组的通解", "只有特解", "齐次通解乘以 2", "任意两个特解之和"], answerIndex: 0, explanation: "若 η* 是 Ax=b 的一个特解，ξ 是 Ax=0 的任意解，则 η*+ξ 仍是 Ax=b 的解，且所有解都可这样表示；因此通解等于特解加齐次通解。" },
  { id: "q-l17-3", kcId: "l17", difficulty: 3, stem: "若 η1、η2 都是 Ax=b 的解，则 η1−η2 是：", options: ["Ax=b 的解", "Ax=0 的解", "无意义的向量", "A 的特征向量"], answerIndex: 1, explanation: "A(η1−η2)=Aη1−Aη2=b−b=0，所以差向量满足齐次方程；这说明非齐次方程任意两解之差都是对应齐次方程的解。" },

  // ── l18 线性方程组的通解 ──
  { id: "q-l18-1", kcId: "l18", difficulty: 1, stem: "写出非齐次方程组通解时，自由未知量通常取：", options: ["基础解系中的任意常数", "只能取 0", "只能取 1", "必须取正整数"], answerIndex: 0, explanation: "自由未知量对应齐次通解中的任意常数，取遍实数可得到全部解；固定为 0 或 1 只能得到个别解，无法表示无穷多解的整体。" },
  { id: "q-l18-2", kcId: "l18", difficulty: 2, stem: "设 Ax=b 的通解为 x=η*+k1ξ1+k2ξ2，其中 ξ1、ξ2 是基础解系，则 k1、k2 应满足：", options: ["任意实数", "k1=k2", "k1+k2=1", "都大于零"], answerIndex: 0, explanation: "齐次通解中的组合系数是任意常数，取遍所有实数才能覆盖解空间的全部方向；对系数加相等或正负限制会漏掉大量解。" },
  { id: "q-l18-3", kcId: "l18", difficulty: 3, stem: "若 η1、η2 是 Ax=b 的两个不同解，则 (η1+η2)/2：", options: ["一定是 Ax=b 的解", "一定不是解", "是 Ax=0 的解", "只有当 b=0 时才是解"], answerIndex: 0, explanation: "A((η1+η2)/2)=(Aη1+Aη2)/2=(b+b)/2=b，因此它仍是 Ax=b 的解；这说明非齐次方程的解集对中点运算封闭，但不是线性空间。" },

  // ── l19 向量与向量组 ──
  { id: "q-l19-1", kcId: "l19", difficulty: 2, stem: "向量 β 能由向量组 α1,α2,…,αs 线性表示，意味着：", options: ["存在一组数 k1,…,ks 使 β=k1α1+…+ksαs", "β 与每个 αi 都正交", "β 是零向量", "向量组线性无关"], answerIndex: 0, explanation: "线性表示就是寻找一组组合系数，把 β 写成向量组的线性组合；这与正交、零向量和向量组本身是否无关都没有必然联系。" },
  { id: "q-l19-2", kcId: "l19", difficulty: 3, stem: "两个向量组等价是指：", options: ["它们所含向量个数相同", "它们可以相互线性表示", "它们的秩都为零", "它们含有相同的向量"], answerIndex: 1, explanation: "向量组等价要求任一组的每个向量都能由另一组线性表示，等价组必有相同的秩和相同的张成空间；向量个数和具体元素都不必相同。" },
  { id: "q-l19-3", kcId: "l19", difficulty: 4, stem: "若向量组 B 可由向量组 A 线性表示，则：", options: ["r(B)≤r(A)", "r(B)≥r(A)", "r(B)=r(A)", "r(B)=r(A)+1"], answerIndex: 0, explanation: "B 的张成空间包含在 A 的张成空间中，其极大无关组所含向量数不会超过 A 的秩；只有相互表示（等价）时秩才相等。" },

  // ── l20 线性相关与线性无关 ──
  { id: "q-l20-1", kcId: "l20", difficulty: 2, stem: "含有零向量的向量组一定：", options: ["线性相关", "线性无关", "秩等于向量个数", "是空集"], answerIndex: 0, explanation: "取零向量的系数为 1、其余系数为 0，可得到非平凡线性组合等于零，因此向量组线性相关；零向量无法成为任何极大无关组的成员。" },
  { id: "q-l20-2", kcId: "l20", difficulty: 3, stem: "两个向量 α、β 线性相关当且仅当：", options: ["它们正交", "它们对应分量成比例（或其中有零向量）", "它们的模相等", "它们的和为 0"], answerIndex: 1, explanation: "两个向量相关意味着存在不全为零的系数使 kα+lβ=0，即一个向量是另一个的数量倍，分量成比例；正交、等长或和为零都不是相关的充要条件。" },
  { id: "q-l20-3", kcId: "l20", difficulty: 4, stem: "在 n 维向量空间中，任意 n+1 个向量：", options: ["一定线性无关", "一定线性相关", "可能线性无关", "秩一定为 n+1"], answerIndex: 1, explanation: "n 维空间中任一向量组的秩不超过 n，而 n+1 个向量的秩最多为 n，小于向量个数，因此必线性相关；这是维数对相关性的硬约束。" },

  // ── l21 线性相关性的判定 ──
  { id: "q-l21-1", kcId: "l21", difficulty: 2, stem: "n 个 n 维向量线性相关的充要条件是：", options: ["它们构成的行列式为零", "它们构成的行列式不为零", "它们的和为零向量", "它们两两正交"], answerIndex: 0, explanation: "n 个 n 维向量组成方阵，线性相关等价于该方阵不可逆，也等价于行列式为零；行列式非零时它们线性无关，和为零或两两正交都不是判据。" },
  { id: "q-l21-2", kcId: "l21", difficulty: 3, stem: "若向量组 α1,…,αs 线性无关，则它的任意部分组：", options: ["一定线性无关", "一定线性相关", "可能相关", "秩为零"], answerIndex: 0, explanation: "整体无关意味着不存在非平凡组合使结果为零，部分组若相关则可把其余向量系数取零，得到整体的非平凡零组合，矛盾；因此部分组必无关。" },
  { id: "q-l21-3", kcId: "l21", difficulty: 4, stem: "向量组 α1,…,αs 线性相关等价于：", options: ["r(α1,…,αs)<s", "r(α1,…,αs)=s", "s=0", "每个向量都是零向量"], answerIndex: 0, explanation: "向量组的秩是其极大无关组所含向量个数，秩小于向量总数说明存在多余向量可被其余向量表示，即线性相关；秩等于 s 时才是线性无关。" },

  // ── l22 极大线性无关组 ──
  { id: "q-l22-1", kcId: "l22", difficulty: 2, stem: "向量组的极大线性无关组是指：", options: ["向量个数最多的线性无关部分组", "任意一个线性无关部分组", "包含全部向量的部分组", "秩为零的部分组"], answerIndex: 0, explanation: "极大无关组首先线性无关，并且再添加原组中任一向量都会变得相关，因此它是向量个数最多的无关部分组；普通无关部分组不一定极大。" },
  { id: "q-l22-2", kcId: "l22", difficulty: 3, stem: "同一向量组的两个不同极大无关组：", options: ["所含向量个数相同", "所含向量完全相同", "秩不同", "一定线性相关"], answerIndex: 0, explanation: "极大无关组所含向量个数等于向量组的秩，而秩由向量组唯一确定，因此不同极大无关组虽然成员可能不同，但个数一定相同。" },
  { id: "q-l22-3", kcId: "l22", difficulty: 4, stem: "向量组中任一向量都可以由它的极大无关组：", options: ["线性表示", "正交表示", "唯一地表示为单位向量", "通过转置得到"], answerIndex: 0, explanation: "极大无关组若不能表示某个向量，则加入该向量后仍无关，与极大性矛盾；因此组内每个向量都可由极大无关组线性表示，表示系数不一定唯一。" },

  // ── l23 向量组的秩 ──
  { id: "q-l23-1", kcId: "l23", difficulty: 2, stem: "向量组的秩等于：", options: ["向量组中向量的个数", "极大线性无关组所含向量的个数", "零向量的个数", "向量维数"], answerIndex: 1, explanation: "秩刻画向量组线性无关的最大规模，定义为极大无关组所含向量个数；它不超过向量个数，也不等于向量维数，零向量个数与秩无关。" },
  { id: "q-l23-2", kcId: "l23", difficulty: 3, stem: "矩阵的秩与其行向量组的秩、列向量组的秩的关系是：", options: ["三者相等", "行秩大于列秩", "列秩大于行秩", "三者没有关系"], answerIndex: 0, explanation: "矩阵的行秩等于列秩，并且都等于矩阵的秩，这是线性代数的重要定理；正因如此才能用初等行变换求列向量组的秩。" },
  { id: "q-l23-3", kcId: "l23", difficulty: 4, stem: "若向量组 (I) 可由向量组 (II) 线性表示，则：", options: ["r(I)≤r(II)", "r(I)≥r(II)", "r(I)=r(II)", "r(I)+r(II)=0"], answerIndex: 0, explanation: "(I) 的极大无关组可由 (II) 表示，而能被表示的无关组所含向量数不超过表示组的秩，因此 r(I)≤r(II)；等号只在两组等价时成立。" },

  // ── l24 向量空间 ──
  { id: "q-l24-1", kcId: "l24", difficulty: 2, stem: "向量空间对运算的封闭性要求是：", options: ["对加法和数乘都封闭", "只对加法封闭", "只对数乘封闭", "不需要封闭"], answerIndex: 0, explanation: "向量空间（线性空间）必须对向量加法和数乘两种运算封闭，即任意两个向量之和、任意数与向量的乘积仍属于该集合；只满足一种不足以构成空间。" },
  { id: "q-l24-2", kcId: "l24", difficulty: 3, stem: "判断 n 维向量集合 V 是否为子空间，通常需要验证：", options: ["非空且对加法、数乘封闭", "只验证含有零向量", "只验证对加法封闭", "验证元素个数有限"], answerIndex: 0, explanation: "子空间需继承原空间的运算并自身构成线性空间，关键是非空且对加法和数乘封闭；含零向量只是非空的一个表现，单独验证不够。" },
  { id: "q-l24-3", kcId: "l24", difficulty: 4, stem: "齐次线性方程组 Ax=0 的全部解构成：", options: ["一个向量空间（解空间）", "一个仿射空间", "空集", "一个线性无关组"], answerIndex: 0, explanation: "若 x、y 是解，则 A(x+y)=0、A(kx)=0，解集非空且对加法与数乘封闭，因此构成向量空间，称为解空间，其维数为 n−r(A)。" },

  // ── l25 基、维数与坐标 ──
  { id: "q-l25-1", kcId: "l25", difficulty: 2, stem: "向量空间 V 的一组基应满足：", options: ["线性无关且能线性表示 V 中所有向量", "只要求线性无关", "只要求能表示所有向量", "必须是单位向量"], answerIndex: 0, explanation: "基是 V 的极大无关组，既要线性无关（没有冗余），又要能张成整个空间（没有遗漏）；缺少任一条件都不能称为基，单位向量也不是必需的。" },
  { id: "q-l25-2", kcId: "l25", difficulty: 3, stem: "向量空间的维数等于：", options: ["空间中向量的总数", "任一组基所含向量的个数", "向量的分量个数", "零向量的个数"], answerIndex: 1, explanation: "维数定义为基所含向量的个数，基的选择可能不同但个数唯一；它不等于空间中向量的总数（通常无穷多），也不等于向量的分量个数。" },
  { id: "q-l25-3", kcId: "l25", difficulty: 4, stem: "向量 α 在一组基下的坐标：", options: ["是唯一的", "可能不唯一", "一定全为零", "与基的选择无关"], answerIndex: 0, explanation: "若 α 有两种坐标表示，相减得到基向量的非平凡零组合，与基线性无关矛盾，故坐标唯一；但换一组基后坐标会改变，坐标是相对于基而言的。" },

  // ── l26 向量的内积与正交 ──
  { id: "q-l26-1", kcId: "l26", difficulty: 2, stem: "两个向量 α、β 正交的充要条件是：", options: ["它们的内积为零", "它们的范数相等", "它们的和为零向量", "它们的分量都为零"], answerIndex: 0, explanation: "正交定义为内积 (α,β)=0，几何上对应夹角为 90 度；范数相等、和为零或分量全零都不是正交的等价条件，零向量与任何向量都正交。" },
  { id: "q-l26-2", kcId: "l26", difficulty: 3, stem: "若 α 与 β 正交，则 ||α+β||² 等于：", options: ["||α||²+||β||²", "||α||²−||β||²", "(||α||+||β||)²", "0"], answerIndex: 0, explanation: "展开得 ||α+β||²=||α||²+2(α,β)+||β||²，正交时内积项为零，于是等于两范数平方之和，这就是勾股定理在欧氏空间中的形式。" },
  { id: "q-l26-3", kcId: "l26", difficulty: 4, stem: "非零正交向量组 α1,…,αs 一定是：", options: ["线性无关的", "线性相关的", "单位向量组", "秩为零的"], answerIndex: 0, explanation: "设 k1α1+…+ksαs=0，与 αi 作内积得 ki(αi,αi)=0，因 αi 非零故 ki=0，所有系数为零，所以向量组线性无关；正交组不要求是单位向量。" },

  // ── l27 施密特正交化 ──
  { id: "q-l27-1", kcId: "l27", difficulty: 2, stem: "施密特正交化的作用是：", options: ["由线性无关组构造等价的正交向量组", "把矩阵化为行阶梯形", "求矩阵的特征值", "判断方程组是否有解"], answerIndex: 0, explanation: "施密特方法逐次减去向量在已有正交向量上的投影，得到与原组等价的正交组，再单位化即得规范正交基；它不用于消元或求特征值。" },
  { id: "q-l27-2", kcId: "l27", difficulty: 3, stem: "施密特正交化中，β2 的计算公式是：", options: ["α2 − (α2,β1)/(β1,β1) · β1", "α2 + β1", "α2 × β1", "(α2,β1)β1"], answerIndex: 0, explanation: "β2 由 α2 减去其在 β1 方向上的投影得到，投影系数为 (α2,β1)/(β1,β1)，这样 β2 与 β1 的内积为零；直接加减或数乘 β1 不能保证正交。" },
  { id: "q-l27-3", kcId: "l27", difficulty: 4, stem: "施密特正交化前后，向量组张成的空间：", options: ["保持不变", "扩大为整个空间", "缩小为零空间", "维数减一"], answerIndex: 0, explanation: "每一步都是对原向量做可逆的线性组合，新旧向量组可以相互表示，因此张成空间完全相同，只是把原来的基换成了正交基。" },

  // ── l28 正交矩阵与正交变换 ──
  { id: "q-l28-1", kcId: "l28", difficulty: 2, stem: "n 阶矩阵 A 为正交矩阵的充要条件是：", options: ["AᵀA=E", "A²=E", "A=Aᵀ", "|A|=1"], answerIndex: 0, explanation: "正交矩阵的列向量构成规范正交基，等价于 AᵀA=E，也等价于 A⁻¹=Aᵀ；A²=E 或对称都不一定成立，行列式只能是 ±1 而非必为 1。" },
  { id: "q-l28-2", kcId: "l28", difficulty: 3, stem: "正交矩阵的行列式等于：", options: ["1 或 −1", "只能是 1", "只能是 0", "任意实数"], answerIndex: 0, explanation: "由 AᵀA=E 取行列式得 |A|²=1，所以 |A|=±1；行列式为 1 对应旋转，为 −1 对应含反射的变换，但不能取其他值。" },
  { id: "q-l28-3", kcId: "l28", difficulty: 4, stem: "正交变换保持不变的量是：", options: ["向量的内积和长度", "向量的坐标", "矩阵的秩", "向量的分量符号"], answerIndex: 0, explanation: "正交变换 y=Qx 满足 (Qx,Qy)=(x,y)，从而长度、夹角和距离都不变，这正是刚体变换的特征；坐标和分量会改变，矩阵的秩也不是向量的属性。" },

  // ── l29 特征值与特征向量 ──
  { id: "q-l29-1", kcId: "l29", difficulty: 2, stem: "λ 是方阵 A 的特征值，是指存在非零向量 x 使：", options: ["Ax=λx", "Ax=0", "A+λx=0", "x=λA"], answerIndex: 0, explanation: "特征值 λ 使 A 作用在特征向量 x 上只改变长度不改变方向，即 Ax=λx；这里 x 必须非零，否则任何 λ 都满足，失去意义。" },
  { id: "q-l29-2", kcId: "l29", difficulty: 3, stem: "矩阵 A=[2 0; 0 3] 的特征值是：", options: ["2 和 3", "0 和 5", "2 和 −3", "1 和 6"], answerIndex: 0, explanation: "对角矩阵的特征值就是主对角线元素，因为 A e1=2e1、A e2=3e2；也可由特征方程 (2−λ)(3−λ)=0 得到，特征值之和为迹 5。" },
  { id: "q-l29-3", kcId: "l29", difficulty: 4, stem: "上三角矩阵 A=[1 1; 0 2] 的特征值是：", options: ["1 和 2", "1 和 1", "2 和 2", "0 和 3"], answerIndex: 0, explanation: "三角矩阵的特征多项式为 (1−λ)(2−λ)，因此特征值为对角线元素 1 和 2；非对角元素 1 只影响特征向量，不改变特征值。" },

  // ── l30 特征值与特征向量的性质 ──
  { id: "q-l30-1", kcId: "l30", difficulty: 2, stem: "n 阶方阵 A 的所有特征值之和等于：", options: ["A 的迹（主对角线元素之和）", "A 的行列式", "A 的秩", "A 的元素总和"], answerIndex: 0, explanation: "特征多项式展开后 λ^(n−1) 的系数等于迹的相反数，由韦达定理知特征值之和等于迹；特征值之积才等于行列式，二者不要混淆。" },
  { id: "q-l30-2", kcId: "l30", difficulty: 3, stem: "n 阶方阵 A 的所有特征值之积等于：", options: ["|A|", "tr(A)", "r(A)", "n"], answerIndex: 0, explanation: "在特征多项式中令 λ=0，得到常数项为 |A|，而常数项又等于 (−1)^n 乘以特征值之积，整理后可知特征值之积等于行列式。" },
  { id: "q-l30-3", kcId: "l30", difficulty: 4, stem: "属于不同特征值的特征向量：", options: ["线性无关", "一定正交", "一定成比例", "可能线性相关"], answerIndex: 0, explanation: "不同特征值对应的特征向量必线性无关，否则可推出同一非零向量对应两个不同特征值的矛盾；但它们不一定正交，正交性需要实对称矩阵等额外条件。" },

  // ── l31 相似矩阵与对角化 ──
  { id: "q-l31-1", kcId: "l31", difficulty: 2, stem: "矩阵 A 与 B 相似的定义是：", options: ["存在可逆矩阵 P 使 B=P⁻¹AP", "A 与 B 相等", "A 与 B 的秩相同", "A 与 B 的行列式相同"], answerIndex: 0, explanation: "相似是通过可逆矩阵作基变换得到的同一线性变换的不同表示，定义要求 B=P⁻¹AP；秩或行列式相同只是相似的必要条件，不能保证相似。" },
  { id: "q-l31-2", kcId: "l31", difficulty: 3, stem: "相似矩阵不一定相同的量是：", options: ["特征向量", "特征值", "行列式", "迹"], answerIndex: 0, explanation: "相似矩阵具有相同的特征多项式、特征值、行列式、迹和秩，但特征向量会随基变换而改变；因此不能用特征向量是否相同判断相似。" },
  { id: "q-l31-3", kcId: "l31", difficulty: 4, stem: "n 阶矩阵 A 可对角化的充要条件是：", options: ["A 有 n 个线性无关的特征向量", "A 有 n 个不同的特征值", "A 是对称矩阵", "|A|≠0"], answerIndex: 0, explanation: "把 n 个线性无关特征向量作为列组成 P，可使 P⁻¹AP 为对角阵，反之可对角化也必然提供 n 个无关特征向量；有 n 个不同特征值只是充分条件。" },

  // ── l32 实对称矩阵的对角化 ──
  { id: "q-l32-1", kcId: "l32", difficulty: 2, stem: "实对称矩阵的特征值：", options: ["全是实数", "全是正数", "全是整数", "可能为复数"], answerIndex: 0, explanation: "实对称矩阵的特征多项式虽有可能是高次的，但其根必为实数，这是实对称矩阵谱定理的基本结论；特征值可以为负或零，不一定是正数或整数。" },
  { id: "q-l32-2", kcId: "l32", difficulty: 3, stem: "实对称矩阵属于不同特征值的特征向量：", options: ["一定正交", "一定线性相关", "一定相等", "无法判断"], answerIndex: 0, explanation: "设 Aα=λα、Aβ=μβ 且 λ≠μ，由对称性可推出 (λ−μ)(α,β)=0，故内积为零，即特征向量正交；这是实对称矩阵优于一般矩阵的关键性质。" },
  { id: "q-l32-3", kcId: "l32", difficulty: 4, stem: "实对称矩阵 A 一定可以：", options: ["通过正交矩阵 Q 相似对角化，即 QᵀAQ=Λ", "化为零矩阵", "分解为两个非零矩阵之和", "通过初等行变换化为单位矩阵"], answerIndex: 0, explanation: "实对称矩阵的每个特征子空间都可取规范正交基，拼成正交矩阵 Q 后 QᵀAQ=Λ 为对角阵；这一结论不要求特征值互异，是谱定理的核心内容。" },

  // ── l33 二次型及其矩阵表示 ──
  { id: "q-l33-1", kcId: "l33", difficulty: 2, stem: "二次型 f(x1,…,xn) 对应的矩阵通常是：", options: ["对称矩阵", "上三角矩阵", "对角矩阵", "零矩阵"], answerIndex: 0, explanation: "二次型的交叉项系数会被平均分配到矩阵的对称位置，使 aij=aji，因此对应矩阵为对称矩阵且由二次型唯一确定；对角矩阵只是其中没有交叉项的特例。" },
  { id: "q-l33-2", kcId: "l33", difficulty: 3, stem: "二次型 f=x1²+2x1x2+3x2² 的矩阵是：", options: ["[1 1; 1 3]", "[1 2; 0 3]", "[1 0; 2 3]", "[2 1; 1 3]"], answerIndex: 0, explanation: "平方项系数放在对角元，交叉项 2x1x2 的系数 2 要平分到 a12 和 a21，各为 1，因此矩阵为 [1 1; 1 3]；把 2 直接放进去会使展开后交叉项变成 4x1x2。" },
  { id: "q-l33-3", kcId: "l33", difficulty: 4, stem: "矩阵 A 与 B 合同是指：", options: ["存在可逆矩阵 C 使 CᵀAC=B", "存在可逆矩阵 P 使 P⁻¹AP=B", "A 与 B 相等", "A 与 B 的秩为零"], answerIndex: 0, explanation: "合同关系对应二次型在可逆线性替换下的变换，要求 CᵀAC=B；P⁻¹AP 描述的是相似，二者形式不同，合同矩阵未必相似。" },

  // ── l34 化二次型为标准形 ──
  { id: "q-l34-1", kcId: "l34", difficulty: 2, stem: "配方法化二次型为标准形时，主要利用：", options: ["配成完全平方并作可逆线性替换", "求矩阵的秩", "计算特征向量", "初等列变换求逆"], answerIndex: 0, explanation: "配方法把含同一变量的项集中配成平方，再令新变量等于括号内的线性式，得到只含平方项的标准形；该替换必须可逆，否则会改变二次型的等价性。" },
  { id: "q-l34-2", kcId: "l34", difficulty: 3, stem: "用正交变换化二次型为标准形时，标准形中平方项的系数是：", options: ["二次型矩阵的特征值", "矩阵的对角线元素", "任意常数", "矩阵的秩"], answerIndex: 0, explanation: "正交变换 x=Qy 使 QᵀAQ=Λ，Λ 的对角元正是 A 的特征值，因此标准形为 λ1y1²+…+λnyn²；对角线元素一般不等于特征值。" },
  { id: "q-l34-3", kcId: "l34", difficulty: 4, stem: "正交变换化二次型为标准形相比配方法的主要优点是：", options: ["变换矩阵正交，保持向量的长度和几何形状", "不需要求特征值", "一定得到规范形", "计算量更小"], answerIndex: 0, explanation: "正交变换是保长度的刚体变换，不改变曲面的几何形状，标准形系数就是特征值；配方法虽更简单，但一般变换会拉伸空间，且需先求特征值的是正交变换法。" },

  // ── l35 惯性定理与规范形 ──
  { id: "q-l35-1", kcId: "l35", difficulty: 2, stem: "二次型的惯性定理说明：", options: ["无论用什么可逆线性替换，正负平方项个数不变", "标准形唯一", "所有二次型都能化为同一形式", "特征值不变"], answerIndex: 0, explanation: "惯性定理指出正惯性指数和负惯性指数由二次型本身决定，与化简方式无关；标准形不唯一（系数可变），但正负项个数是不变量。" },
  { id: "q-l35-2", kcId: "l35", difficulty: 3, stem: "二次型的规范形中，平方项系数只能是：", options: ["1、−1 或 0", "任意实数", "只能是正数", "只能是整数"], answerIndex: 0, explanation: "规范形通过可逆伸缩把正平方项系数化为 1、负平方项系数化为 −1，零项保留为零，因此系数只取 1、−1、0；这使规范形由正负惯性指数唯一确定。" },
  { id: "q-l35-3", kcId: "l35", difficulty: 4, stem: "两个实二次型合同（可通过可逆线性替换互化）的充要条件是：", options: ["它们有相同的正、负惯性指数", "它们的秩相同", "它们的行列式相同", "它们的迹相同"], answerIndex: 0, explanation: "合同不变量是正负惯性指数，二者相同即可化为同一规范形，从而互相合同；仅秩相同只能保证非零项总数相同，无法区分正负项个数。" },

  // ── l36 正定二次型 ──
  { id: "q-l36-1", kcId: "l36", difficulty: 2, stem: "实二次型 f=xᵀAx 正定的定义是：", options: ["对任意非零向量 x，都有 xᵀAx>0", "对任意向量 x，都有 xᵀAx≥0", "存在某个 x 使 xᵀAx>0", "A 的行列式大于零"], answerIndex: 0, explanation: "正定要求对所有非零向量严格大于零，只满足非负是半正定；存在某个向量大于零或行列式大于零都不足以保证全局正定。" },
  { id: "q-l36-2", kcId: "l36", difficulty: 3, stem: "实对称矩阵 A 正定的充要条件是：", options: ["A 的所有特征值都大于零", "A 的所有特征值都小于零", "A 的行列式大于零", "A 的迹大于零"], answerIndex: 0, explanation: "正交变换后二次型化为 λi yi² 之和，正定当且仅当每个系数 λi>0；行列式大于零只说明负特征值个数为偶数，迹大于零也不能排除负特征值。" },
  { id: "q-l36-3", kcId: "l36", difficulty: 4, stem: "用顺序主子式判断 n 阶实对称矩阵正定时，要求：", options: ["所有顺序主子式都大于零", "所有顺序主子式都小于零", "只有 n 阶主子式大于零", "所有元素都大于零"], answerIndex: 0, explanation: "Sylvester 判据指出 A 正定当且仅当从 1 阶到 n 阶的全部顺序主子式都大于零；只看最高阶主子式或元素符号都不能保证正定。" },

  // ── l37 线性空间的定义 ──
  { id: "q-l37-1", kcId: "l37", difficulty: 2, stem: "线性空间（向量空间）的定义要求集合对运算满足：", options: ["加法与数乘的八条公理", "只需要加法交换律", "只需要存在零元素", "只需要数乘封闭"], answerIndex: 0, explanation: "线性空间需满足加法交换、结合、零元、负元以及数乘的单位、结合、分配等八条公理；只满足其中一两条不足以构成线性空间。" },
  { id: "q-l37-2", kcId: "l37", difficulty: 3, stem: "线性空间 V 的非空子集 W 构成子空间的条件是：", options: ["W 对 V 的加法和数乘封闭", "W 含有无穷多个向量", "W 的维数等于 V 的维数", "W 不含零向量"], answerIndex: 0, explanation: "子空间需自身也构成线性空间，由于运算继承自 V，只需验证非空且对加法、数乘封闭；不含零向量的集合不可能构成子空间。" },
  { id: "q-l37-3", kcId: "l37", difficulty: 4, stem: "数域 F 上两个有限维线性空间同构的充要条件是：", options: ["它们的维数相同", "它们的元素个数相同", "它们都是 Fⁿ 的子集", "它们的基相同"], answerIndex: 0, explanation: "同构是保持加法与数乘的双射，任取一组基可建立与 Fⁿ 的同构映射，因此同构当且仅当维数相等；元素个数和具体基都不能作为判据。" },

  // ── l38 线性变换 ──
  { id: "q-l38-1", kcId: "l38", difficulty: 2, stem: "映射 T:V→V 是线性变换，必须满足：", options: ["T(α+β)=Tα+Tβ 且 T(kα)=kTα", "T 是单射", "T 是满射", "T 把零向量映为非零向量"], answerIndex: 0, explanation: "线性变换的核心是保持加法与数乘两种运算，即可加性与齐性；单射、满射是可逆性的要求，不是线性变换的定义，且线性变换必把零向量映为零向量。" },
  { id: "q-l38-2", kcId: "l38", difficulty: 3, stem: "线性变换 T 的核 ker(T) 是指：", options: ["所有满足 Tα=0 的向量组成的集合", "所有像向量的集合", "T 的定义域", "T 的矩阵的对角线"], answerIndex: 0, explanation: "核是零向量的原像集合，反映变换丢失了哪些方向，其维数称为零度；像集 im(T) 是所有 Tα 的集合，二者通过维数定理联系。" },
  { id: "q-l38-3", kcId: "l38", difficulty: 4, stem: "有限维线性空间上线性变换 T 的维数定理是：", options: ["dim ker(T)+dim im(T)=dim V", "dim ker(T)=dim im(T)", "dim ker(T)·dim im(T)=dim V", "dim im(T)=dim V+dim ker(T)"], answerIndex: 0, explanation: "零度加秩等于定义域维数，即 dim ker(T)+dim im(T)=dim V；由此可由核的维数推出像的维数，判断变换是否单射或满射。" },

  // ── l39 线性变换的矩阵表示 ──
  { id: "q-l39-1", kcId: "l39", difficulty: 2, stem: "线性变换在不同基下的矩阵之间的关系是：", options: ["相似", "合同", "相等", "互为转置"], answerIndex: 0, explanation: "同一线性变换在两组基下的矩阵满足 B=P⁻¹AP，其中 P 是过渡矩阵，因此二者相似；合同对应的是二次型在不同基下的矩阵，含义不同。" },
  { id: "q-l39-2", kcId: "l39", difficulty: 3, stem: "线性变换 T 在某组基下的矩阵 A 的第 j 列是：", options: ["T(αj) 在该基下的坐标", "αj 在标准基下的坐标", "T 的核向量", "A 的特征向量"], answerIndex: 0, explanation: "矩阵表示的定义就是 T(αj)=a1jα1+…+anjαn，系数列向量构成第 j 列；它描述基向量被变换后的像如何由原基表示。" },
  { id: "q-l39-3", kcId: "l39", difficulty: 4, stem: "若线性变换 T 在两组基下的矩阵分别为 A 与 B，过渡矩阵为 P，则：", options: ["B=P⁻¹AP", "B=PAP⁻¹", "B=PᵀAP", "B=A+P"], answerIndex: 0, explanation: "设新基为原基右乘过渡矩阵 P，则同一变换在新基下的矩阵为 P⁻¹AP；这正是相似变换的来源，注意 P 与 P⁻¹ 的位置不能颠倒。" },

  // ── l40 线性代数的应用 ──
  { id: "q-l40-1", kcId: "l40", difficulty: 2, stem: "最小二乘法主要用于：", options: ["求解无精确解的超定线性方程组，使残差平方和最小", "求方阵的逆矩阵", "判断矩阵是否可对角化", "计算行列式的值"], answerIndex: 0, explanation: "当方程个数多于未知数且不相容时，最小二乘寻找使 ||Ax−b||² 最小的 x，通过正规方程 AᵀAx=Aᵀb 求解；它不用于求逆或判断可对角化。" },
  { id: "q-l40-2", kcId: "l40", difficulty: 3, stem: "矩阵的奇异值分解（SVD）的形式是：", options: ["A=UΣVᵀ，其中 U、V 为正交矩阵，Σ 为对角形", "A=P⁻¹DP", "A=LU", "A=QR"], answerIndex: 0, explanation: "SVD 把任意矩阵分解为两个正交矩阵与一个对角矩阵的乘积，对角元为非负奇异值，适用于非方阵和不可对角化矩阵；P⁻¹DP 是相似对角化，LU、QR 是其他分解。" },
  { id: "q-l40-3", kcId: "l40", difficulty: 4, stem: "图像压缩中使用低秩近似的主要依据是：", options: ["保留最大的若干奇异值可保留主要信息并大幅减少存储", "图像矩阵的秩一定为零", "奇异值全部相等", "低秩矩阵无法计算"], answerIndex: 0, explanation: "SVD 后按奇异值从大到小截断，只保留前 k 项即可用远少于原矩阵的数据近似原图，这是 Eckart-Young 定理的结论；图像矩阵通常满秩且奇异值差异很大。" },
];
