/**
 * 数据结构课程知识图谱：40 个知识点 / 60 条先修边。
 *
 * 课程依据：国内高校《数据结构》通用教学大纲（C 语言描述）。
 * 每条边都是「不掌握前者，后者就学不动」的真实依赖，不是按章节顺序硬连。
 *
 * ⚠️ 这份图是参赛作品的初始版本，正式提交前须由任课教师逐条签字确认
 *    （见 research/06-synthesis.md §1.2）。难度标签直接影响「几题够用」的结论，
 *    标注要谨慎。
 */

import type { KnowledgeGraph } from "@/lib/graph";

export const knowledgeGraph: KnowledgeGraph = {
  version: "kg-v1",
  concepts: [
    // ── 第 1 章 绪论与复杂度 ──
    { id: "c01", name: "数据结构基本概念", chapter: "第1章 绪论", summary: "逻辑结构、存储结构、数据与操作的关系" },
    { id: "c02", name: "时间复杂度分析", chapter: "第1章 绪论", summary: "用大 O 记号估算算法随规模增长的趋势" },
    { id: "c03", name: "空间复杂度分析", chapter: "第1章 绪论", summary: "估算算法额外占用的存储随规模的增长" },
    { id: "c04", name: "渐进分析方法", chapter: "第1章 绪论", summary: "区分最好、最坏、平均情况，会做递推式估算" },

    // ── 第 2 章 线性表 ──
    { id: "c05", name: "顺序表", chapter: "第2章 线性表", summary: "用连续空间存线性表，随机访问 O(1)、插删 O(n)" },
    { id: "c06", name: "单链表", chapter: "第2章 线性表", summary: "用指针串联结点，插删 O(1) 但访问需遍历" },
    { id: "c07", name: "双向链表与循环链表", chapter: "第2章 线性表", summary: "带前驱指针或首尾相接的链表变体及其取舍" },
    { id: "c08", name: "静态链表", chapter: "第2章 线性表", summary: "用数组模拟指针，理解游标的作用" },

    // ── 第 3 章 栈与队列 ──
    { id: "c09", name: "栈", chapter: "第3章 栈与队列", summary: "后进先出的受限线性表，理解栈顶与入出栈" },
    { id: "c10", name: "队列", chapter: "第3章 栈与队列", summary: "先进先出，理解队头队尾与循环队列的判空判满" },
    { id: "c11", name: "栈的应用", chapter: "第3章 栈与队列", summary: "括号匹配、表达式求值、递归转非递归" },
    { id: "c12", name: "递归", chapter: "第3章 栈与队列", summary: "递归三要素与递归调用的栈帧过程" },

    // ── 第 4 章 串 ──
    { id: "c13", name: "串的存储与基本运算", chapter: "第4章 串", summary: "串的顺序/链式存储与求子串、比较等运算" },
    { id: "c14", name: "KMP 模式匹配", chapter: "第4章 串", summary: "用 next 数组避免主串指针回溯，O(n+m)" },

    // ── 第 5 章 树与二叉树 ──
    { id: "c15", name: "树的基本概念", chapter: "第5章 树与二叉树", summary: "结点、度、层次、深度等术语与树的表示" },
    { id: "c16", name: "二叉树的性质", chapter: "第5章 树与二叉树", summary: "第 i 层最多结点数、n0=n2+1 等性质" },
    { id: "c17", name: "二叉树的存储结构", chapter: "第5章 树与二叉树", summary: "顺序存储与二叉链表，理解空指针域" },
    { id: "c18", name: "二叉树遍历", chapter: "第5章 树与二叉树", summary: "先中后序与层次遍历，会由两种序列还原树" },
    { id: "c19", name: "线索二叉树", chapter: "第5章 树与二叉树", summary: "用空指针域存前驱后继，实现不用栈的遍历" },
    { id: "c20", name: "树与森林的转换", chapter: "第5章 树与二叉树", summary: "孩子兄弟表示法与树、森林、二叉树的对应" },
    { id: "c21", name: "哈夫曼树与编码", chapter: "第5章 树与二叉树", summary: "带权路径长度最小与前缀编码的构造" },

    // ── 第 6 章 图 ──
    { id: "c22", name: "图的基本概念", chapter: "第6章 图", summary: "有向无向、度、连通性、完全图等术语" },
    { id: "c23", name: "图的存储结构", chapter: "第6章 图", summary: "邻接矩阵与邻接表的适用场景与空间代价" },
    { id: "c24", name: "图的遍历", chapter: "第6章 图", summary: "DFS 与 BFS 的过程、复杂度与生成树" },
    { id: "c25", name: "最小生成树", chapter: "第6章 图", summary: "Prim 与 Kruskal 的贪心过程与适用图型" },
    { id: "c26", name: "最短路径", chapter: "第6章 图", summary: "Dijkstra、Floyd 的适用条件与复杂度" },
    { id: "c27", name: "拓扑排序", chapter: "第6章 图", summary: "AOV 网、入度法与 DFS 法，判断有向图有无环" },
    { id: "c28", name: "关键路径", chapter: "第6章 图", summary: "AOE 网、最早/最迟开始时间与时间余量" },

    // ── 第 7 章 查找 ──
    { id: "c29", name: "顺序查找与折半查找", chapter: "第7章 查找", summary: "折半查找的前提、判定树与平均查找长度" },
    { id: "c30", name: "分块查找", chapter: "第7章 查找", summary: "索引顺序表的块间与块内查找" },
    { id: "c31", name: "二叉排序树", chapter: "第7章 查找", summary: "中序有序、插入删除规则与查找效率" },
    { id: "c32", name: "平衡二叉树 AVL", chapter: "第7章 查找", summary: "平衡因子与四种旋转，理解为何要平衡" },
    { id: "c33", name: "B 树与 B+ 树", chapter: "第7章 查找", summary: "多路平衡查找树，理解其在磁盘索引中的用途" },
    { id: "c34", name: "哈希表", chapter: "第7章 查找", summary: "哈希函数、冲突处理与装填因子对性能的影响" },

    // ── 第 8 章 排序 ──
    { id: "c35", name: "排序基本概念", chapter: "第8章 排序", summary: "稳定性、内/外排序、比较次数的意义" },
    { id: "c36", name: "插入类排序", chapter: "第8章 排序", summary: "直接插入与希尔排序的过程与复杂度" },
    { id: "c37", name: "交换类排序", chapter: "第8章 排序", summary: "冒泡与快速排序，理解快排的分治与最坏情况" },
    { id: "c38", name: "选择类排序", chapter: "第8章 排序", summary: "简单选择与堆排序，理解建堆与调整" },
    { id: "c39", name: "归并排序", chapter: "第8章 排序", summary: "二路归并的分治过程与 O(n) 额外空间" },
    { id: "c40", name: "排序算法比较", chapter: "第8章 排序", summary: "从时间、空间、稳定性三维度选排序算法" },
  ],
  edges: [
    // 复杂度一章内部
    { before: "c01", after: "c02" },
    { before: "c02", after: "c03" },
    { before: "c02", after: "c04" },
    { before: "c03", after: "c04" },

    // 线性表
    { before: "c01", after: "c05" },
    { before: "c05", after: "c06" },
    { before: "c06", after: "c07" },
    { before: "c05", after: "c08" },
    { before: "c02", after: "c05" },

    // 栈与队列
    { before: "c05", after: "c09" },
    { before: "c05", after: "c10" },
    { before: "c09", after: "c11" },
    { before: "c09", after: "c12" },
    { before: "c11", after: "c12" },

    // 串
    { before: "c05", after: "c13" },
    { before: "c13", after: "c14" },
    { before: "c02", after: "c14" },

    // 树
    { before: "c01", after: "c15" },
    { before: "c15", after: "c16" },
    { before: "c16", after: "c17" },
    { before: "c17", after: "c18" },
    { before: "c18", after: "c19" },
    { before: "c12", after: "c18" },
    { before: "c15", after: "c20" },
    { before: "c16", after: "c20" },
    { before: "c16", after: "c21" },
    { before: "c18", after: "c21" },

    // 图
    { before: "c15", after: "c22" },
    { before: "c22", after: "c23" },
    { before: "c23", after: "c24" },
    { before: "c09", after: "c24" },
    { before: "c10", after: "c24" },
    { before: "c24", after: "c25" },
    { before: "c24", after: "c26" },
    { before: "c27", after: "c28" },
    { before: "c24", after: "c27" },

    // 查找
    { before: "c05", after: "c29" },
    { before: "c29", after: "c30" },
    { before: "c18", after: "c31" },
    { before: "c31", after: "c32" },
    { before: "c32", after: "c33" },
    { before: "c29", after: "c34" },
    { before: "c06", after: "c34" },

    // 排序
    { before: "c01", after: "c35" },
    { before: "c35", after: "c36" },
    { before: "c35", after: "c37" },
    { before: "c35", after: "c38" },
    { before: "c35", after: "c39" },
    { before: "c12", after: "c39" },
    { before: "c36", after: "c40" },
    { before: "c37", after: "c40" },
    { before: "c38", after: "c40" },
    { before: "c39", after: "c40" },

    // 跨章依赖：这些是学生最常卡住的地方
    { before: "c07", after: "c19" },
    { before: "c18", after: "c24" },
    { before: "c26", after: "c28" },
    { before: "c02", after: "c40" },
    { before: "c04", after: "c26" },
    { before: "c04", after: "c37" },
    { before: "c21", after: "c34" },
  ],
};
