/**
 * Python 程序设计知识图谱与题库：40 个知识点 / 60 条先修边 / 120 题。
 *
 * 课程依据：国内高校《Python 程序设计》通用教学大纲（零基础到面向对象）。
 * 每条边都是「不掌握前者，后者学不动」的真实依赖，不是按章节顺序硬连。
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";

export const pythonGraph: KnowledgeGraph = {
  version: "kg-python-v1",
  concepts: [
    // ── 第 1 章 Python 语言基础 ──
    { id: "p01", name: "Python 语言特点与执行过程", chapter: "第1章 Python 语言基础", summary: "解释执行、字节码与 Python 虚拟机的工作方式" },
    { id: "p02", name: "变量与动态类型", chapter: "第1章 Python 语言基础", summary: "变量是对象引用，理解 id、可变与不可变对象" },
    { id: "p03", name: "运算符与表达式", chapter: "第1章 Python 语言基础", summary: "算术、比较、逻辑运算符与优先级、结合性" },
    { id: "p04", name: "输入输出与格式化", chapter: "第1章 Python 语言基础", summary: "input、print 的参数与 f-string 格式化" },

    // ── 第 2 章 基本数据类型与字符串 ──
    { id: "p05", name: "数值类型", chapter: "第2章 基本数据类型与字符串", summary: "int 任意精度、float 二进制误差与类型转换" },
    { id: "p06", name: "字符串基本操作", chapter: "第2章 基本数据类型与字符串", summary: "索引切片、不可变性与常用字符串方法" },
    { id: "p07", name: "字符串格式化", chapter: "第2章 基本数据类型与字符串", summary: "format 与 f-string 的对齐、精度和百分比格式" },

    // ── 第 3 章 组合数据类型 ──
    { id: "p08", name: "列表", chapter: "第3章 组合数据类型", summary: "增删改查、切片、排序与浅拷贝陷阱" },
    { id: "p09", name: "元组", chapter: "第3章 组合数据类型", summary: "不可变序列、解包与作为字典键的条件" },
    { id: "p10", name: "字典", chapter: "第3章 组合数据类型", summary: "键值映射、键的可哈希性与遍历方式" },
    { id: "p11", name: "集合", chapter: "第3章 组合数据类型", summary: "去重、集合运算与元素可哈希的要求" },

    // ── 第 4 章 流程控制 ──
    { id: "p12", name: "条件语句", chapter: "第4章 流程控制", summary: "if/elif/else、缩进规则与真值测试" },
    { id: "p13", name: "循环语句", chapter: "第4章 流程控制", summary: "for/while、range、break/continue 与循环 else" },
    { id: "p14", name: "推导式", chapter: "第4章 流程控制", summary: "列表、字典、集合推导式的语法与执行顺序" },

    // ── 第 5 章 函数与函数式编程 ──
    { id: "p15", name: "迭代器与可迭代对象", chapter: "第5章 函数与函数式编程", summary: "iter/next、StopIteration 与一次性遍历" },
    { id: "p16", name: "生成器与 yield", chapter: "第5章 函数与函数式编程", summary: "惰性求值、暂停恢复与生成器表达式" },
    { id: "p17", name: "函数定义与参数", chapter: "第5章 函数与函数式编程", summary: "位置、默认、关键字、可变参数与默认值陷阱" },
    { id: "p18", name: "作用域与 LEGB", chapter: "第5章 函数与函数式编程", summary: "局部、嵌套、全局、内置作用域与闭包" },
    { id: "p19", name: "匿名函数与高阶函数", chapter: "第5章 函数与函数式编程", summary: "lambda、map/filter 与 sorted 的 key 参数" },
    { id: "p20", name: "装饰器", chapter: "第5章 函数与函数式编程", summary: "函数是一等对象、闭包与 @ 语法糖" },
    { id: "p21", name: "递归", chapter: "第5章 函数与函数式编程", summary: "基线条件、递归深度与重复子问题" },

    // ── 第 6 章 模块、异常与文件 ──
    { id: "p22", name: "模块与包", chapter: "第6章 模块、异常与文件", summary: "import 机制、__name__ 与包的组织结构" },
    { id: "p23", name: "常用标准库", chapter: "第6章 模块、异常与文件", summary: "math、random、datetime 与 json 的典型用法" },
    { id: "p24", name: "异常处理", chapter: "第6章 模块、异常与文件", summary: "try/except/else/finally 与异常传播" },
    { id: "p25", name: "自定义异常与断言", chapter: "第6章 模块、异常与文件", summary: "raise、异常类继承与 assert 的适用场景" },
    { id: "p26", name: "文件读写", chapter: "第6章 模块、异常与文件", summary: "open 模式、with 语句、编码与逐行读取" },
    { id: "p27", name: "CSV 与 JSON 文件处理", chapter: "第6章 模块、异常与文件", summary: "结构化数据的序列化、持久化与类型转换" },

    // ── 第 7 章 面向对象编程 ──
    { id: "p28", name: "类与对象", chapter: "第7章 面向对象编程", summary: "class、__init__、self 与实例属性" },
    { id: "p29", name: "方法与属性", chapter: "第7章 面向对象编程", summary: "实例方法、类方法、静态方法与 property" },
    { id: "p30", name: "继承与多态", chapter: "第7章 面向对象编程", summary: "super、方法重写、多态与 MRO" },
    { id: "p31", name: "特殊方法与运算符重载", chapter: "第7章 面向对象编程", summary: "__str__、__eq__、__len__ 等协议方法" },
    { id: "p32", name: "封装与数据类", chapter: "第7章 面向对象编程", summary: "命名约定、名称改写与 @dataclass" },
    { id: "p33", name: "迭代协议与上下文管理器", chapter: "第7章 面向对象编程", summary: "__iter__/__next__ 与 __enter__/__exit__" },

    // ── 第 8 章 进阶与工程实践 ──
    { id: "p34", name: "常用算法与复杂度", chapter: "第8章 进阶与工程实践", summary: "查找排序的复杂度与用哈希表优化枚举" },
    { id: "p35", name: "正则表达式", chapter: "第8章 进阶与工程实践", summary: "re 模块的匹配、分组与贪婪规则" },
    { id: "p36", name: "虚拟环境与包管理", chapter: "第8章 进阶与工程实践", summary: "venv、pip 与依赖清单的隔离管理" },
    { id: "p37", name: "调试与测试", chapter: "第8章 进阶与工程实践", summary: "断言、单元测试与断点调试的基本方法" },
    { id: "p38", name: "类型注解", chapter: "第8章 进阶与工程实践", summary: "类型提示、泛型容器与静态检查" },
    { id: "p39", name: "并发编程基础", chapter: "第8章 进阶与工程实践", summary: "GIL、线程、进程与 asyncio 的适用场景" },
    { id: "p40", name: "综合项目实践", chapter: "第8章 进阶与工程实践", summary: "需求拆解、模块划分与可维护的项目结构" },
  ],
  edges: [
    // 第 1 章
    { before: "p01", after: "p02" },
    { before: "p02", after: "p03" },
    { before: "p03", after: "p04" },

    // 基本数据类型
    { before: "p02", after: "p05" },
    { before: "p03", after: "p05" },
    { before: "p03", after: "p06" },
    { before: "p06", after: "p07" },
    { before: "p05", after: "p07" },

    // 组合数据类型
    { before: "p02", after: "p08" },
    { before: "p06", after: "p08" },
    { before: "p08", after: "p09" },
    { before: "p08", after: "p10" },
    { before: "p09", after: "p10" },
    { before: "p06", after: "p10" },
    { before: "p10", after: "p11" },
    { before: "p08", after: "p11" },

    // 流程控制
    { before: "p03", after: "p12" },
    { before: "p12", after: "p13" },
    { before: "p13", after: "p14" },
    { before: "p08", after: "p14" },

    // 函数与函数式编程
    { before: "p13", after: "p15" },
    { before: "p15", after: "p16" },
    { before: "p14", after: "p16" },
    { before: "p02", after: "p17" },
    { before: "p17", after: "p18" },
    { before: "p18", after: "p19" },
    { before: "p19", after: "p20" },
    { before: "p18", after: "p20" },
    { before: "p17", after: "p21" },
    { before: "p12", after: "p21" },

    // 模块、异常与文件
    { before: "p17", after: "p22" },
    { before: "p01", after: "p22" },
    { before: "p22", after: "p23" },
    { before: "p17", after: "p23" },
    { before: "p12", after: "p24" },
    { before: "p24", after: "p25" },
    { before: "p24", after: "p26" },
    { before: "p26", after: "p27" },
    { before: "p10", after: "p27" },

    // 面向对象
    { before: "p02", after: "p28" },
    { before: "p17", after: "p28" },
    { before: "p28", after: "p29" },
    { before: "p29", after: "p30" },
    { before: "p28", after: "p30" },
    { before: "p30", after: "p31" },
    { before: "p29", after: "p32" },
    { before: "p31", after: "p33" },
    { before: "p15", after: "p33" },
    { before: "p26", after: "p33" },

    // 进阶与工程实践
    { before: "p08", after: "p34" },
    { before: "p06", after: "p35" },
    { before: "p22", after: "p36" },
    { before: "p24", after: "p37" },
    { before: "p17", after: "p37" },
    { before: "p17", after: "p38" },
    { before: "p17", after: "p39" },
    { before: "p15", after: "p39" },
    { before: "p22", after: "p40" },
    { before: "p28", after: "p40" },
    { before: "p37", after: "p40" },
  ],
};

export const pythonQuestions: readonly Question[] = [
  // ── p01 Python 语言特点与执行过程 ──
  { id: "q-p01-1", kcId: "p01", difficulty: 1, stem: "「Python 是解释型语言」通常是指：", options: ["源代码逐条翻译为字节码，由 Python 虚拟机解释执行", "源代码直接编译成机器码后独立运行", "不需要任何编译或转换", "只能在浏览器中运行"], answerIndex: 0, explanation: "CPython 先把源码编译为字节码，再由虚拟机逐条解释执行，因此称为解释型；它不直接生成独立可执行文件，也不是完全不做任何转换。" },
  { id: "q-p01-2", kcId: "p01", difficulty: 2, stem: "执行一个 .py 文件时，Python 通常会：", options: ["先编译为字节码，再交给虚拟机执行", "直接逐字符执行源代码，不产生任何中间形式", "生成与 C 语言相同的目标文件", "把整个文件编译为机器码并写入磁盘"], answerIndex: 0, explanation: "Python 解释器先做词法语法分析并生成字节码，必要时缓存为 .pyc，然后由虚拟机执行；它不会生成机器码目标文件，也不是逐字符直接执行。" },
  { id: "q-p01-3", kcId: "p01", difficulty: 3, stem: "「Python 是动态类型语言」的准确含义是：", options: ["变量不需要声明类型，类型属于运行时绑定的对象", "变量的类型在赋值后永远不能改变", "所有变量都自动转为字符串", "Python 没有类型系统"], answerIndex: 0, explanation: "Python 的变量只是名字到对象的引用，类型属于对象而非变量，同一名字可以先后指向不同类型的对象；但对象本身有明确类型，运行时仍会做类型检查。" },

  // ── p02 变量与动态类型 ──
  { id: "q-p02-1", kcId: "p02", difficulty: 1, stem: "执行 a=[1,2]; b=a; b.append(3) 后，a 的值是：", options: ["[1,2]", "[1,2,3]", "[3,1,2]", "报错"], answerIndex: 1, explanation: "b=a 只是让 b 指向同一个列表对象，并不复制列表，因此通过 b 追加元素后 a 看到的内容也变成 [1,2,3]；若要独立副本需要显式复制。" },
  { id: "q-p02-2", kcId: "p02", difficulty: 2, stem: "关于 == 和 is，下列说法正确的是：", options: ["== 比较值是否相等，is 比较是否为同一对象", "两者完全等价", "is 比较值，== 比较身份", "== 只能用于数字"], answerIndex: 0, explanation: "== 调用对象的相等比较逻辑判断值是否相等，is 判断两个名字是否引用同一对象（身份）；小整数缓存等场景下二者可能同时为真，但语义不同。" },
  { id: "q-p02-3", kcId: "p02", difficulty: 3, stem: "执行 a=1; b=a; a=2 后，b 的值是：", options: ["1", "2", "None", "报错"], answerIndex: 0, explanation: "整数是不可变对象，a=2 只是让 a 重新指向新对象 2，原来的对象 1 仍被 b 引用，因此 b 仍为 1；这与列表原地修改的行为形成对比。" },

  // ── p03 运算符与表达式 ──
  { id: "q-p03-1", kcId: "p03", difficulty: 1, stem: "表达式 7//2 与 7%2 的值分别是：", options: ["3 和 1", "3.5 和 1", "3 和 0", "2 和 3"], answerIndex: 0, explanation: "// 是向下取整的整除，7//2=3；% 是取余，7%2=1。若用 / 则得到浮点数 3.5，三者不能混用。" },
  { id: "q-p03-2", kcId: "p03", difficulty: 2, stem: "表达式 -7//2 的值是：", options: ["-3", "-4", "3", "-3.5"], answerIndex: 1, explanation: "Python 的 // 向负无穷方向取整，-7/2=-3.5 向下取整为 -4；这一点与 C 语言向零截断得到 -3 不同，取余结果也随之不同。" },
  { id: "q-p03-3", kcId: "p03", difficulty: 3, stem: "表达式 2**3**2 的值是：", options: ["64", "512", "36", "12"], answerIndex: 1, explanation: "幂运算 ** 是右结合的，先算 3**2=9，再算 2**9=512；若从左往右算会得到 8**2=64，这是优先级与结合性常见的陷阱。" },

  // ── p04 输入输出与格式化 ──
  { id: "q-p04-1", kcId: "p04", difficulty: 1, stem: "input() 函数的返回值类型是：", options: ["int", "str", "float", "由输入内容自动推断"], answerIndex: 1, explanation: "input 始终返回字符串，即使用户输入的是数字；若要参与算术运算，必须用 int() 或 float() 显式转换，否则会得到字符串拼接或类型错误。" },
  { id: "q-p04-2", kcId: "p04", difficulty: 2, stem: "print(1, 2, sep=\"-\") 的输出是：", options: ["1 2", "1-2", "12", "1,2"], answerIndex: 1, explanation: "sep 指定多个输出项之间的分隔符，默认是空格，这里设为短横线，因此输出 1-2；end 参数才控制结尾字符，两者不要混淆。" },
  { id: "q-p04-3", kcId: "p04", difficulty: 3, stem: "f-string 表达式 f\"{3.14159:.2f}\" 的结果是：", options: ["3.14", "3.14159", "3.1", "3.142"], answerIndex: 0, explanation: "格式说明符 .2f 表示保留两位小数的定点数，因此对 3.14159 四舍五入得到 3.14；若只写 .2 则可能按有效数字处理，含义不同。" },

  // ── p05 数值类型 ──
  { id: "q-p05-1", kcId: "p05", difficulty: 1, stem: "关于 Python 的 int 类型，下列说法正确的是：", options: ["整数精度受机器字长限制", "整数可以表示任意大的数，仅受内存限制", "整数最大只能到 2³¹−1", "整数运算会自动溢出为浮点数"], answerIndex: 1, explanation: "Python 3 的 int 是任意精度整数，位数随数值增大自动扩展，因此 2**100 也能精确表示；不存在固定 32 位或 64 位的溢出问题。" },
  { id: "q-p05-2", kcId: "p05", difficulty: 2, stem: "表达式 6/3 的结果类型和值是：", options: ["int，值为 2", "float，值为 2.0", "str，值为 \"2\"", "报错"], answerIndex: 1, explanation: "Python 3 中 / 总是执行真除法并返回 float，即使能整除也得到 2.0；若要得到整数应使用 //，即 6//3 的结果为 int 2。" },
  { id: "q-p05-3", kcId: "p05", difficulty: 3, stem: "表达式 0.1+0.2==0.3 的值是：", options: ["True", "False", "报错", "None"], answerIndex: 1, explanation: "0.1 和 0.2 无法用二进制浮点精确表示，相加结果为 0.30000000000000004，因此不等于 0.3；比较浮点数通常用 math.isclose 或允许误差。" },

  // ── p06 字符串基本操作 ──
  { id: "q-p06-1", kcId: "p06", difficulty: 1, stem: "表达式 \"Python\"[1:4] 的结果是：", options: ["Pyt", "yth", "ytho", "tho"], answerIndex: 1, explanation: "切片遵循左闭右开，从下标 1 取到下标 3，即字符 y、t、h，结果为 yth；包含下标 4 的 h 是常见错误。" },
  { id: "q-p06-2", kcId: "p06", difficulty: 2, stem: "执行 s=\"abc\"; s[0]=\"A\" 的结果是：", options: ["s 变为 \"Abc\"", "抛出 TypeError", "s 保持不变但不报错", "s 变为 \"abcA\""], answerIndex: 1, explanation: "字符串是不可变对象，不能通过下标赋值修改其中字符，会抛出 TypeError；若要修改只能创建新字符串，例如 s=\"A\"+s[1:]。" },
  { id: "q-p06-3", kcId: "p06", difficulty: 3, stem: "表达式 \"  hi  \".strip() 的结果是：", options: ["\"hi\"", "\"  hi\"", "\"hi  \"", "\"  hi  \""], answerIndex: 0, explanation: "strip 默认删除字符串两端的空白字符（空格、制表符、换行等），中间的空格保留，因此结果为 hi；只删左侧用 lstrip，只删右侧用 rstrip。" },

  // ── p07 字符串格式化 ──
  { id: "q-p07-1", kcId: "p07", difficulty: 1, stem: "表达式 \"{}-{}\".format(1, 2) 的结果是：", options: ["\"1-2\"", "\"{}-{}\"", "\"12\"", "报错"], answerIndex: 0, explanation: "format 按顺序把参数填入占位符 {}，两个占位符之间保留短横线，因此得到 1-2；也可用 {0}、{1} 指定参数下标。" },
  { id: "q-p07-2", kcId: "p07", difficulty: 2, stem: "表达式 f\"{42:>5}\" 的结果是：", options: ["\"   42\"", "\"42   \"", "\"00042\"", "\"42\""], answerIndex: 0, explanation: "> 表示右对齐，宽度 5，数字 42 占两位，因此左侧补三个空格得到「   42」；< 是左对齐，^ 是居中，0 填充需要显式写 0。" },
  { id: "q-p07-3", kcId: "p07", difficulty: 3, stem: "表达式 f\"{0.256:.1%}\" 的结果是：", options: ["\"25.6%\"", "\"0.3%\"", "\"0.256%\"", "\"26%\""], answerIndex: 0, explanation: "% 格式说明符会先把数值乘以 100 再加百分号，.1 表示保留一位小数，因此 0.256 变为 25.6%；它不同于直接拼接字符串的 0.256%。" },

  // ── p08 列表 ──
  { id: "q-p08-1", kcId: "p08", difficulty: 1, stem: "执行 lst=[1,2]; lst.append([3,4]) 后，lst 是：", options: ["[1,2,3,4]", "[1,2,[3,4]]", "[[3,4],1,2]", "报错"], answerIndex: 1, explanation: "append 把整个参数作为一个元素追加到末尾，因此嵌套列表成为第 3 个元素；若要合并其中的元素应使用 extend，结果为 [1,2,3,4]。" },
  { id: "q-p08-2", kcId: "p08", difficulty: 2, stem: "执行 lst=[1,2,3,4]; lst[1:3]=[] 后，lst 是：", options: ["[1,4]", "[1,2,4]", "[1,3,4]", "[1,2,3]"], answerIndex: 0, explanation: "切片赋值把下标 1 到 2（左闭右开）的元素替换为空序列，相当于删除 2 和 3，因此剩下 [1,4]；切片赋值可以改变列表长度。" },
  { id: "q-p08-3", kcId: "p08", difficulty: 3, stem: "执行 a=[[1,2]]; b=a[:]; b[0].append(3) 后，a 是：", options: ["[[1,2]]", "[[1,2,3]]", "[[1,2],[1,2,3]]", "报错"], answerIndex: 1, explanation: "a[:] 是浅拷贝，只复制外层列表，内层列表仍被两个列表共享；修改 b[0] 会同时反映到 a[0]，因此 a 也变成 [[1,2,3]]。" },

  // ── p09 元组 ──
  { id: "q-p09-1", kcId: "p09", difficulty: 1, stem: "下列写法表示单元素元组的是：", options: ["(1)", "(1,)", "tuple(1)", "[1]"], answerIndex: 1, explanation: "单元素元组必须在元素后加逗号，否则 (1) 只是带括号的整数 1；tuple(1) 会因整数不可迭代而报错，[1] 是列表。" },
  { id: "q-p09-2", kcId: "p09", difficulty: 2, stem: "执行 a,b=1,2; a,b=b,a 后，a 和 b 的值是：", options: ["a=1,b=2", "a=2,b=1", "a=2,b=2", "报错"], answerIndex: 1, explanation: "右侧先构造元组 (2,1)，再按位置解包赋给 a、b，因此完成交换；这利用了元组解包，不需要临时变量。" },
  { id: "q-p09-3", kcId: "p09", difficulty: 3, stem: "元组可以作为字典的键，而列表不能，根本原因是：", options: ["元组不可变且可哈希，列表可变不可哈希", "元组比列表短", "元组只能存数字", "字典只接受元组"], answerIndex: 0, explanation: "字典用哈希值定位键，要求键的哈希值在生命周期内不变；元组不可变因而是可哈希的（元素也都可哈希时），列表可变会破坏哈希，故不能作键。" },

  // ── p10 字典 ──
  { id: "q-p10-1", kcId: "p10", difficulty: 1, stem: "对于 d={\"a\":1}，执行 d[\"b\"] 的结果是：", options: ["返回 None", "返回 0", "抛出 KeyError", "自动创建 d[\"b\"]=None"], answerIndex: 2, explanation: "用下标访问不存在的键会抛出 KeyError；若希望键不存在时返回默认值，应使用 d.get(\"b\")，它默认返回 None 且不会修改字典。" },
  { id: "q-p10-2", kcId: "p10", difficulty: 2, stem: "关于字典的 keys() 方法，下列说法正确的是：", options: ["返回一个列表副本", "返回动态视图，字典变化后视图随之反映", "返回元组", "只能遍历一次"], answerIndex: 1, explanation: "Python 3 中 keys() 返回视图对象，不复制键，字典增删键后视图内容会变化；它可以多次遍历，但遍历时不能修改字典大小。" },
  { id: "q-p10-3", kcId: "p10", difficulty: 3, stem: "下列对象中，可以作为字典键的是：", options: ["[1,2]", "{1,2}", "(1,2)", "{\"a\":1}"], answerIndex: 2, explanation: "字典键必须可哈希，元组在元素都可哈希时可作键；列表、集合和字典都是可变对象，不可哈希，因此不能作为键。" },

  // ── p11 集合 ──
  { id: "q-p11-1", kcId: "p11", difficulty: 1, stem: "表达式 {1,2,2,3} 的结果是：", options: ["{1,2,2,3}", "{1,2,3}", "[1,2,3]", "报错"], answerIndex: 1, explanation: "集合自动去除重复元素，且不保证顺序，因此结果为 {1,2,3}；重复元素不会报错，只是被合并。" },
  { id: "q-p11-2", kcId: "p11", difficulty: 2, stem: "设 A={1,2,3}、B={2,3,4}，则 A&B 与 A|B 分别是：", options: ["{2,3} 和 {1,2,3,4}", "{1,4} 和 {2,3}", "{2,3} 和 {1,4}", "{1,2,3,4} 和 {2,3}"], answerIndex: 0, explanation: "& 求交集，两个集合共有的元素是 2、3；| 求并集，包含所有出现过的元素 1、2、3、4。差集用 -，对称差用 ^。" },
  { id: "q-p11-3", kcId: "p11", difficulty: 3, stem: "创建空集合的正确写法是：", options: ["{}", "set()", "[]", "()"], answerIndex: 1, explanation: "{} 创建的是空字典而不是空集合，[] 是空列表，() 是空元组；空集合只能用 set() 创建，这是 Python 语法中的常见陷阱。" },

  // ── p12 条件语句 ──
  { id: "q-p12-1", kcId: "p12", difficulty: 1, stem: "Python 中代码块的边界由什么决定？", options: ["花括号 {}", "缩进", "分号", "begin/end"], answerIndex: 1, explanation: "Python 用缩进表示代码块层级，同一代码块必须保持相同的缩进量；缩进错误会直接导致 IndentationError，这与 C 系语言用花括号不同。" },
  { id: "q-p12-2", kcId: "p12", difficulty: 2, stem: "下列值中，在条件判断中为假的是：", options: ["\"0\"", "[]", "0.0 之外的 1", "\"False\""], answerIndex: 1, explanation: "空列表、空字符串、空字典、0、None 等空值或零值在布尔上下文中为假；非空字符串 \"0\" 和 \"False\" 都为真，容易因字面内容误判。" },
  { id: "q-p12-3", kcId: "p12", difficulty: 3, stem: "表达式 0 < x < 10 在 Python 中的含义是：", options: ["先算 0<x 得到布尔值再与 10 比较", "等价于 0<x and x<10", "等价于 0<x or x<10", "语法错误"], answerIndex: 1, explanation: "Python 支持链式比较，0<x<10 等价于 0<x and x<10，且 x 只求值一次；它不会先把 0<x 转成布尔值再与 10 比较。" },

  // ── p13 循环语句 ──
  { id: "q-p13-1", kcId: "p13", difficulty: 1, stem: "range(1,5) 产生的整数序列是：", options: ["1,2,3,4,5", "1,2,3,4", "0,1,2,3,4", "2,3,4,5"], answerIndex: 1, explanation: "range(start, stop) 左闭右开，包含起点 1 但不包含终点 5，因此是 1、2、3、4；若要包含 5 应写 range(1,6)。" },
  { id: "q-p13-2", kcId: "p13", difficulty: 2, stem: "for 循环的 else 子句会在什么情况下执行？", options: ["循环体每次结束后都执行", "循环正常结束（未被 break 中断）时执行", "循环被 break 中断时执行", "循环体一次都不执行时跳过"], answerIndex: 1, explanation: "for-else 中的 else 属于循环结构，只有在循环完整跑完、没有触发 break 时才执行；若循环被 break 提前终止，else 不会执行。" },
  { id: "q-p13-3", kcId: "p13", difficulty: 3, stem: "执行 sum=0; for i in range(5): if i==2: continue; sum+=i 后，sum 的值是：", options: ["10", "8", "7", "12"], answerIndex: 1, explanation: "continue 跳过 i=2 这一次的累加，其余 0、1、3、4 相加得 8；若误以为 continue 会终止循环，会算出 10 或其他值。" },

  // ── p14 推导式 ──
  { id: "q-p14-1", kcId: "p14", difficulty: 1, stem: "表达式 [x*x for x in range(4)] 的结果是：", options: ["[1,4,9,16]", "[0,1,4,9]", "[0,1,2,3]", "[0,2,4,6]"], answerIndex: 1, explanation: "range(4) 产生 0 到 3，分别平方得到 0、1、4、9；若误以为从 1 开始会得到 [1,4,9,16]，这是 range 左闭右开导致的常见错误。" },
  { id: "q-p14-2", kcId: "p14", difficulty: 2, stem: "表达式 [x for x in range(10) if x%2==0] 的结果是：", options: ["[0,2,4,6,8]", "[2,4,6,8,10]", "[1,3,5,7,9]", "[0,2,4,6,8,10]"], answerIndex: 0, explanation: "先由 range(10) 产生 0 到 9，再用 if 过滤出偶数，得到 0、2、4、6、8；10 不在 range(10) 中，因此不会被包含。" },
  { id: "q-p14-3", kcId: "p14", difficulty: 3, stem: "表达式 {x: x*x for x in range(3)} 的结果是：", options: ["{0:0,1:1,2:4}", "[0,1,4]", "{0,1,4}", "{(0,0),(1,1),(2,4)}"], answerIndex: 0, explanation: "字典推导式的语法是「键: 值 for ...」，因此生成键 0、1、2 对应平方值 0、1、4 的字典；写成单个表达式得到的是集合或列表，类型不同。" },

  // ── p15 迭代器与可迭代对象 ──
  { id: "q-p15-1", kcId: "p15", difficulty: 1, stem: "对迭代器反复调用 next()，当元素耗尽时会：", options: ["返回 None", "返回空字符串", "抛出 StopIteration", "自动重新开始"], answerIndex: 2, explanation: "迭代器耗尽后再调用 next 会抛出 StopIteration，for 循环正是捕获该异常来结束遍历；它不会返回 None，也不会自动重置。" },
  { id: "q-p15-2", kcId: "p15", difficulty: 2, stem: "列表与迭代器的关系是：", options: ["列表本身就是迭代器", "列表是可迭代对象，但不是迭代器", "迭代器是列表的子类", "两者没有关系"], answerIndex: 1, explanation: "列表实现了 __iter__ 但没有 __next__，属于可迭代对象；调用 iter(列表) 才得到迭代器，迭代器同时实现 __iter__ 和 __next__。" },
  { id: "q-p15-3", kcId: "p15", difficulty: 3, stem: "对一个迭代器连续遍历两次，第二次通常：", options: ["从头再遍历一遍", "得不到任何元素", "抛出 TypeError", "自动复制元素"], answerIndex: 1, explanation: "迭代器内部保存当前位置且只能前进，第一次遍历耗尽后再次遍历不会重置，因此得不到元素；若需重复遍历应使用列表等可重复迭代的容器。" },

  // ── p16 生成器与 yield ──
  { id: "q-p16-1", kcId: "p16", difficulty: 1, stem: "生成器函数中 yield 的作用是：", options: ["终止函数并返回值", "暂停函数并产出一个值，下次恢复继续执行", "声明一个全局变量", "创建线程"], answerIndex: 1, explanation: "yield 让函数在产出值后暂停，保留局部变量和执行位置，下次 next 时从暂停处继续；return 才会终止函数，二者语义不同。" },
  { id: "q-p16-2", kcId: "p16", difficulty: 2, stem: "生成器表达式 (x*x for x in range(1000000)) 相比列表推导式的主要优势是：", options: ["计算速度一定更快", "惰性求值，不需要一次性占用大量内存", "可以重复遍历", "结果自动排序"], answerIndex: 1, explanation: "生成器表达式按需逐个产出元素，不会一次性构建包含百万个元素的列表，因此内存占用小；它只能遍历一次，速度也不一定更快。" },
  { id: "q-p16-3", kcId: "p16", difficulty: 3, stem: "调用一个包含 yield 的函数时，函数体：", options: ["立即执行到第一个 yield", "不会立即执行，而是返回生成器对象", "执行完毕后返回结果", "报错"], answerIndex: 1, explanation: "只要函数体中出现 yield，调用它就返回生成器对象，函数体要等到第一次 next 或迭代时才执行到第一个 yield；这与普通函数调用即执行不同。" },

  // ── p17 函数定义与参数 ──
  { id: "q-p17-1", kcId: "p17", difficulty: 1, stem: "定义 def f(a, b=2): 后，调用 f(1) 的结果中 b 的值是：", options: ["报错", "2", "None", "1"], answerIndex: 1, explanation: "b 有默认值 2，调用时只传一个位置参数，a 取 1，b 使用默认值 2；默认参数让调用者可以省略该参数。" },
  { id: "q-p17-2", kcId: "p17", difficulty: 2, stem: "关于 def f(*args, **kwargs)，下列说法正确的是：", options: ["args 是列表，kwargs 是字典", "args 是元组，kwargs 是字典", "args 是字典，kwargs 是元组", "两者都是列表"], answerIndex: 1, explanation: "*args 把多余的位置参数收集为元组，**kwargs 把多余的关键字参数收集为字典；它们让函数可以接收任意数量的参数。" },
  { id: "q-p17-3", kcId: "p17", difficulty: 3, stem: "执行 def f(a, lst=[]): lst.append(a); return lst，连续调用 f(1)、f(2) 后第二次的结果是：", options: ["[2]", "[1,2]", "[1]", "报错"], answerIndex: 1, explanation: "默认参数在函数定义时只求值一次，同一个列表对象被所有调用共享，因此第二次调用会在已有 [1] 上追加 2；正确做法是用 None 作为默认值再新建列表。" },

  // ── p18 作用域与 LEGB ──
  { id: "q-p18-1", kcId: "p18", difficulty: 1, stem: "在函数内部对一个变量赋值，但未声明 global，该变量属于：", options: ["全局变量", "局部变量", "内置变量", "类变量"], answerIndex: 1, explanation: "函数体内出现赋值语句会使该名字在整个函数作用域内被视为局部变量，除非用 global 或 nonlocal 声明；读取未赋值的局部变量会报 UnboundLocalError。" },
  { id: "q-p18-2", kcId: "p18", difficulty: 2, stem: "在函数内修改全局变量 count，需要：", options: ["直接 count+=1 即可", "先声明 global count", "先声明 nonlocal count", "把 count 作为参数"], answerIndex: 1, explanation: "函数内对全局变量赋值必须先用 global 声明，否则 count+=1 会把 count 当成局部变量并因未初始化而报错；nonlocal 用于嵌套函数的外层局部变量。" },
  { id: "q-p18-3", kcId: "p18", difficulty: 3, stem: "关于闭包，下列说法正确的是：", options: ["内部函数引用了外部函数的局部变量，且外部函数返回该内部函数", "闭包必须使用 global", "闭包中的变量每次调用都会重新初始化", "闭包只能返回数字"], answerIndex: 0, explanation: "闭包是内部函数加上其引用的外层局部环境，外层函数返回内部函数后，这些变量仍被保留；要修改它们需用 nonlocal，且闭包可返回任意类型。" },

  // ── p19 匿名函数与高阶函数 ──
  { id: "q-p19-1", kcId: "p19", difficulty: 1, stem: "表达式 sorted([3,1,2]) 的结果是：", options: ["[3,1,2]", "[1,2,3]", "[2,1,3]", "None"], answerIndex: 1, explanation: "sorted 返回一个新的升序列表，不修改原列表；若要原地排序应使用列表的 sort 方法，它返回 None，这也是常见混淆点。" },
  { id: "q-p19-2", kcId: "p19", difficulty: 2, stem: "在 Python 3 中，map(f, [1,2,3]) 返回的是：", options: ["列表", "迭代器", "元组", "字典"], answerIndex: 1, explanation: "Python 3 的 map 返回惰性迭代器，需要 list() 转换才能得到列表；这与 Python 2 直接返回列表不同，也是迁移代码时常见的问题。" },
  { id: "q-p19-3", kcId: "p19", difficulty: 3, stem: "执行 fs=[lambda: i for i in range(3)]; [f() for f in fs] 的结果是：", options: ["[0,1,2]", "[2,2,2]", "[0,0,0]", "[1,2,3]"], answerIndex: 1, explanation: "lambda 在调用时才查找变量 i，而此时列表推导已结束，i 的最终值为 2，因此三个函数都返回 2；若要固定每次的值需用默认参数 lambda i=i: i。" },

  // ── p20 装饰器 ──
  { id: "q-p20-1", kcId: "p20", difficulty: 1, stem: "装饰器 @decorator 加在函数 f 上，等价于：", options: ["f = decorator(f)", "decorator = f(decorator)", "f = f(decorator)", "f()"], answerIndex: 0, explanation: "@ 是语法糖，定义 f 后立即执行 f=decorator(f)，用装饰器返回的新函数替换原函数名；因此装饰器必须接收函数并返回可调用对象。" },
  { id: "q-p20-2", kcId: "p20", difficulty: 2, stem: "编写装饰器时使用 functools.wraps 的主要目的是：", options: ["提高运行速度", "保留被装饰函数的名称和文档字符串等元信息", "自动捕获异常", "让函数变成生成器"], answerIndex: 1, explanation: "装饰器内部的 wrapper 会替换原函数，若不使用 wraps，f.__name__ 等元信息会变成 wrapper；functools.wraps 把原函数的元信息复制到包装函数上。" },
  { id: "q-p20-3", kcId: "p20", difficulty: 3, stem: "带参数的装饰器（如 @retry(times=3)）通常需要：", options: ["一层函数", "两层函数", "三层函数", "不需要函数"], answerIndex: 2, explanation: "最外层接收装饰器参数并返回装饰器，中间层接收被装饰函数，最内层是实际包装函数，因此需要三层嵌套；少一层会导致参数与函数对象混淆。" },

  // ── p21 递归 ──
  { id: "q-p21-1", kcId: "p21", difficulty: 1, stem: "递归函数必须具备：", options: ["循环语句", "基线条件（终止条件）", "全局变量", "列表参数"], answerIndex: 1, explanation: "递归必须有能够不再调用自身的基线条件，否则会无限递归直至 RecursionError；循环、全局变量和列表都不是递归的必要组成部分。" },
  { id: "q-p21-2", kcId: "p21", difficulty: 2, stem: "Python 对递归深度有限制，超过限制会抛出：", options: ["RecursionError", "MemoryError", "ValueError", "StopIteration"], answerIndex: 0, explanation: "Python 默认递归深度约 1000 层，超过后抛出 RecursionError，以防止 C 栈溢出；可以通过 sys.setrecursionlimit 调整，但更稳妥的是改写为迭代。" },
  { id: "q-p21-3", kcId: "p21", difficulty: 3, stem: "朴素递归计算斐波那契数列很慢，主要原因是：", options: ["递归调用开销为零", "存在大量重复子问题，时间复杂度呈指数增长", "Python 不支持递归", "整数运算太慢"], answerIndex: 1, explanation: "f(n)=f(n−1)+f(n−2) 会反复计算相同的子问题，递归树结点数指数增长；使用记忆化或改为自底向上迭代可把复杂度降到 O(n)。" },

  // ── p22 模块与包 ──
  { id: "q-p22-1", kcId: "p22", difficulty: 1, stem: "if __name__ == \"__main__\": 代码块的作用是：", options: ["让模块被导入时也执行测试代码", "只在脚本被直接运行时执行其中的代码", "定义主函数", "强制退出程序"], answerIndex: 1, explanation: "模块被直接运行时 __name__ 为 __main__，被导入时为模块名，因此该判断可把测试或入口代码限制在直接运行场景，避免导入时产生副作用。" },
  { id: "q-p22-2", kcId: "p22", difficulty: 2, stem: "同一模块被多个文件 import 多次，模块顶层代码：", options: ["每次 import 都重新执行", "只在第一次导入时执行，之后使用缓存", "完全不执行", "每次执行两次"], answerIndex: 1, explanation: "模块首次导入后会被缓存到 sys.modules，后续 import 直接复用已加载的模块对象，不会重复执行顶层代码；这避免了重复初始化。" },
  { id: "q-p22-3", kcId: "p22", difficulty: 3, stem: "关于 Python 包，下列说法正确的是：", options: ["包是包含 __init__.py 的目录（命名空间包除外），用于组织多个模块", "包就是一个 .py 文件", "包只能包含一个模块", "包不能被导入"], answerIndex: 0, explanation: "常规包是带 __init__.py 的目录，__init__.py 在导入包时执行并可用于初始化；单个 .py 文件是模块，包可以包含多个子模块和子包。" },

  // ── p23 常用标准库 ──
  { id: "q-p23-1", kcId: "p23", difficulty: 1, stem: "random.randint(1, 5) 可能返回的整数范围是：", options: ["1 到 4", "1 到 5（包含两端）", "0 到 5", "1 到 6"], answerIndex: 1, explanation: "randint(a,b) 返回 [a,b] 闭区间内的整数，两端都可能取到；这与 range 的右开区间不同，是随机数使用中的常见混淆点。" },
  { id: "q-p23-2", kcId: "p23", difficulty: 2, stem: "json.dumps 与 json.loads 的作用分别是：", options: ["把对象序列化为 JSON 字符串，把 JSON 字符串解析为对象", "把对象写入文件，从文件读取对象", "加密与解密", "压缩与解压"], answerIndex: 0, explanation: "dumps 返回 JSON 格式字符串，loads 把字符串还原为 Python 对象；带文件操作的是 dump 和 load，四个函数名只差一个 s，需注意区分。" },
  { id: "q-p23-3", kcId: "p23", difficulty: 3, stem: "使用 datetime 计算两个日期相差天数，通常应：", options: ["两个 date 对象相减得到 timedelta，再取 .days", "直接相减得到整数天数", "把日期转为字符串后比较长度", "使用 random 模块"], answerIndex: 0, explanation: "两个 date 或 datetime 相减得到 timedelta 对象，其 .days 属性给出天数差；直接当整数使用会得到类型错误，字符串比较也不能计算差值。" },

  // ── p24 异常处理 ──
  { id: "q-p24-1", kcId: "p24", difficulty: 1, stem: "try/except 结构的作用是：", options: ["捕获并处理运行时异常，避免程序直接终止", "提高程序运行速度", "定义新的数据类型", "创建多线程"], answerIndex: 0, explanation: "try 块中的异常会被匹配的 except 捕获并处理，使程序可以继续运行或给出友好提示；异常处理本身不提升性能，反而有少量开销。" },
  { id: "q-p24-2", kcId: "p24", difficulty: 2, stem: "无论 try 块是否发生异常都会执行的子句是：", options: ["else", "finally", "except", "raise"], answerIndex: 1, explanation: "finally 用于释放资源等收尾工作，无论是否异常、是否被捕获都会执行；else 只在没有异常时执行，except 只在匹配到异常时执行。" },
  { id: "q-p24-3", kcId: "p24", difficulty: 3, stem: "try 块中没有异常时，下列子句的执行顺序是：", options: ["try → else → finally", "try → finally → else", "try → except → finally", "只执行 try"], answerIndex: 0, explanation: "无异常时先执行 try 主体，再执行 else，最后执行 finally；有异常且被捕获时执行 except 再执行 finally，else 不会执行。" },

  // ── p25 自定义异常与断言 ──
  { id: "q-p25-1", kcId: "p25", difficulty: 1, stem: "在代码中主动抛出一个异常应使用：", options: ["raise", "return", "yield", "break"], answerIndex: 0, explanation: "raise 用于主动抛出异常对象或异常类，触发异常处理流程；return 结束函数并返回值，yield 产出生成器值，break 只跳出循环。" },
  { id: "q-p25-2", kcId: "p25", difficulty: 2, stem: "自定义异常类通常应继承：", options: ["object", "Exception", "list", "type"], answerIndex: 1, explanation: "自定义异常应继承 Exception（或其子类），才能被 except Exception 捕获并融入标准异常体系；继承 object 不会被当作异常抛出。" },
  { id: "q-p25-3", kcId: "p25", difficulty: 3, stem: "关于 assert 语句，下列说法正确的是：", options: ["适合用于校验用户输入并给出友好错误", "主要用于调试断言，使用 -O 运行时会被移除", "抛出的是 KeyboardInterrupt", "不能被捕获"], answerIndex: 1, explanation: "assert 用于检查程序内部不变量，优化模式 -O 下会被整体移除，因此不能用于必须执行的输入校验；它抛出 AssertionError，也可以被捕获。" },

  // ── p26 文件读写 ──
  { id: "q-p26-1", kcId: "p26", difficulty: 1, stem: "以 \"w\" 模式打开一个已存在的文件会：", options: ["在文件末尾追加内容", "清空原文件内容后写入", "报错", "只读打开"], answerIndex: 1, explanation: "w 模式会截断文件，原内容全部丢失；若要保留原内容并在末尾追加，应使用 a 模式，只读则用 r 模式。" },
  { id: "q-p26-2", kcId: "p26", difficulty: 2, stem: "使用 with open(...) as f 的主要好处是：", options: ["自动在代码块结束时关闭文件，即使发生异常", "自动把文件内容转为列表", "提高磁盘读写速度", "自动加密文件"], answerIndex: 0, explanation: "with 是上下文管理协议，退出代码块时一定会调用 close 释放文件句柄，异常情况下也不例外；它不会改变文件内容的类型或加密。" },
  { id: "q-p26-3", kcId: "p26", difficulty: 3, stem: "逐行读取大文件时，较推荐的方式是：", options: ["f.readlines() 一次性读入列表", "直接 for line in f 迭代文件对象", "f.read() 读入整个字符串", "多次调用 f.read(1)"], answerIndex: 1, explanation: "文件对象本身可迭代，for line in f 每次只读一行，内存占用小；readlines 和 read 会把整个文件装入内存，不适合大文件。" },

  // ── p27 CSV 与 JSON 文件处理 ──
  { id: "q-p27-1", kcId: "p27", difficulty: 1, stem: "json.dump 与 json.dumps 的区别是：", options: ["dump 写入文件对象，dumps 返回字符串", "dump 返回字符串，dumps 写入文件", "两者完全一样", "dumps 只能处理列表"], answerIndex: 0, explanation: "json.dump(obj, f) 把对象序列化后直接写入文件对象，json.dumps(obj) 返回序列化后的字符串；同理 load 从文件读取，loads 从字符串解析。" },
  { id: "q-p27-2", kcId: "p27", difficulty: 2, stem: "使用 csv.reader 读取一行后，得到的每个字段类型是：", options: ["自动推断为 int 或 float", "字符串", "bytes", "由 csv 模块决定"], answerIndex: 1, explanation: "csv.reader 不做类型推断，所有字段都以字符串返回，需要自行用 int 或 float 转换；这正是处理 CSV 时常见的类型错误来源。" },
  { id: "q-p27-3", kcId: "p27", difficulty: 3, stem: "用 csv 模块写文件时，open 常加 newline=\"\"，主要原因是：", options: ["避免在 Windows 上产生多余的空行", "提高写入速度", "自动添加表头", "把文件转为二进制"], answerIndex: 0, explanation: "csv 写入器自身会输出换行符，若文本模式又做换行转换，Windows 上可能出现空行；指定 newline=\"\" 可关闭转换，保证行数正确。" },

  // ── p28 类与对象 ──
  { id: "q-p28-1", kcId: "p28", difficulty: 1, stem: "类中 __init__ 方法的主要作用是：", options: ["创建类对象", "初始化新创建的实例的属性", "销毁实例", "定义类变量"], answerIndex: 1, explanation: "__init__ 在实例创建后自动调用，用于设置实例属性；真正创建实例的是 __new__，__init__ 只负责初始化，不返回实例。" },
  { id: "q-p28-2", kcId: "p28", difficulty: 2, stem: "在实例方法中，self 参数代表：", options: ["类本身", "调用该方法的实例对象", "模块", "父类"], answerIndex: 1, explanation: "实例方法通过 self 访问调用它的那个实例的属性和其他方法，Python 在调用时自动传入实例；类方法才用 cls 表示类本身。" },
  { id: "q-p28-3", kcId: "p28", difficulty: 3, stem: "若在类体中定义 items=[]，则：", options: ["每个实例都有独立的 items 列表", "所有实例共享同一个类属性列表", "items 是只读的", "实例不能访问 items"], answerIndex: 1, explanation: "类体中直接定义的列表是类属性，所有实例共享；通过实例原地修改会影响到其他实例，正确做法是在 __init__ 中为每个实例创建独立的 self.items=[]。" },

  // ── p29 方法与属性 ──
  { id: "q-p29-1", kcId: "p29", difficulty: 1, stem: "@classmethod 修饰的方法，其第一个参数通常命名为：", options: ["self", "cls", "this", "obj"], answerIndex: 1, explanation: "类方法的第一个参数是类本身，约定命名为 cls，可通过它访问类属性或创建实例；实例方法才用 self，静态方法没有这个参数。" },
  { id: "q-p29-2", kcId: "p29", difficulty: 2, stem: "@staticmethod 修饰的方法：", options: ["必须接收 self", "不接收 self 或 cls，通过类或实例调用", "只能通过实例调用", "会自动变成属性"], answerIndex: 1, explanation: "静态方法不访问实例或类状态，定义时不需要 self 或 cls，本质上是放在类命名空间中的普通函数，类和实例都可以调用。" },
  { id: "q-p29-3", kcId: "p29", difficulty: 3, stem: "@property 的主要作用是：", options: ["把方法包装成属性访问，可在读取时执行校验或计算", "把属性变成方法", "创建类变量", "禁止修改属性"], answerIndex: 0, explanation: "@property 让调用者用 obj.x 而不是 obj.x() 访问，方法内部可做计算、校验或惰性求值；配合 setter 还能在赋值时执行检查。" },

  // ── p30 继承与多态 ──
  { id: "q-p30-1", kcId: "p30", difficulty: 1, stem: "子类中调用父类的 __init__ 通常使用：", options: ["super().__init__()", "self.__init__()", "parent.__init__()", "class.__init__()"], answerIndex: 0, explanation: "super() 按方法解析顺序找到父类并调用其方法，super().__init__() 可完成父类部分的初始化；直接调用 self.__init__ 会递归调用自身。" },
  { id: "q-p30-2", kcId: "p30", difficulty: 2, stem: "多态在 Python 中主要表现为：", options: ["同一方法名在不同对象上表现出不同行为", "一个类只能有一个方法", "变量必须声明类型", "子类不能重写方法"], answerIndex: 0, explanation: "不同类的对象实现同名方法后，调用方无需关心具体类型，运行时按对象实际类型分派，这就是多态；Python 采用鸭子类型，不要求显式接口。" },
  { id: "q-p30-3", kcId: "p30", difficulty: 3, stem: "关于 Python 的方法解析顺序（MRO），下列说法正确的是：", options: ["按 C3 线性化生成，子类优先于父类", "总是先执行父类方法", "只与继承顺序无关", "由实例属性决定"], answerIndex: 0, explanation: "Python 用 C3 线性化计算 MRO，保证子类先于父类、并保持继承声明的相对顺序；属性查找沿 MRO 进行，super 也遵循该顺序。" },

  // ── p31 特殊方法与运算符重载 ──
  { id: "q-p31-1", kcId: "p31", difficulty: 1, stem: "__str__ 与 __repr__ 的主要区别是：", options: ["__str__ 面向用户可读输出，__repr__ 面向开发者调试表示", "两者完全等价", "__repr__ 只能返回数字", "__str__ 在 print 时不生效"], answerIndex: 0, explanation: "print 和 str() 优先调用 __str__，交互式环境和 repr() 调用 __repr__；后者应尽量给出能重建对象的明确表示，前者追求可读性。" },
  { id: "q-p31-2", kcId: "p31", difficulty: 2, stem: "在类中定义了 __eq__ 但未定义 __hash__，该类的实例：", options: ["仍然可以作为字典键", "变为不可哈希，不能作为字典键", "自动获得默认哈希", "会报语法错误"], answerIndex: 1, explanation: "Python 中定义 __eq__ 后会把 __hash__ 置为 None，因为相等的对象必须有相同哈希；若确实需要作键，应同时实现一致的 __hash__。" },
  { id: "q-p31-3", kcId: "p31", difficulty: 3, stem: "为自定义类实现 __len__ 后，可以直接：", options: ["对实例使用 len()", "对实例使用索引访问", "对实例进行切片", "让实例可被 for 遍历"], answerIndex: 0, explanation: "__len__ 让 len(instance) 返回指定长度；索引需要 __getitem__，切片也依赖 __getitem__，遍历则需要 __iter__ 或 __getitem__，不能只靠 __len__。" },

  // ── p32 封装与数据类 ──
  { id: "q-p32-1", kcId: "p32", difficulty: 1, stem: "属性名以单下划线开头（如 _value）表示：", options: ["Python 强制禁止外部访问", "一种「内部使用」的命名约定", "该属性是类变量", "该属性自动只读"], answerIndex: 1, explanation: "单下划线只是约定，告诉使用者这是内部实现细节，Python 并不阻止外部访问；双下划线才会触发名称改写，但也不是真正的私有。" },
  { id: "q-p32-2", kcId: "p32", difficulty: 2, stem: "使用 @dataclass 装饰器的主要好处是：", options: ["自动生成 __init__、__repr__、__eq__ 等常用方法", "自动实现多线程", "自动把类转为字典", "禁止继承"], answerIndex: 0, explanation: "dataclass 根据类中声明的字段自动生成初始化、表示和相等比较方法，减少样板代码；它不会自动序列化、并发或限制继承。" },
  { id: "q-p32-3", kcId: "p32", difficulty: 3, stem: "类中属性 __x 会被名称改写为：", options: ["_x", "__x__", "_类名__x", "x"], answerIndex: 2, explanation: "双下划线开头的属性会触发名称改写，变成 _类名__x，用于避免子类意外覆盖；但它仍可通过改写后的名字访问，因此不是真正的私有。" },

  // ── p33 迭代协议与上下文管理器 ──
  { id: "q-p33-1", kcId: "p33", difficulty: 2, stem: "要让自定义对象可被 for 遍历，通常需要实现：", options: ["__len__ 和 __str__", "__iter__，其返回对象实现 __next__", "__init__ 和 __repr__", "__eq__ 和 __hash__"], answerIndex: 1, explanation: "for 先调用 __iter__ 取得迭代器，再反复调用其 __next__ 直到 StopIteration；只实现 __len__ 或比较方法不能提供迭代能力。" },
  { id: "q-p33-2", kcId: "p33", difficulty: 3, stem: "with 语句进入和退出上下文时，分别调用对象的：", options: ["__init__ 和 __del__", "__enter__ 和 __exit__", "__iter__ 和 __next__", "__get__ 和 __set__"], answerIndex: 1, explanation: "上下文管理器协议要求实现 __enter__ 和 __exit__，with 块开始时调用前者、结束时（含异常）调用后者，因此适合资源释放。" },
  { id: "q-p33-3", kcId: "p33", difficulty: 4, stem: "上下文管理器的 __exit__ 方法返回 True 表示：", options: ["异常被抑制，不再向外传播", "正常退出且无异常", "强制关闭文件", "必须重新进入 with 块"], answerIndex: 0, explanation: "若 __exit__ 返回真值，with 块中发生的异常会被吞掉，不再向外抛出；返回 None 或 False 则异常继续传播。滥用会掩盖真实错误。" },

  // ── p34 常用算法与复杂度 ──
  { id: "q-p34-1", kcId: "p34", difficulty: 1, stem: "判断元素 x 是否在长度为 n 的列表中，平均时间复杂度是：", options: ["O(1)", "O(log n)", "O(n)", "O(n²)"], answerIndex: 2, explanation: "列表是顺序结构，in 运算符需要从头逐个比较，最坏和平均都是 O(n)；若改用集合或字典，平均可降到 O(1)。" },
  { id: "q-p34-2", kcId: "p34", difficulty: 2, stem: "使用二分查找的前提是：", options: ["数据无序", "数据有序", "数据全是整数", "数据量小于 100"], answerIndex: 1, explanation: "二分查找每次根据中间元素与目标的大小关系排除一半区间，因此要求序列有序；无序数据必须先排序，否则比较结果无法指导区间收缩。" },
  { id: "q-p34-3", kcId: "p34", difficulty: 3, stem: "在列表中查找两数之和等于目标值，使用字典记录已访问元素可把复杂度从 O(n²) 降到：", options: ["O(1)", "O(log n)", "O(n)", "O(n log n)"], answerIndex: 2, explanation: "遍历每个元素时，用字典 O(1) 平均时间查询 target−x 是否出现过，整体只扫描一遍，因此是 O(n)；代价是需要 O(n) 额外空间。" },

  // ── p35 正则表达式 ──
  { id: "q-p35-1", kcId: "p35", difficulty: 1, stem: "re.search 与 re.match 的主要区别是：", options: ["search 在整个字符串中查找，match 只从开头匹配", "两者完全相同", "match 更快所以总用 match", "search 只能匹配数字"], answerIndex: 0, explanation: "match 要求模式从字符串起始位置开始匹配，search 则扫描整个字符串寻找第一个匹配；若要找任意位置的模式，应使用 search。" },
  { id: "q-p35-2", kcId: "p35", difficulty: 2, stem: "对模式 (\\d+)-(\\d+) 匹配 \"12-34\"，group(1) 的结果是：", options: ["\"12\"", "\"34\"", "\"12-34\"", "\"-\""], answerIndex: 0, explanation: "括号定义捕获分组，group(1) 返回第一个括号匹配的内容 12，group(2) 返回 34，group(0) 返回整个匹配 12-34；分组下标从 1 开始。" },
  { id: "q-p35-3", kcId: "p35", difficulty: 3, stem: "正则表达式 a.*b 在 \"a1b2b\" 上默认匹配：", options: ["\"a1b\"", "\"a1b2b\"", "\"ab\"", "不匹配"], answerIndex: 1, explanation: "量词 * 默认是贪婪的，会尽可能向后匹配，直到最后一个 b，因此得到 a1b2b；写成 a.*?b 才是非贪婪，匹配到第一个 b 即 a1b。" },

  // ── p36 虚拟环境与包管理 ──
  { id: "q-p36-1", kcId: "p36", difficulty: 1, stem: "Python 虚拟环境（venv）的主要作用是：", options: ["隔离不同项目的依赖版本，避免相互冲突", "提高程序运行速度", "自动编写代码", "替代操作系统"], answerIndex: 0, explanation: "虚拟环境为每个项目提供独立的解释器和 site-packages，项目 A 与项目 B 可安装不同版本的同一库而互不影响；它不改变程序性能。" },
  { id: "q-p36-2", kcId: "p36", difficulty: 2, stem: "把当前环境依赖导出并在另一台机器安装，常用命令是：", options: ["pip freeze > requirements.txt，然后 pip install -r requirements.txt", "pip list > requirements.txt，然后 pip install requirements.txt", "pip download 后手动复制", "python requirements.txt"], answerIndex: 0, explanation: "pip freeze 输出已安装包及精确版本，重定向到 requirements.txt；pip install -r 按清单安装，能复现一致的依赖环境。" },
  { id: "q-p36-3", kcId: "p36", difficulty: 3, stem: "若在系统 Python 中直接 pip install 大量第三方包，可能带来的问题是：", options: ["不同项目依赖版本冲突，且可能污染系统环境", "Python 会自动删除标准库", "pip 会停止工作", "所有包都会变成内置模块"], answerIndex: 0, explanation: "全局安装会让所有项目共用同一套包，版本需求冲突时无法同时满足，还可能影响系统工具；因此推荐每个项目使用独立虚拟环境。" },

  // ── p37 调试与测试 ──
  { id: "q-p37-1", kcId: "p37", difficulty: 1, stem: "pytest 默认会自动发现并执行哪些函数作为测试？", options: ["所有函数", "名称以 test_ 开头的函数", "名称以 _test 结尾的函数", "只在 main 中调用的函数"], answerIndex: 1, explanation: "pytest 按命名约定收集测试，函数名需以 test_ 开头，测试文件通常也以 test_ 开头或 _test 结尾；不符合约定的函数不会被执行。" },
  { id: "q-p37-2", kcId: "p37", difficulty: 2, stem: "编写单元测试时，一个良好的测试用例应当：", options: ["一次覆盖尽可能多的功能", "只验证一个明确行为，包含边界情况", "依赖前一个测试的执行结果", "只在程序崩溃时运行"], answerIndex: 1, explanation: "测试应聚焦单一行为、彼此独立，并覆盖正常值、边界值和异常输入；用例过大或相互依赖会导致失败时难以定位问题。" },
  { id: "q-p37-3", kcId: "p37", difficulty: 3, stem: "使用 pdb 调试时，设置断点并逐步执行的常用方式是：", options: ["在代码中调用 breakpoint()，再用 n、s、c 等命令控制", "反复修改代码并重启", "使用 print 输出所有变量", "删除出错行"], answerIndex: 0, explanation: "breakpoint() 会进入 pdb，n 执行下一行、s 进入函数、c 继续运行，可实时查看变量和调用栈；这比反复加 print 更高效。" },

  // ── p38 类型注解 ──
  { id: "q-p38-1", kcId: "p38", difficulty: 1, stem: "函数注解 def f(x: int) -> str: 在运行时：", options: ["强制检查参数类型，类型不符就报错", "只是提示信息，不会自动强制类型检查", "把 x 自动转换为 int", "使函数变成泛型"], answerIndex: 1, explanation: "Python 的类型注解保存在 __annotations__ 中，解释器不会据此强制检查或转换；类型检查需要 mypy 等静态工具，运行时仍遵循动态类型。" },
  { id: "q-p38-2", kcId: "p38", difficulty: 2, stem: "表示「整数或 None」的类型注解通常写作：", options: ["int | None", "int & None", "int, None", "None[int]"], answerIndex: 0, explanation: "Python 3.10 起可用 int | None 表示联合类型，旧写法是 Optional[int]；它表示参数或返回值可以是 int 或 None，而不是两者同时成立。" },
  { id: "q-p38-3", kcId: "p38", difficulty: 3, stem: "使用类型注解的主要工程价值是：", options: ["让静态检查工具提前发现类型错误，并提升代码可读性", "显著提高程序运行速度", "替代所有单元测试", "让 Python 变成编译型语言"], answerIndex: 0, explanation: "注解帮助 mypy 等工具在运行前发现类型不匹配，也为阅读者和 IDE 提供信息；它不会改变运行时行为，也不能替代测试。" },

  // ── p39 并发编程基础 ──
  { id: "q-p39-1", kcId: "p39", difficulty: 1, stem: "CPython 的全局解释器锁（GIL）导致：", options: ["多线程无法并行执行 Python 字节码，CPU 密集型任务难获加速", "多线程完全不能用", "所有程序都变成单线程", "多进程也无法并行"], answerIndex: 0, explanation: "GIL 保证同一时刻只有一个线程执行字节码，因此 CPU 密集型多线程不能利用多核；I/O 等待时会释放 GIL，多进程则各有独立解释器可真正并行。" },
  { id: "q-p39-2", kcId: "p39", difficulty: 2, stem: "对于大量网络请求等待的 I/O 密集型任务，较合适的方案是：", options: ["使用多线程或 asyncio 异步并发", "使用更多 CPU 核心做计算", "把所有请求改为串行", "关闭 GIL 即可自动加速"], answerIndex: 0, explanation: "I/O 等待期间线程会释放 GIL，异步事件循环也能在单线程内切换任务，因此多线程或 asyncio 都能提高吞吐；增加计算核心对等待型任务帮助有限。" },
  { id: "q-p39-3", kcId: "p39", difficulty: 3, stem: "在 asyncio 中，await 的作用是：", options: ["阻塞整个程序直到任务完成", "挂起当前协程并把控制权交还事件循环", "创建新的操作系统线程", "强制同步执行"], answerIndex: 1, explanation: "await 等待可等待对象完成期间，当前协程暂停，事件循环可调度其他任务，从而实现单线程并发；它不会创建线程，也不是简单阻塞整个程序。" },

  // ── p40 综合项目实践 ──
  { id: "q-p40-1", kcId: "p40", difficulty: 1, stem: "把较大的 Python 项目拆分为多个模块，主要好处是：", options: ["职责清晰、便于复用和独立测试", "让程序一定运行更快", "减少代码总行数", "不再需要函数"], answerIndex: 0, explanation: "按职责拆分模块能降低耦合、提高可读性和可测试性，也便于多人协作；模块化不会自动提升运行速度，代码总量通常也不会因此减少。" },
  { id: "q-p40-2", kcId: "p40", difficulty: 2, stem: "项目中的配置信息（如数据库地址）较推荐的做法是：", options: ["硬编码在每个模块中", "集中放在配置文件或环境变量中，由程序读取", "写在注释里", "每次运行时手动输入"], answerIndex: 1, explanation: "配置与代码分离便于在不同环境切换且避免泄露敏感信息，通常用配置文件或环境变量注入；硬编码会导致修改困难并可能把密钥提交到仓库。" },
  { id: "q-p40-3", kcId: "p40", difficulty: 3, stem: "开发一个数据处理项目时，较合理的推进顺序是：", options: ["先写界面，再想数据结构", "明确需求与数据模型，再实现核心逻辑并配套测试", "先优化性能，再确定功能", "直接复制网上代码，不做设计"], answerIndex: 1, explanation: "先澄清输入输出和数据结构，再实现可测试的核心逻辑，最后接入界面和优化，能减少返工；过早做界面或优化往往建立在错误的需求理解上。" },
];
