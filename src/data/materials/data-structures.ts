/**
 * 数据结构内置资料包：第 3 章（栈与队列）与第 4 章（串）。
 *
 * 章名必须与 src/data/knowledge-graph.ts 中的 chapter 字面量完全一致，
 * 否则章节相等这一排序键会整体失效——界面上看起来「教材片段总是排在后面」，
 * 实际是字符串差了一个空格。改图谱章节名时必须同步改这里。
 *
 * 来源只放两本（教材 + 课堂讲义）：内置包的用途是给生成链路提供可核对的原文，
 * 不是做资料库；来源越多，学生越难判断该信哪一个。
 */

import type { MaterialPack } from "@/lib/materials";

export const dataStructuresMaterialPack: MaterialPack = {
  id: "data-structures",
  title: "数据结构（栈、队列与串）",
  sources: [
    {
      id: "ds-textbook",
      kind: "textbook",
      title: "数据结构（C 语言版）",
      author: "严蔚敏、吴伟民",
      publisher: "清华大学出版社",
      edition: "第 2 版",
      year: 2007,
      note: "覆盖第 3 章栈与队列、第 4 章串，页码为纸质书页码",
    },
    {
      id: "ds-lecture",
      kind: "lecture",
      title: "数据结构课堂讲义（第 3–4 章）",
      author: "课程组",
      note: "按课时编排，页码为讲义页码，与教材页码不通用",
    },
  ],
  chunks: [
    {
      id: "ds-c09-text-1",
      sourceId: "ds-textbook",
      kcIds: ["c09"],
      chapter: "第3章 栈与队列",
      section: "3.1 栈的定义与基本操作",
      pageFrom: 45,
      pageTo: 46,
      text:
        "栈是限定仅在表尾进行插入或删除操作的线性表。表尾称为栈顶，表头称为栈底，不含元素的栈称为空栈。" +
        "栈的修改遵循后进先出的原则，因此栈又称后进先出表。" +
        "在顺序栈中，通常用一维数组存放栈元素，同时设一个栈顶指针 top 指示栈顶元素的位置：" +
        "top 的初值设为 -1 表示空栈，入栈时先令 top 加 1 再存入元素，出栈时先取元素再令 top 减 1。",
    },
    {
      id: "ds-c09-text-2",
      sourceId: "ds-textbook",
      kcIds: ["c09"],
      chapter: "第3章 栈与队列",
      section: "3.2 栈的表示与实现",
      pageFrom: 47,
      pageTo: 48,
      text:
        "顺序栈的入栈操作需先判断是否栈满，若 top 已达到数组上界则上溢；出栈需先判断是否栈空，若 top 等于 -1 则下溢。" +
        "链栈通常以链表头部作为栈顶，入栈与出栈都在表头进行，时间复杂度为 O(1)，且一般不存在栈满问题。",
    },
    {
      id: "ds-c09-lect-1",
      sourceId: "ds-lecture",
      kcIds: ["c09"],
      chapter: "第3章 栈与队列",
      section: "3.1 顺序栈的指针约定",
      pageFrom: 12,
      pageTo: 13,
      text:
        "顺序栈的另一种约定是把栈顶指针指向栈顶元素的下一个空位：top 初值为 0 表示空栈，" +
        "入栈时先写入 data[top] 再令 top 加 1，出栈时先令 top 减 1 再取 data[top]。" +
        "两种约定的操作顺序正好相反，读代码时先确认 top 的含义，否则入栈出栈会整体错位一格。",
    },
    {
      id: "ds-c10-text-1",
      sourceId: "ds-textbook",
      kcIds: ["c10"],
      chapter: "第3章 栈与队列",
      section: "3.3 队列的定义与顺序存储",
      pageFrom: 62,
      pageTo: 64,
      text:
        "队列是只允许在一端进行插入、在另一端进行删除的线性表。允许插入的一端称为队尾，允许删除的一端称为队头。" +
        "队列遵循先进先出的原则。顺序队列用一维数组存放，设队头指针 front 与队尾指针 rear；" +
        "为充分利用空间，通常把数组看成首尾相接的循环队列，并约定少用一个元素空间来区分队空与队满：" +
        "front == rear 时队空，(rear + 1) % MAXSIZE == front 时队满。",
    },
    {
      id: "ds-c10-lect-1",
      sourceId: "ds-lecture",
      kcIds: ["c10"],
      chapter: "第3章 栈与队列",
      section: "3.2 循环队列的判空判满",
      pageFrom: 14,
      pageTo: 16,
      text:
        "循环队列的容量为 MAXSIZE 时，实际最多存放 MAXSIZE − 1 个元素。" +
        "入队：rear = (rear + 1) % MAXSIZE；出队：front = (front + 1) % MAXSIZE。" +
        "若额外用计数器 size 记录元素个数，则可以不浪费那一个空间，队满条件写成 size == MAXSIZE。",
    },
    {
      id: "ds-c11-text-1",
      sourceId: "ds-textbook",
      kcIds: ["c11"],
      chapter: "第3章 栈与队列",
      section: "3.4 栈的应用举例",
      pageFrom: 52,
      pageTo: 54,
      text:
        "括号匹配：遇到左括号入栈，遇到右括号时弹出栈顶并检查是否配对；扫描结束时栈为空才算匹配成功，" +
        "中途栈空或最终栈非空都说明括号不配对。" +
        "表达式求值：中缀表达式先转换为后缀表达式，转换与计算都借助栈完成，运算符栈保证优先级高的先出栈。",
    },
    {
      id: "ds-c11-lect-1",
      sourceId: "ds-lecture",
      kcIds: ["c11"],
      chapter: "第3章 栈与队列",
      section: "3.3 栈与递归",
      pageFrom: 17,
      pageTo: 18,
      text:
        "递归调用在运行时借助系统栈保存返回地址、参数与局部变量，递归深度等于栈帧的最大嵌套层数。" +
        "把递归改写为非递归时，可以用显式栈模拟这一过程；尾递归可以直接改成循环，不需要额外的栈空间。",
    },
    {
      id: "ds-c14-text-1",
      sourceId: "ds-textbook",
      kcIds: ["c14"],
      chapter: "第4章 串",
      section: "4.3 串的模式匹配",
      pageFrom: 79,
      pageTo: 82,
      text:
        "朴素模式匹配在主串指针失配后要回溯到本趟起始位置的下一位，最坏时间复杂度为 O(n·m)。" +
        "KMP 算法利用模式串自身的部分匹配信息构造 next 数组；失配时主串指针不回溯，" +
        "只把模式串指针移动到 next[j] 指示的位置，时间复杂度降为 O(n+m)。" +
        "next[j] 表示模式串前 j 个字符组成的子串中最长相等前后缀的长度。",
    },
    {
      id: "ds-c14-lect-1",
      sourceId: "ds-lecture",
      kcIds: ["c13", "c14"],
      chapter: "第4章 串",
      section: "4.1 串的存储与 KMP 引入",
      pageFrom: 22,
      pageTo: 25,
      text:
        "串的顺序存储用一组地址连续的单元存放字符序列，可在末尾加结束标记；链式存储每个结点存放一个或多个字符。" +
        "求子串、串比较等运算依赖串长。KMP 的 next 数组只与模式串有关，与主串无关，因此可以预先计算。",
    },
  ],
  claims: [
    {
      id: "ds-claim-top-a",
      kcId: "c09",
      topic: "栈顶指针的含义",
      statement: "栈顶指针指向栈顶元素",
      basis: "textbook",
      sourceId: "ds-textbook",
      pageFrom: 45,
      pageTo: 45,
    },
    {
      id: "ds-claim-top-b",
      kcId: "c09",
      topic: "栈顶指针的含义",
      statement: "栈顶指针指向栈顶元素的下一个空位",
      basis: "lecture",
      sourceId: "ds-lecture",
      pageFrom: 12,
      pageTo: 12,
    },
    {
      id: "ds-claim-queue-full",
      kcId: "c10",
      topic: "循环队列的判满条件",
      statement: "少用一个元素空间，队满为 (rear + 1) % MAXSIZE == front",
      basis: "textbook",
      sourceId: "ds-textbook",
      pageFrom: 64,
      pageTo: 64,
    },
    {
      id: "ds-claim-kmp-cost",
      kcId: "c14",
      topic: "KMP 的时间复杂度",
      statement: "KMP 的时间复杂度为 O(n+m)，主串指针不回溯",
      basis: "textbook",
      sourceId: "ds-textbook",
      pageFrom: 82,
      pageTo: 82,
    },
  ],
};
