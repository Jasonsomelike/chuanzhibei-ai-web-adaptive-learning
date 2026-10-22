/**
 * 题库：40 个知识点 × 3 题 = 120 题。
 *
 * 每题带难度 d∈{1,2,3,4,5} 与解析。难度标签直接影响「几题够用」的结论
 * （见 research/06-synthesis.md §1.2），所以每个知识点的 3 题刻意做成
 * 易/中/难梯度，让难度分布在 d=2 附近，与设计假设一致。
 *
 * ⚠️ 正式提交前须由任课教师逐题核对正确性与难度标注。
 */

import type { Difficulty } from "@/lib/mastery";

export interface Question {
  readonly id: string;
  readonly kcId: string;
  readonly difficulty: Difficulty;
  readonly stem: string;
  readonly options: readonly string[];
  /** 正确选项的下标（0 起）。 */
  readonly answerIndex: number;
  /** 解析：说清为什么对、为什么错，而不是只给答案。 */
  readonly explanation: string;
}

export const questions: readonly Question[] = [
  // ── c01 数据结构基本概念 ──
  { id: "q-c01-1", kcId: "c01", difficulty: 1, stem: "下列哪一项描述的是数据的「存储结构」？", options: ["数据元素之间的逻辑关系", "数据在计算机中的表示与实现", "对数据允许执行的操作集合", "数据的分类方式"], answerIndex: 1, explanation: "存储结构（物理结构）指数据在计算机中的表示，如顺序存储、链式存储。逻辑结构描述元素间关系，操作集合是运算。" },
  { id: "q-c01-2", kcId: "c01", difficulty: 2, stem: "线性表可以采用顺序存储或链式存储，这说明：", options: ["逻辑结构与存储结构一一对应", "同一逻辑结构可有多种存储结构", "存储结构决定了逻辑结构", "两者没有关系"], answerIndex: 1, explanation: "线性表是逻辑结构，顺序表和链表是它的两种存储实现。逻辑结构独立于存储结构，这是数据结构课程的基本观点。" },
  { id: "q-c01-3", kcId: "c01", difficulty: 3, stem: "若某结构元素之间存在一对多的层次关系，它最可能是：", options: ["线性结构", "树形结构", "图状结构", "集合结构"], answerIndex: 1, explanation: "一对多是树形结构的特征。线性结构是一对一，图状结构是多对多，集合结构元素间无关系。" },

  // ── c02 时间复杂度 ──
  { id: "q-c02-1", kcId: "c02", difficulty: 1, stem: "语句 `for(i=0;i<n;i++) sum+=a[i];` 的时间复杂度是：", options: ["O(1)", "O(log n)", "O(n)", "O(n²)"], answerIndex: 2, explanation: "循环执行 n 次，每次常数时间，总计 O(n)。" },
  { id: "q-c02-2", kcId: "c02", difficulty: 2, stem: "两层嵌套循环，外层 n 次、内层每次 n 次，总复杂度是：", options: ["O(n)", "O(n log n)", "O(n²)", "O(2ⁿ)"], answerIndex: 2, explanation: "总执行次数 n×n = n²，取最高阶即 O(n²)。" },
  { id: "q-c02-3", kcId: "c02", difficulty: 3, stem: "`for(i=1;i<n;i*=2)` 的循环体执行次数约为：", options: ["n", "n/2", "log₂n", "√n"], answerIndex: 2, explanation: "i 依次为 1,2,4,8…，达到 n 需 log₂n 步，所以是 O(log n)。这是折半类算法的典型形式。" },

  // ── c03 空间复杂度 ──
  { id: "q-c03-1", kcId: "c03", difficulty: 1, stem: "空间复杂度衡量的是：", options: ["程序占用的总内存", "算法额外需要的辅助存储随规模的增长", "输入数据本身的大小", "磁盘占用"], answerIndex: 1, explanation: "空间复杂度通常只算辅助空间，不含输入本身占用的空间。" },
  { id: "q-c03-2", kcId: "c03", difficulty: 2, stem: "原地排序（in-place）的空间复杂度是：", options: ["O(1)", "O(n)", "O(n log n)", "O(n²)"], answerIndex: 0, explanation: "原地指只用常数个额外变量，不随 n 增长，故 O(1)。" },
  { id: "q-c03-3", kcId: "c03", difficulty: 3, stem: "归并排序需要额外 O(n) 空间，主要用在：", options: ["递归调用的栈", "合并两个有序段时的临时数组", "存放原始输入", "存放下标"], answerIndex: 1, explanation: "二路归并需要一个与待合并段等长的临时数组存放合并结果，这是 O(n) 的来源；递归栈是 O(log n)。" },

  // ── c04 渐进分析 ──
  { id: "q-c04-1", kcId: "c04", difficulty: 1, stem: "大 O 记号 O(f(n)) 描述的是：", options: ["精确运行时间", "运行时间的渐进上界", "运行时间的渐进下界", "平均情况"], answerIndex: 1, explanation: "O 表示渐进上界（不超过某个常数倍的 f(n)）。下界用 Ω，紧确界用 Θ。" },
  { id: "q-c04-2", kcId: "c04", difficulty: 2, stem: "快速排序在最坏情况下的时间复杂度是：", options: ["O(n log n)", "O(n²)", "O(n)", "O(log n)"], answerIndex: 1, explanation: "每次划分极不均衡（如已有序且取端点为枢轴）时退化为 n+(n-1)+…= O(n²)。" },
  { id: "q-c04-3", kcId: "c04", difficulty: 4, stem: "递归式 T(n)=2T(n/2)+O(n) 的解是：", options: ["O(n)", "O(n log n)", "O(n²)", "O(log n)"], answerIndex: 1, explanation: "这是归并排序的递归式。每层代价 O(n)，共 log n 层，故 O(n log n)。" },

  // ── c05 顺序表 ──
  { id: "q-c05-1", kcId: "c05", difficulty: 1, stem: "顺序表按下标访问第 i 个元素的时间复杂度是：", options: ["O(1)", "O(log n)", "O(n)", "O(n²)"], answerIndex: 0, explanation: "顺序表元素连续存放，地址可直接算出：base + i×size，故 O(1)。这是它相对链表的最大优势。" },
  { id: "q-c05-2", kcId: "c05", difficulty: 2, stem: "在长度为 n 的顺序表第 i 个位置插入元素，平均需移动元素约：", options: ["0 个", "n/2 个", "n 个", "log n 个"], answerIndex: 1, explanation: "插入位置等概率分布时平均移动 n/2 个元素，故插入复杂度 O(n)。" },
  { id: "q-c05-3", kcId: "c05", difficulty: 3, stem: "顺序表删除第 i 个元素需要：", options: ["只需改指针", "把第 i 个之后的元素全部前移一位", "把之前的元素后移一位", "重建整个表"], answerIndex: 1, explanation: "删除后要保持连续存放，必须把后面的元素整体前移，代价 O(n)。" },

  // ── c06 单链表 ──
  { id: "q-c06-1", kcId: "c06", difficulty: 1, stem: "单链表在已知结点 p 之后插入新结点的时间复杂度是：", options: ["O(1)", "O(n)", "O(log n)", "O(n²)"], answerIndex: 0, explanation: "只需改两个指针：new.next = p.next; p.next = new。无需移动元素。" },
  { id: "q-c06-2", kcId: "c06", difficulty: 2, stem: "单链表查找第 i 个元素需要：", options: ["O(1)", "O(i)，最坏 O(n)", "O(log n)", "O(n²)"], answerIndex: 1, explanation: "链表不能随机访问，必须从头遍历，第 i 个要跳 i 次。" },
  { id: "q-c06-3", kcId: "c06", difficulty: 3, stem: "带头结点的单链表相比不带头结点，主要好处是：", options: ["节省空间", "统一了在表头与其他位置插入删除的处理", "查找更快", "可以随机访问"], answerIndex: 1, explanation: "有头结点后，表头操作与中间操作逻辑一致，不必单独判空或改头指针，减少边界特判。" },

  // ── c07 双链表与循环链表 ──
  { id: "q-c07-1", kcId: "c07", difficulty: 1, stem: "双向链表相比单链表多出的信息是：", options: ["每个结点存前驱指针", "每个结点存下标", "额外的头结点", "长度计数"], answerIndex: 0, explanation: "双向链表每个结点有 prior 和 next 两个指针，可双向遍历，代价是每个结点多一个指针的空间。" },
  { id: "q-c07-2", kcId: "c07", difficulty: 2, stem: "在双向链表中删除已知结点 p，时间复杂度是：", options: ["O(1)", "O(n)", "O(log n)", "O(n²)"], answerIndex: 0, explanation: "有前驱指针，可直接 p->prior->next = p->next; p->next->prior = p->prior，无需遍历找前驱。" },
  { id: "q-c07-3", kcId: "c07", difficulty: 3, stem: "循环链表的判空条件（设 head 为头指针，rear 为尾指针）通常是：", options: ["head == NULL", "head->next == head", "rear == NULL", "rear->next == NULL"], answerIndex: 1, explanation: "循环链表首尾相接，空表时头结点的 next 指回自己，故 head->next == head。" },

  // ── c08 静态链表 ──
  { id: "q-c08-1", kcId: "c08", difficulty: 2, stem: "静态链表用数组模拟链表，其中「指针」实际是：", options: ["内存地址", "数组下标（游标）", "结点编号", "偏移量"], answerIndex: 1, explanation: "静态链表用数组下标代替指针，称为游标。适用于不支持指针的语言或需固定分配的场景。" },
  { id: "q-c08-2", kcId: "c08", difficulty: 3, stem: "静态链表中通常用哪个下标表示空指针？", options: ["0", "-1", "数组长度", "最后一个元素下标"], answerIndex: 1, explanation: "约定 -1（或 0，视实现）表示空，因为它是非法下标，可与有效游标区分。" },
  { id: "q-c08-3", kcId: "c08", difficulty: 4, stem: "静态链表的主要缺点是：", options: ["不能插入删除", "容量固定，难以动态扩展", "无法遍历", "不能存字符串"], answerIndex: 1, explanation: "数组大小编译期或初始化时确定，无法像动态链表那样按需增长，这是它被动态链表取代的主因。" },

  // ── c09 栈 ──
  { id: "q-c09-1", kcId: "c09", difficulty: 1, stem: "栈的存取特点是：", options: ["先进先出", "后进先出", "随机存取", "按优先级"], answerIndex: 1, explanation: "栈只允许在栈顶插入和删除，故后进先出（LIFO）。" },
  { id: "q-c09-2", kcId: "c09", difficulty: 2, stem: "设栈的入栈序列为 1,2,3，则不可能的出栈序列是：", options: ["3,2,1", "1,2,3", "2,1,3", "3,1,2"], answerIndex: 3, explanation: "若 3 先出栈，说明 1、2 已入栈，此时栈内自底向上为 1,2，栈顶是 2，下一个只能出 2 不能出 1。" },
  { id: "q-c09-3", kcId: "c09", difficulty: 3, stem: "顺序栈用 top 指向栈顶元素，则判满条件是（容量 MAXSIZE）：", options: ["top == 0", "top == MAXSIZE-1", "top == MAXSIZE", "top == -1"], answerIndex: 1, explanation: "若 top 指向栈顶元素本身且从 0 开始，栈满时 top = MAXSIZE-1。若 top 指向栈顶的下一个空位，则满条件是 top == MAXSIZE。注意区分两种约定。" },

  // ── c10 队列 ──
  { id: "q-c10-1", kcId: "c10", difficulty: 1, stem: "队列的特点是：", options: ["后进先出", "先进先出", "随机存取", "双端操作"], answerIndex: 1, explanation: "队列在队尾插入、队头删除，先进先出（FIFO）。" },
  { id: "q-c10-2", kcId: "c10", difficulty: 2, stem: "循环队列中，为区分队空与队满，通常：", options: ["少用一个存储单元", "增加一个计数器或设置标志位", "两种做法都可以", "无法区分"], answerIndex: 2, explanation: "两种方法都常用：牺牲一个单元（front==rear 为空，(rear+1)%MAX==front 为满），或额外用 count/flag 记录。本题选「都可以」。" },
  { id: "q-c10-3", kcId: "c10", difficulty: 3, stem: "循环队列长度计算公式（front 指向队头，rear 指向队尾的下一位，容量 MAXSIZE）是：", options: ["rear - front", "(rear - front + MAXSIZE) % MAXSIZE", "front - rear", "MAXSIZE - rear + front"], answerIndex: 1, explanation: "取模保证 rear 绕回时不出现负数，这是循环队列长度计算的标准写法。" },

  // ── c11 栈的应用 ──
  { id: "q-c11-1", kcId: "c11", difficulty: 1, stem: "检查括号是否匹配最适合用：", options: ["队列", "栈", "链表", "哈希表"], answerIndex: 1, explanation: "遇到左括号入栈，遇到右括号与栈顶比较并出栈，最后栈空则匹配。这是栈的经典应用。" },
  { id: "q-c11-2", kcId: "c11", difficulty: 3, stem: "中缀表达式转后缀（逆波兰）时，运算符的入栈规则主要依据：", options: ["运算符长度", "运算符优先级与括号", "出现顺序", "操作数个数"], answerIndex: 1, explanation: "优先级高的先出栈，遇左括号压栈、遇右括号弹到左括号为止。优先级是核心依据。" },
  { id: "q-c11-3", kcId: "c11", difficulty: 4, stem: "后缀表达式 `3 4 + 5 *` 的值是：", options: ["23", "35", "27", "17"], answerIndex: 1, explanation: "从左到右：3、4 入栈，遇 + 弹出 4 和 3 得 7 入栈，5 入栈，遇 * 弹出 5 和 7 得 35。" },

  // ── c12 递归 ──
  { id: "q-c12-1", kcId: "c12", difficulty: 1, stem: "递归算法必须包含：", options: ["循环", "终止条件（递归出口）", "全局变量", "数组"], answerIndex: 1, explanation: "没有终止条件的递归会无限调用直至栈溢出。终止条件是递归三要素之一。" },
  { id: "q-c12-2", kcId: "c12", difficulty: 2, stem: "递归调用过程中，系统用什么结构保存返回地址与局部变量？", options: ["队列", "栈", "堆", "数组"], answerIndex: 1, explanation: "每次调用压入一个栈帧，返回时弹出。递归深度过大导致栈溢出就是这个原因。" },
  { id: "q-c12-3", kcId: "c12", difficulty: 4, stem: "递归求斐波那契 f(n)=f(n-1)+f(n-2) 的时间复杂度是：", options: ["O(n)", "O(n log n)", "O(2ⁿ)", "O(n²)"], answerIndex: 2, explanation: "每层分裂成两个子调用，递归树结点数指数增长。这就是为什么朴素递归求斐波那契很慢，需要记忆化。" },

  // ── c13 串 ──
  { id: "q-c13-1", kcId: "c13", difficulty: 1, stem: "串是：", options: ["字符的有限序列", "整数的集合", "树的特例", "图的特例"], answerIndex: 0, explanation: "串（字符串）是由零个或多个字符组成的有限序列，是一种特殊的线性表，元素限定为字符。" },
  { id: "q-c13-2", kcId: "c13", difficulty: 2, stem: "空串与空格串的区别是：", options: ["没有区别", "空串长度为 0，空格串长度大于 0", "空串含一个空格", "空格串长度为 0"], answerIndex: 1, explanation: "空串不含任何字符，长度 0；空格串含一个或多个空格字符，长度等于空格个数。" },
  { id: "q-c13-3", kcId: "c13", difficulty: 3, stem: "求子串 SubString(S, pos, len) 的时间复杂度是：", options: ["O(1)", "O(len)", "O(|S|)", "O(len²)"], answerIndex: 1, explanation: "需要从 pos 开始复制 len 个字符，代价与子串长度成正比。" },

  // ── c14 KMP ──
  { id: "q-c14-1", kcId: "c14", difficulty: 2, stem: "KMP 算法相比朴素匹配的核心改进是：", options: ["主串指针不回溯", "模式串指针不移动", "使用哈希", "使用二分"], answerIndex: 0, explanation: "KMP 利用已匹配信息计算 next 数组，失配时只移动模式串，主串指针不回退，故为 O(n+m)。" },
  { id: "q-c14-2", kcId: "c14", difficulty: 3, stem: "next 数组的含义是：", options: ["模式串的最长相等前后缀长度", "主串的长度", "匹配成功的次数", "字符的 ASCII 值"], answerIndex: 0, explanation: "next[j] 表示模式串前 j 个字符中最长相等真前缀与真后缀的长度，失配时据此决定模式串回退位置。" },
  { id: "q-c14-3", kcId: "c14", difficulty: 4, stem: "KMP 的时间复杂度是：", options: ["O(n·m)", "O(n+m)", "O(n log m)", "O(m²)"], answerIndex: 1, explanation: "主串指针只前进不后退，模式串指针虽会回退但总移动量摊还后仍是 O(m)，合计 O(n+m)。" },

  // ── c15 树的基本概念 ──
  { id: "q-c15-1", kcId: "c15", difficulty: 1, stem: "一棵有 n 个结点的树，其边数为：", options: ["n", "n-1", "n+1", "2n"], answerIndex: 1, explanation: "树连通且无环，n 个结点的树恰有 n-1 条边。这是树的定义性性质。" },
  { id: "q-c15-2", kcId: "c15", difficulty: 2, stem: "结点的「度」指的是：", options: ["结点所在的层数", "结点拥有的子树个数", "从根到该结点的边数", "该结点的编号"], answerIndex: 1, explanation: "度是结点拥有的子树（孩子）个数。树的度是所有结点度的最大值。" },
  { id: "q-c15-3", kcId: "c15", difficulty: 3, stem: "结点的深度与高度分别指：", options: ["都指层数", "深度从根往下数，高度从叶往上数", "深度从叶往上数，高度从根往下数", "与层数无关"], answerIndex: 1, explanation: "深度（层次）自根向下累计，根深度为 1（或 0，视约定）；高度自叶向上累计，叶高度为 1。树的深度等于高度。" },

  // ── c16 二叉树的性质 ──
  { id: "q-c16-1", kcId: "c16", difficulty: 1, stem: "二叉树第 i 层最多有多少个结点？", options: ["i", "2i", "2^(i-1)", "2^i - 1"], answerIndex: 2, explanation: "第 1 层 1 个，每层最多翻倍，第 i 层最多 2^(i-1) 个。" },
  { id: "q-c16-2", kcId: "c16", difficulty: 2, stem: "任何非空二叉树中，叶子结点数 n0 与度为 2 的结点数 n2 满足：", options: ["n0 = n2", "n0 = n2 + 1", "n0 = n2 - 1", "n0 = 2·n2"], answerIndex: 1, explanation: "由 n = n0+n1+n2 与 n = 1 + 边数 = 1 + n1 + 2n2 联立可得 n0 = n2 + 1。这是常考结论。" },
  { id: "q-c16-3", kcId: "c16", difficulty: 3, stem: "深度为 k 的二叉树最多有结点数：", options: ["2k", "2^k", "2^k - 1", "2^(k-1)"], answerIndex: 2, explanation: "满二叉树结点总数为 1+2+4+…+2^(k-1) = 2^k - 1。" },

  // ── c17 二叉树的存储 ──
  { id: "q-c17-1", kcId: "c17", difficulty: 1, stem: "二叉链表每个结点包含：", options: ["数据、左孩子指针、右孩子指针", "只有数据", "数据和父指针", "数据和下标"], answerIndex: 0, explanation: "二叉链表是最常用的二叉树存储结构，每个结点三个域：lchild、data、rchild。" },
  { id: "q-c17-2", kcId: "c17", difficulty: 2, stem: "n 个结点的二叉链表中有多少个空指针域？", options: ["n", "n+1", "n-1", "2n"], answerIndex: 1, explanation: "共 2n 个指针域，除根外每个结点被一个指针指向，故非空指针 n-1 个，空指针 2n-(n-1) = n+1 个。线索二叉树正是利用这些空域。" },
  { id: "q-c17-3", kcId: "c17", difficulty: 4, stem: "顺序存储（数组）表示二叉树时，最不适合的情形是：", options: ["完全二叉树", "满二叉树", "单支树（退化成链）", "深度较小的二叉树"], answerIndex: 2, explanation: "顺序存储按完全二叉树编号，单支树会浪费大量数组空间，空间利用率极低。" },

  // ── c18 二叉树遍历 ──
  { id: "q-c18-1", kcId: "c18", difficulty: 1, stem: "中序遍历的访问顺序是：", options: ["根、左、右", "左、根、右", "左、右、根", "右、根、左"], answerIndex: 1, explanation: "中序是左子树 → 根 → 右子树。对二叉排序树中序遍历可得到有序序列。" },
  { id: "q-c18-2", kcId: "c18", difficulty: 2, stem: "已知先序序列 ABDECF 与中序序列 DBEACF，则后序序列是：", options: ["DEBFCA", "DEBCFA", "EDBFCA", "DBEFCA"], answerIndex: 0, explanation: "先序首元素 A 为根；中序中 A 左侧 DBE 为左子树、右侧 CF 为右子树。左子树先序 BDE、中序 DBE → 根 B，左 D 右 E。右子树先序 CF、中序 CF → 根 C，无左，右 F。后序：D E B F C A。" },
  { id: "q-c18-3", kcId: "c18", difficulty: 3, stem: "二叉树的层次遍历需要借助：", options: ["栈", "队列", "哈希表", "堆"], answerIndex: 1, explanation: "层次遍历按层从左到右访问，用队列保存待访问结点，出队一个就把其孩子入队。" },

  // ── c19 线索二叉树 ──
  { id: "q-c19-1", kcId: "c19", difficulty: 2, stem: "线索二叉树利用的是：", options: ["空闲的数组空间", "空指针域", "额外的哈希表", "磁盘空间"], answerIndex: 1, explanation: "n 个结点的二叉链表有 n+1 个空指针域，线索化把它们改成指向前驱/后继的线索。" },
  { id: "q-c19-2", kcId: "c19", difficulty: 3, stem: "线索二叉树的主要优点是：", options: ["节省空间", "遍历时不需要栈或递归", "插入更快", "可以随机访问"], answerIndex: 1, explanation: "有了前驱后继线索，中序遍历可直接沿线索走，无需递归或辅助栈，节省了 O(h) 的栈空间。" },
  { id: "q-c19-3", kcId: "c19", difficulty: 4, stem: "为区分指针域指向的是孩子还是线索，需要：", options: ["比较指针大小", "增加标志位 ltag/rtag", "使用特殊值", "无法区分"], answerIndex: 1, explanation: "每个结点增加 ltag、rtag 两个标志：0 表示指向孩子，1 表示指向前驱/后继线索。" },

  // ── c20 树与森林的转换 ──
  { id: "q-c20-1", kcId: "c20", difficulty: 2, stem: "孩子兄弟表示法中，结点的两个指针分别指向：", options: ["第一个孩子和下一个兄弟", "左右孩子", "父结点和子结点", "前驱和后继"], answerIndex: 0, explanation: "左指针指向第一个孩子，右指针指向下一个兄弟。这样任意树都能用二叉树表示。" },
  { id: "q-c20-2", kcId: "c20", difficulty: 3, stem: "树转换为二叉树后，根结点：", options: ["有左子树", "没有右子树", "没有左子树", "左右子树都有"], answerIndex: 1, explanation: "树的根没有兄弟，所以转换后根的右指针为空，即没有右子树。" },
  { id: "q-c20-3", kcId: "c20", difficulty: 4, stem: "森林转换为二叉树后，其遍历关系是：", options: ["森林的先根遍历对应二叉树的先序遍历", "森林的先根遍历对应二叉树的中序遍历", "两者无关", "森林的后根对应先序"], answerIndex: 0, explanation: "森林先根遍历 ≡ 对应二叉树的先序遍历；森林后根遍历 ≡ 对应二叉树的中序遍历。这个对应关系常考。" },

  // ── c21 哈夫曼树 ──
  { id: "q-c21-1", kcId: "c21", difficulty: 2, stem: "哈夫曼树的构造每次选取：", options: ["权值最大的两个结点", "权值最小的两个结点", "任意两个结点", "深度最深的两个"], answerIndex: 1, explanation: "每次合并权值最小的两棵树，使权值大的结点离根更近，从而带权路径长度最小。" },
  { id: "q-c21-2", kcId: "c21", difficulty: 3, stem: "哈夫曼编码是：", options: ["定长编码", "前缀编码", "后缀编码", "随机编码"], answerIndex: 1, explanation: "任一编码都不是另一编码的前缀，保证解码无歧义。这正是哈夫曼树只有叶子对应字符带来的性质。" },
  { id: "q-c21-3", kcId: "c21", difficulty: 4, stem: "权值为 {1,2,3,4} 的四个叶子构造哈夫曼树，其带权路径长度 WPL 是：", options: ["19", "20", "21", "30"], answerIndex: 0, explanation: "合并 1+2=3；剩 {3,3,4} 合并 3+3=6；剩 {4,6} 合并 10。WPL = 1×3+2×3+3×2+4×1 = 3+6+6+4 = 19。" },

  // ── c22 图的基本概念 ──
  { id: "q-c22-1", kcId: "c22", difficulty: 1, stem: "无向完全图 Kn 的边数是：", options: ["n", "n(n-1)/2", "n(n-1)", "n²"], answerIndex: 1, explanation: "n 个顶点两两相连，组合数 C(n,2) = n(n-1)/2。" },
  { id: "q-c22-2", kcId: "c22", difficulty: 2, stem: "有向图中所有顶点的入度之和等于：", options: ["顶点数", "边数", "2 倍边数", "入度之和与边数无关"], answerIndex: 1, explanation: "每条有向边贡献恰好一个入度，故入度之和 = 边数。无向图中度之和 = 2×边数。" },
  { id: "q-c22-3", kcId: "c22", difficulty: 3, stem: "n 个顶点的连通图至少有多少条边？", options: ["n", "n-1", "n+1", "n(n-1)/2"], answerIndex: 1, explanation: "连通 n 个顶点至少要 n-1 条边，此时是一棵树。少于 n-1 必不连通。" },

  // ── c23 图的存储 ──
  { id: "q-c23-1", kcId: "c23", difficulty: 1, stem: "邻接矩阵适合存储：", options: ["稀疏图", "稠密图", "所有图都适合", "只适合有向图"], answerIndex: 1, explanation: "邻接矩阵空间 O(n²)，与边数无关。稠密图边多，用矩阵不浪费；稀疏图用它会浪费大量零元素空间。" },
  { id: "q-c23-2", kcId: "c23", difficulty: 2, stem: "邻接表存储有向图的空间复杂度是：", options: ["O(n)", "O(n+e)", "O(n²)", "O(e²)"], answerIndex: 1, explanation: "n 个顶点表头 + e 个边结点，合计 O(n+e)。稀疏图上明显优于邻接矩阵。" },
  { id: "q-c23-3", kcId: "c23", difficulty: 3, stem: "判断两个顶点之间是否有边，邻接矩阵与邻接表的时间复杂度分别是：", options: ["O(1) 与 O(1)", "O(1) 与 O(顶点度数)", "O(n) 与 O(1)", "都是 O(n)"], answerIndex: 1, explanation: "矩阵直接查 matrix[i][j] 是 O(1)；邻接表要遍历该顶点的邻接链表，最坏 O(度数)。" },

  // ── c24 图的遍历 ──
  { id: "q-c24-1", kcId: "c24", difficulty: 1, stem: "DFS 遍历图时需要借助：", options: ["队列", "栈（或递归）", "哈希表", "堆"], answerIndex: 1, explanation: "深度优先沿路径深入，回退时后进先出，用栈或递归实现。" },
  { id: "q-c24-2", kcId: "c24", difficulty: 2, stem: "BFS 遍历图时借助队列，其效果是：", options: ["按深度优先访问", "按距离由近及远逐层访问", "随机访问", "按权值访问"], answerIndex: 1, explanation: "BFS 从源点出发逐层扩展，先访问距离为 1 的，再距离为 2 的。无权图最短路径就用它。" },
  { id: "q-c24-3", kcId: "c24", difficulty: 3, stem: "用邻接表存储图时，DFS 的时间复杂度是：", options: ["O(n)", "O(n+e)", "O(n²)", "O(e log n)"], answerIndex: 1, explanation: "每个顶点访问一次、每条边检查一次，合计 O(n+e)。用邻接矩阵则是 O(n²)。" },

  // ── c25 最小生成树 ──
  { id: "q-c25-1", kcId: "c25", difficulty: 2, stem: "Prim 算法适合：", options: ["稀疏图", "稠密图", "有向图", "带负权图"], answerIndex: 1, explanation: "Prim 复杂度 O(n²)，与边数无关，稠密图上更优。Kruskal 是 O(e log e)，适合稀疏图。" },
  { id: "q-c25-2", kcId: "c25", difficulty: 3, stem: "Kruskal 算法每一步选择：", options: ["与当前树相连的最小边", "全图最小的不成环边", "任意边", "最长边"], answerIndex: 1, explanation: "Kruskal 按边权升序取边，若两端不在同一连通分量（不成环）则加入。判环常用并查集。" },
  { id: "q-c25-3", kcId: "c25", difficulty: 3, stem: "含 n 个顶点的连通图，其最小生成树有多少条边？", options: ["n", "n-1", "n+1", "取决于权值"], answerIndex: 1, explanation: "生成树必然是树，n 个顶点 n-1 条边，与权值无关。" },

  // ── c26 最短路径 ──
  { id: "q-c26-1", kcId: "c26", difficulty: 2, stem: "Dijkstra 算法不能处理：", options: ["无向图", "有向图", "含负权边的图", "稠密图"], answerIndex: 2, explanation: "Dijkstra 基于贪心，假设已确定的最短距离不会再变小。负权边会破坏这个前提，此时应用 Bellman-Ford。" },
  { id: "q-c26-2", kcId: "c26", difficulty: 3, stem: "Floyd 算法的时间复杂度是：", options: ["O(n)", "O(n²)", "O(n³)", "O(n log n)"], answerIndex: 2, explanation: "三重循环枚举中间点与两端点，O(n³)。它能一次求出所有顶点对之间的最短路径。" },
  { id: "q-c26-3", kcId: "c26", difficulty: 4, stem: "求单源最短路径且含负权边时，应选：", options: ["Dijkstra", "Floyd", "Bellman-Ford", "Prim"], answerIndex: 2, explanation: "Bellman-Ford 通过 n-1 轮松弛可处理负权边，还能检测负权回路。Floyd 虽也能处理负权，但求的是全源且 O(n³)。" },

  // ── c27 拓扑排序 ──
  { id: "q-c27-1", kcId: "c27", difficulty: 2, stem: "拓扑排序适用于：", options: ["无向图", "有向无环图", "任意有向图", "带负权图"], answerIndex: 1, explanation: "拓扑排序要求顶点间有先后依赖且无环，即有向无环图（DAG）。有环则排不出完整序列。" },
  { id: "q-c27-2", kcId: "c27", difficulty: 3, stem: "入度法拓扑排序，若最终输出的顶点数少于总顶点数，说明：", options: ["算法出错", "图中有环", "图不连通", "存在孤立点"], answerIndex: 1, explanation: "有环时环上顶点入度永远不为 0，无法入队，输出数少于 n。这是判断有向图有无环的标准方法。" },
  { id: "q-c27-3", kcId: "c27", difficulty: 4, stem: "对同一 DAG，拓扑序列：", options: ["唯一", "可能不唯一", "一定不唯一", "与图无关"], answerIndex: 1, explanation: "当同时有多个入度为 0 的顶点时，选择顺序不同会得到不同序列。仅当每步恰有一个入度 0 顶点时唯一。" },

  // ── c28 关键路径 ──
  { id: "q-c28-1", kcId: "c28", difficulty: 3, stem: "关键路径是 AOE 网中：", options: ["边数最多的路径", "长度最长的路径", "长度最短的路径", "经过顶点最多的路径"], answerIndex: 1, explanation: "关键路径是源点到汇点路径长度（活动时间之和）最大的路径，它决定整个工程的最短完成时间。" },
  { id: "q-c28-2", kcId: "c28", difficulty: 3, stem: "关键活动的时间余量为：", options: ["1", "0", "负数", "不确定"], answerIndex: 1, explanation: "关键活动的最早开始时间等于最迟开始时间，余量为 0。任何延误都会推迟整个工期。" },
  { id: "q-c28-3", kcId: "c28", difficulty: 4, stem: "缩短工期应优先压缩：", options: ["任一活动", "关键活动", "非关键活动", "所有活动"], answerIndex: 1, explanation: "只有关键活动在关键路径上，压缩它才可能缩短总工期。压缩非关键活动只会增加其时间余量。" },

  // ── c29 顺序查找与折半查找 ──
  { id: "q-c29-1", kcId: "c29", difficulty: 1, stem: "折半查找的前提是：", options: ["数据无序", "数据有序且顺序存储", "数据用链表存储", "数据量很小"], answerIndex: 1, explanation: "折半查找每次要按下标定位中间元素，因此必须顺序存储且有序。链表无法 O(1) 定位中间元素。" },
  { id: "q-c29-2", kcId: "c29", difficulty: 2, stem: "长度为 n 的有序表折半查找，最多比较次数约为：", options: ["n", "n/2", "⌈log₂(n+1)⌉", "√n"], answerIndex: 2, explanation: "折半查找的判定树是平衡二叉树，高度约 log₂(n+1)，故最多比较次数为其上取整。" },
  { id: "q-c29-3", kcId: "c29", difficulty: 3, stem: "顺序查找的平均查找长度（等概率成功）是：", options: ["1", "(n+1)/2", "n", "log₂n"], answerIndex: 1, explanation: "查找第 i 个元素需 i 次，等概率平均为 (1+2+…+n)/n = (n+1)/2。" },

  // ── c30 分块查找 ──
  { id: "q-c30-1", kcId: "c30", difficulty: 2, stem: "分块查找要求数据：", options: ["整体有序", "块间有序、块内可无序", "块内有序、块间无序", "完全无序"], answerIndex: 1, explanation: "索引表记录每块最大值，块间必须按大小有序才能确定目标在哪块；块内顺序查找即可，无需有序。" },
  { id: "q-c30-2", kcId: "c30", difficulty: 3, stem: "分块查找的性能介于：", options: ["顺序查找与折半查找之间", "折半查找与哈希之间", "优于折半查找", "与顺序查找相同"], answerIndex: 0, explanation: "先查索引（可用折半）再块内顺序查找，平均性能介于两者之间。块长取 √n 时最优。" },
  { id: "q-c30-3", kcId: "c30", difficulty: 4, stem: "分块查找的最优块长约为：", options: ["n", "n/2", "√n", "log n"], answerIndex: 2, explanation: "设块长 s，块数 n/s，总代价 s/2 + n/s 最小化得 s = √n。这是经典的均值不等式结论。" },

  // ── c31 二叉排序树 ──
  { id: "q-c31-1", kcId: "c31", difficulty: 1, stem: "二叉排序树的中序遍历结果是：", options: ["无序", "递增有序", "递减有序", "与插入顺序相同"], answerIndex: 1, explanation: "BST 左子树所有结点小于根、右子树大于根，中序遍历（左-根-右）自然得到递增序列。" },
  { id: "q-c31-2", kcId: "c31", difficulty: 3, stem: "二叉排序树最坏情况下的查找复杂度是：", options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"], answerIndex: 2, explanation: "按有序序列依次插入会退化成单支树，高度 n，查找退化为 O(n)。这是引入平衡树的动机。" },
  { id: "q-c31-3", kcId: "c31", difficulty: 3, stem: "删除 BST 中度为 2 的结点，常用做法是：", options: ["直接删除", "用其直接前驱或后继替换", "把整棵树重建", "把该结点移到根"], answerIndex: 1, explanation: "用中序前驱（左子树最大）或后继（右子树最小）的值替换，再删除那个前驱/后继结点，可保持 BST 性质。" },

  // ── c32 AVL ──
  { id: "q-c32-1", kcId: "c32", difficulty: 2, stem: "AVL 树的平衡因子定义是：", options: ["左子树高度减右子树高度", "右子树高度减左子树高度", "结点总数", "左右孩子数之差"], answerIndex: 0, explanation: "平衡因子 = 左子树高度 − 右子树高度，取值只能是 -1、0、1。超出则需旋转。" },
  { id: "q-c32-2", kcId: "c32", difficulty: 3, stem: "在 AVL 树中插入导致 RR 型失衡（右子树的右子树过高），应做：", options: ["左单旋", "右单旋", "先左后右双旋", "先右后左双旋"], answerIndex: 0, explanation: "RR 型做一次左旋即可。LL 型右旋，LR 型先左后右，RL 型先右后左。" },
  { id: "q-c32-3", kcId: "c32", difficulty: 4, stem: "含 n 个结点的 AVL 树，其高度是：", options: ["O(1)", "O(log n)", "O(n)", "O(√n)"], answerIndex: 1, explanation: "AVL 保证左右子树高度差不超过 1，高度被限制在 O(log n)，故查找最坏也是 O(log n)。" },

  // ── c33 B 树 ──
  { id: "q-c33-1", kcId: "c33", difficulty: 3, stem: "B 树主要用于：", options: ["内存中的查找", "磁盘等外存的索引", "字符串匹配", "图遍历"], answerIndex: 1, explanation: "B 树一个结点存多个关键字、有多个孩子，树高低，能显著减少磁盘 I/O 次数，是数据库索引的基础。" },
  { id: "q-c33-2", kcId: "c33", difficulty: 4, stem: "B+ 树相比 B 树的主要区别是：", options: ["B+ 树数据只存叶子且叶子相连", "B+ 树更矮", "B+ 树不支持范围查询", "B+ 树没有根"], answerIndex: 0, explanation: "B+ 树内部结点只存索引，全部数据在叶子层，且叶子用链表相连，因此范围查询非常高效。MySQL InnoDB 用它。" },
  { id: "q-c33-3", kcId: "c33", difficulty: 4, stem: "m 阶 B 树中，除根外的每个结点至少有：", options: ["m 个孩子", "⌈m/2⌉ 个孩子", "2 个孩子", "1 个孩子"], answerIndex: 1, explanation: "m 阶 B 树除根外每个结点至少 ⌈m/2⌉ 个孩子、至多 m 个孩子。根至少 2 个孩子（非叶时）。" },

  // ── c34 哈希表 ──
  { id: "q-c34-1", kcId: "c34", difficulty: 1, stem: "哈希表查找的平均时间复杂度是：", options: ["O(1)", "O(log n)", "O(n)", "O(n²)"], answerIndex: 0, explanation: "理想情况下由关键字直接算出地址，无需比较，平均 O(1)。但冲突严重时会退化。" },
  { id: "q-c34-2", kcId: "c34", difficulty: 3, stem: "装填因子 α 增大时，哈希表的：", options: ["查找效率提高", "冲突概率增大、性能下降", "空间占用减小且性能不变", "与性能无关"], answerIndex: 1, explanation: "α = 表中记录数 / 表长。α 越大冲突越多，平均查找长度随之上升。通常控制在 0.75 以下。" },
  { id: "q-c34-3", kcId: "c34", difficulty: 3, stem: "开放定址法解决冲突时，删除元素不能直接置空，因为：", options: ["会破坏表结构", "会截断探测链导致后续元素查不到", "会浪费空间", "不影响"], answerIndex: 1, explanation: "置空会让探测在此中断，后面同义词就找不到了。常用做法是设「删除标记」（墓碑）。" },

  // ── c35 排序基本概念 ──
  { id: "q-c35-1", kcId: "c35", difficulty: 1, stem: "排序算法的「稳定性」指：", options: ["算法不会崩溃", "相等元素的相对次序在排序后保持不变", "时间复杂度稳定", "空间固定"], answerIndex: 1, explanation: "稳定性指关键字相等的记录排序后相对顺序不变。多关键字排序时会用到这个性质。" },
  { id: "q-c35-2", kcId: "c35", difficulty: 2, stem: "下列属于内排序的是：", options: ["归并排序（外存版）", "快速排序", "多路归并", "置换选择排序"], answerIndex: 1, explanation: "内排序全程在内存完成。快速排序是典型内排序；多路归并、置换选择属于外排序。" },
  { id: "q-c35-3", kcId: "c35", difficulty: 3, stem: "基于比较的排序算法，其时间下界是：", options: ["O(n)", "O(n log n)", "O(n²)", "O(log n)"], answerIndex: 1, explanation: "n 个元素有 n! 种排列，判定树高度至少 log₂(n!) ≈ n log n，这是比较排序的理论下界。" },

  // ── c36 插入类排序 ──
  { id: "q-c36-1", kcId: "c36", difficulty: 1, stem: "直接插入排序的最好情况时间复杂度是：", options: ["O(1)", "O(n)", "O(n log n)", "O(n²)"], answerIndex: 1, explanation: "数据已有序时每次只需比较一次、不移动，共 n-1 次，O(n)。这是它在近乎有序数据上很快的原因。" },
  { id: "q-c36-2", kcId: "c36", difficulty: 3, stem: "希尔排序的核心思想是：", options: ["分治", "按增量分组做插入排序，逐步缩小增量", "堆调整", "归并"], answerIndex: 1, explanation: "先用较大增量让元素大跨度移动，使序列基本有序，再缩小增量做插入排序，效率高于直接插入。" },
  { id: "q-c36-3", kcId: "c36", difficulty: 3, stem: "希尔排序是：", options: ["稳定排序", "不稳定排序", "稳定与否取决于增量", "与增量无关"], answerIndex: 1, explanation: "相同元素可能被分到不同组，跨组移动会改变相对次序，故希尔排序不稳定。" },

  // ── c37 交换类排序 ──
  { id: "q-c37-1", kcId: "c37", difficulty: 1, stem: "冒泡排序一趟的作用是：", options: ["把最小元素放到最前", "把最大元素「冒」到末尾", "随机交换", "把序列分成两半"], answerIndex: 1, explanation: "每趟两两比较相邻元素，大的往后换，一趟结束最大元素落在末尾。" },
  { id: "q-c37-2", kcId: "c37", difficulty: 3, stem: "快速排序每次划分后，枢轴元素：", options: ["位置不确定", "已在最终位置上", "被删除", "移到中间"], answerIndex: 1, explanation: "划分保证枢轴左边的都不大于它、右边都不小于它，所以它的位置就是排序后的最终位置，之后无需再动。" },
  { id: "q-c37-3", kcId: "c37", difficulty: 4, stem: "快速排序在什么情况下退化到 O(n²)？", options: ["数据随机", "每次划分极不均衡", "数据量很小", "数据全相同且用三路划分"], answerIndex: 1, explanation: "每次只划分出 0 和 n-1 两部分时，递归深度 n，总代价 O(n²)。已有序且取端点为枢轴就是典型场景。" },

  // ── c38 选择类排序 ──
  { id: "q-c38-1", kcId: "c38", difficulty: 1, stem: "简单选择排序每趟选出：", options: ["最大元素放末尾", "最小元素放当前位", "中位数", "随机元素"], answerIndex: 1, explanation: "第 i 趟从第 i 到 n 个元素中选最小的，与第 i 个交换，逐步确定前 i 个位置。" },
  { id: "q-c38-2", kcId: "c38", difficulty: 3, stem: "堆排序建初始堆（大顶堆）的时间复杂度是：", options: ["O(n)", "O(n log n)", "O(n²)", "O(log n)"], answerIndex: 0, explanation: "自底向上调整建堆的总代价是 O(n)，不是 O(n log n)。这是常被误解的一点。" },
  { id: "q-c38-3", kcId: "c38", difficulty: 4, stem: "堆排序的空间复杂度是：", options: ["O(1)", "O(n)", "O(log n)", "O(n log n)"], answerIndex: 0, explanation: "堆排序在原数组上进行，只需常数个辅助变量，是原地排序。这也是它相对归并排序的优势。" },

  // ── c39 归并排序 ──
  { id: "q-c39-1", kcId: "c39", difficulty: 2, stem: "二路归并排序的核心操作是：", options: ["交换相邻元素", "合并两个有序段", "堆调整", "划分"], answerIndex: 1, explanation: "归并排序把序列分成两半递归排序，再把两个有序段合并成一个有序段。" },
  { id: "q-c39-2", kcId: "c39", difficulty: 3, stem: "归并排序的时间复杂度在最好、最坏、平均情况下都是：", options: ["O(n)", "O(n log n)", "O(n²)", "各不相同"], answerIndex: 1, explanation: "无论数据如何分布，划分总是均分、合并总是 O(n)，共 log n 层，故稳定在 O(n log n)。" },
  { id: "q-c39-3", kcId: "c39", difficulty: 4, stem: "归并排序相比快速排序的主要劣势是：", options: ["时间复杂度更高", "需要 O(n) 额外空间", "不稳定", "不能处理大数据"], answerIndex: 1, explanation: "归并需要与原数组等长的临时空间，快排是原地。但归并稳定且最坏也是 O(n log n)。" },

  // ── c40 排序算法比较 ──
  { id: "q-c40-1", kcId: "c40", difficulty: 2, stem: "下列排序中，稳定的是：", options: ["快速排序", "堆排序", "归并排序", "希尔排序"], answerIndex: 2, explanation: "归并排序合并时若相等取前段元素，可保持稳定。快排、堆排、希尔都不稳定。" },
  { id: "q-c40-2", kcId: "c40", difficulty: 3, stem: "若要求原地排序且最坏 O(n log n)，应选：", options: ["快速排序", "归并排序", "堆排序", "插入排序"], answerIndex: 2, explanation: "堆排序原地且最坏 O(n log n)。快排原地但最坏 O(n²)，归并 O(n log n) 但需 O(n) 空间。" },
  { id: "q-c40-3", kcId: "c40", difficulty: 4, stem: "对基本有序的数据，下列哪个排序最快？", options: ["快速排序", "直接插入排序", "堆排序", "简单选择排序"], answerIndex: 1, explanation: "基本有序时插入排序接近 O(n)，远快于快排（可能退化）与堆排、选择排序的 O(n log n)/O(n²)。" },
];

/** 取某个知识点的全部题目。 */
export function questionsForKc(kcId: string): readonly Question[] {
  return questions.filter((q) => q.kcId === kcId);
}
