/**
 * 计算机网络知识图谱与题库：40 个知识点 / 60 条先修边 / 120 题。
 *
 * 课程依据：国内高校《计算机网络》通用教学大纲（谢希仁体系）。
 * 每条边都是「不掌握前者，后者学不动」的真实依赖，不是按章节顺序硬连。
 */

import type { KnowledgeGraph } from "@/lib/graph";
import type { Question } from "@/data/questions";

export const networkGraph: KnowledgeGraph = {
  version: "kg-network-v1",
  concepts: [
    // ── 第 1 章 概述 ──
    { id: "n01", name: "计算机网络体系结构", chapter: "第1章 概述", summary: "分层、协议、服务与接口之间的关系" },
    { id: "n02", name: "OSI 七层模型", chapter: "第1章 概述", summary: "各层功能、数据单元与封装过程" },
    { id: "n03", name: "TCP/IP 四层模型", chapter: "第1章 概述", summary: "TCP/IP 分层及其与 OSI 的对应关系" },
    { id: "n04", name: "网络性能指标", chapter: "第1章 概述", summary: "带宽、时延、时延带宽积与吞吐量的计算" },

    // ── 第 2 章 物理层 ──
    { id: "n05", name: "数据通信基础", chapter: "第2章 物理层", summary: "信源信宿、模拟与数字信号、码元与波特率" },
    { id: "n06", name: "奈奎斯特与香农定理", chapter: "第2章 物理层", summary: "信道极限码元速率与信道容量的估算" },
    { id: "n07", name: "编码与调制", chapter: "第2章 物理层", summary: "常用数字编码方式与多进制调制" },
    { id: "n08", name: "传输介质与信道复用", chapter: "第2章 物理层", summary: "双绞线、光纤及频分、时分、波分复用" },

    // ── 第 3 章 数据链路层 ──
    { id: "n09", name: "数据链路层功能与成帧", chapter: "第3章 数据链路层", summary: "封装成帧、透明传输与差错控制的基本框架" },
    { id: "n10", name: "差错检测", chapter: "第3章 数据链路层", summary: "奇偶校验与循环冗余校验的原理和局限" },
    { id: "n11", name: "停止等待协议", chapter: "第3章 数据链路层", summary: "确认、超时重传与信道利用率的计算" },
    { id: "n12", name: "滑动窗口协议", chapter: "第3章 数据链路层", summary: "后退 N 帧与选择重传的窗口机制" },
    { id: "n13", name: "介质访问控制", chapter: "第3章 数据链路层", summary: "CSMA/CD、CSMA/CA 与随机访问协议" },
    { id: "n14", name: "以太网与 MAC 地址", chapter: "第3章 数据链路层", summary: "以太网帧格式、最小帧长与交换机转发" },

    // ── 第 4 章 网络层 ──
    { id: "n15", name: "IP 地址与分类编址", chapter: "第4章 网络层", summary: "IPv4 地址结构、分类与私有地址" },
    { id: "n16", name: "子网划分与 CIDR", chapter: "第4章 网络层", summary: "子网掩码、无分类编址与路由聚合" },
    { id: "n17", name: "IP 数据报与分片", chapter: "第4章 网络层", summary: "首部字段、MTU、分片与重组" },
    { id: "n18", name: "ARP 协议", chapter: "第4章 网络层", summary: "同一网段内 IP 地址到 MAC 地址的解析" },
    { id: "n19", name: "ICMP 协议", chapter: "第4章 网络层", summary: "差错报告、询问报文与 ping/traceroute" },
    { id: "n20", name: "路由选择协议", chapter: "第4章 网络层", summary: "RIP 的距离向量与 OSPF 的链路状态" },
    { id: "n21", name: "BGP 与自治系统", chapter: "第4章 网络层", summary: "域间路由、路径向量与策略选路" },
    { id: "n22", name: "NAT 与 IPv6", chapter: "第4章 网络层", summary: "地址转换、端到端透明性与下一代互联网" },

    // ── 第 5 章 运输层 ──
    { id: "n23", name: "运输层功能与端口", chapter: "第5章 运输层", summary: "复用分用、端口号与套接字的概念" },
    { id: "n24", name: "UDP 协议", chapter: "第5章 运输层", summary: "无连接服务、首部格式与适用场景" },
    { id: "n25", name: "TCP 连接管理", chapter: "第5章 运输层", summary: "三次握手、四次挥手与 TIME_WAIT" },
    { id: "n26", name: "TCP 可靠传输", chapter: "第5章 运输层", summary: "序号确认、超时重传与快速重传" },
    { id: "n27", name: "TCP 流量控制", chapter: "第5章 运输层", summary: "接收窗口、零窗口探测与糊涂窗口综合征" },
    { id: "n28", name: "TCP 拥塞控制", chapter: "第5章 运输层", summary: "慢开始、拥塞避免、快重传与快恢复" },

    // ── 第 6 章 应用层 ──
    { id: "n29", name: "DNS 域名系统", chapter: "第6章 应用层", summary: "域名空间、递归与迭代解析、缓存" },
    { id: "n30", name: "HTTP 协议", chapter: "第6章 应用层", summary: "请求响应、方法、持久连接与状态码" },
    { id: "n31", name: "电子邮件与 FTP", chapter: "第6章 应用层", summary: "SMTP、POP3、IMAP 与 FTP 的双连接" },
    { id: "n32", name: "DHCP 协议", chapter: "第6章 应用层", summary: "地址自动分配、DORA 过程与租约" },
    { id: "n33", name: "Web 缓存与 CDN", chapter: "第6章 应用层", summary: "代理缓存、条件请求与内容分发网络" },

    // ── 第 7 章 网络安全 ──
    { id: "n34", name: "网络安全威胁与安全模型", chapter: "第7章 网络安全", summary: "被动与主动攻击、CIA 三要素" },
    { id: "n35", name: "对称加密与公钥加密", chapter: "第7章 网络安全", summary: "共享密钥、公私钥体制与 RSA 原理" },
    { id: "n36", name: "报文鉴别与数字签名", chapter: "第7章 网络安全", summary: "哈希、消息认证码与不可否认性" },
    { id: "n37", name: "TLS 与 HTTPS", chapter: "第7章 网络安全", summary: "证书验证、密钥协商与混合加密" },

    // ── 第 8 章 无线与新技术 ──
    { id: "n38", name: "无线局域网", chapter: "第8章 无线与新技术", summary: "802.11 架构、CSMA/CA 与隐藏站问题" },
    { id: "n39", name: "移动通信与 5G", chapter: "第8章 无线与新技术", summary: "蜂窝频率复用、5G 场景与网络切片" },
    { id: "n40", name: "SDN 与网络新技术", chapter: "第8章 无线与新技术", summary: "控制转发分离、OpenFlow 与 NFV" },
  ],
  edges: [
    // 第 1 章内部
    { before: "n01", after: "n02" },
    { before: "n01", after: "n03" },
    { before: "n02", after: "n03" },
    { before: "n01", after: "n04" },

    // 物理层
    { before: "n01", after: "n05" },
    { before: "n05", after: "n06" },
    { before: "n05", after: "n07" },
    { before: "n05", after: "n08" },
    { before: "n07", after: "n08" },
    { before: "n04", after: "n06" },
    { before: "n06", after: "n07" },

    // 数据链路层
    { before: "n02", after: "n09" },
    { before: "n09", after: "n10" },
    { before: "n09", after: "n11" },
    { before: "n11", after: "n12" },
    { before: "n10", after: "n12" },
    { before: "n09", after: "n13" },
    { before: "n13", after: "n14" },
    { before: "n09", after: "n14" },
    { before: "n10", after: "n14" },

    // 网络层
    { before: "n03", after: "n15" },
    { before: "n15", after: "n16" },
    { before: "n15", after: "n17" },
    { before: "n15", after: "n18" },
    { before: "n14", after: "n18" },
    { before: "n17", after: "n19" },
    { before: "n15", after: "n20" },
    { before: "n20", after: "n21" },
    { before: "n16", after: "n20" },
    { before: "n16", after: "n22" },
    { before: "n17", after: "n22" },
    { before: "n14", after: "n17" },

    // 运输层
    { before: "n03", after: "n23" },
    { before: "n23", after: "n24" },
    { before: "n23", after: "n25" },
    { before: "n25", after: "n26" },
    { before: "n26", after: "n27" },
    { before: "n27", after: "n28" },
    { before: "n12", after: "n26" },

    // 应用层
    { before: "n23", after: "n29" },
    { before: "n24", after: "n29" },
    { before: "n29", after: "n30" },
    { before: "n25", after: "n30" },
    { before: "n30", after: "n33" },
    { before: "n23", after: "n31" },
    { before: "n15", after: "n32" },
    { before: "n24", after: "n32" },
    { before: "n18", after: "n32" },
    { before: "n29", after: "n33" },

    // 网络安全
    { before: "n34", after: "n35" },
    { before: "n35", after: "n36" },
    { before: "n36", after: "n37" },
    { before: "n25", after: "n37" },
    { before: "n30", after: "n37" },
    { before: "n34", after: "n37" },

    // 无线与新技术
    { before: "n13", after: "n38" },
    { before: "n14", after: "n38" },
    { before: "n38", after: "n39" },
    { before: "n20", after: "n40" },
    { before: "n03", after: "n40" },
  ],
};

export const networkQuestions: readonly Question[] = [
  // ── n01 计算机网络体系结构 ──
  { id: "q-n01-1", kcId: "n01", difficulty: 1, stem: "网络协议的三要素是：", options: ["语法、语义和同步", "发送、接收和转发", "编码、调制和解调", "主机、路由器和链路"], answerIndex: 0, explanation: "协议由语法（数据格式）、语义（字段含义）和同步/时序（事件顺序）三要素组成；其余选项描述的是通信过程或设备，不是协议的组成要素。" },
  { id: "q-n01-2", kcId: "n01", difficulty: 2, stem: "计算机网络采用分层结构的主要好处是：", options: ["提高链路带宽", "各层相互独立，便于实现和维护", "消除协议开销", "保证数据不丢失"], answerIndex: 1, explanation: "分层把复杂问题分解，每层只使用下层服务并向上层提供服务，便于设计、替换和排错；分层本身不会提高带宽或保证可靠性，反而会带来首部开销。" },
  { id: "q-n01-3", kcId: "n01", difficulty: 3, stem: "关于协议与服务，下列说法正确的是：", options: ["协议是水平的，服务是垂直的", "协议是垂直的，服务是水平的", "两者都由下层单方面决定", "服务一定需要协议来实现"], answerIndex: 0, explanation: "协议是同一层对等实体之间的通信规则，属于水平关系；服务是下层通过层间接口向上层提供的功能，属于垂直关系。服务由下层提供，但具体实现依赖本层协议。" },

  // ── n02 OSI 七层模型 ──
  { id: "q-n02-1", kcId: "n02", difficulty: 1, stem: "OSI 参考模型自下而上的第三层是：", options: ["数据链路层", "网络层", "运输层", "会话层"], answerIndex: 1, explanation: "自下而上依次为物理层、数据链路层、网络层、运输层、会话层、表示层、应用层，第三层是网络层，负责路由与分组转发。" },
  { id: "q-n02-2", kcId: "n02", difficulty: 2, stem: "在 OSI 模型中，负责端到端可靠传输的是：", options: ["数据链路层", "网络层", "运输层", "应用层"], answerIndex: 2, explanation: "运输层为进程之间提供端到端通信，TCP 在此实现可靠传输；数据链路层只保证相邻结点之间，网络层提供的是主机到主机的尽力而为服务。" },
  { id: "q-n02-3", kcId: "n02", difficulty: 3, stem: "OSI 模型中，为数据单元加上源/目的地址并选择转发路径的是：", options: ["物理层", "数据链路层", "网络层", "表示层"], answerIndex: 2, explanation: "网络层通过 IP 地址标识主机并依据路由表选择下一跳，完成分组转发；物理层只传比特，数据链路层用 MAC 地址处理相邻结点，表示层负责表示格式转换。" },

  // ── n03 TCP/IP 四层模型 ──
  { id: "q-n03-1", kcId: "n03", difficulty: 1, stem: "TCP/IP 体系结构自下而上的四层是：", options: ["物理层、数据链路层、网络层、应用层", "网络接口层、网际层、运输层、应用层", "网络接口层、网络层、会话层、应用层", "链路层、网际层、表示层、应用层"], answerIndex: 1, explanation: "TCP/IP 分为网络接口层、网际层、运输层和应用层四层；它把 OSI 的物理层与数据链路层合并为网络接口层，把会话层、表示层并入应用层。" },
  { id: "q-n03-2", kcId: "n03", difficulty: 2, stem: "OSI 的会话层和表示层在 TCP/IP 中通常：", options: ["单独保留为两层", "合并到应用层", "合并到运输层", "被取消且无对应功能"], answerIndex: 1, explanation: "TCP/IP 没有单独的会话层和表示层，会话管理、数据表示与加密等功能由应用层协议自行实现，因此这两层的功能被并入应用层。" },
  { id: "q-n03-3", kcId: "n03", difficulty: 3, stem: "TCP/IP 网际层的 IP 协议提供的是：", options: ["面向连接的可靠服务", "无连接、不可靠的尽力而为服务", "带确认的可靠数据报服务", "面向连接的流式服务"], answerIndex: 1, explanation: "IP 不建立连接、不保证顺序和到达，只尽最大努力转发；可靠性由上层的 TCP 负责，面向连接和可靠传输不是 IP 的特性。" },

  // ── n04 网络性能指标 ──
  { id: "q-n04-1", kcId: "n04", difficulty: 1, stem: "发送时延的计算公式是：", options: ["数据长度 ÷ 传播速率", "数据长度 ÷ 发送速率", "链路长度 ÷ 光速", "往返时间 ÷ 2"], answerIndex: 1, explanation: "发送时延是把数据比特推上链路所需时间，等于数据长度除以发送速率；链路长度除以光速得到的是传播时延，两者含义不同。" },
  { id: "q-n04-2", kcId: "n04", difficulty: 2, stem: "时延带宽积表示的是：", options: ["链路上可容纳的比特数", "链路的物理长度", "每秒产生的分组数", "发送一个比特所需时间"], answerIndex: 0, explanation: "时延带宽积等于传播时延乘以带宽，表示链路这根管道中最多能容纳的比特数，常用于理解滑动窗口为什么需要足够大。" },
  { id: "q-n04-3", kcId: "n04", difficulty: 4, stem: "主机以 100 Mbps 发送 100 MB 的数据，发送时延约为：", options: ["1 s", "8 s", "80 s", "0.8 s"], answerIndex: 1, explanation: "100 MB 等于 800 Mbit（按 1 MB=8 Mbit 估算），除以 100 Mbps 得 8 s；若误把字节当比特会得到 1 s，忽略单位换算是常见错误。" },

  // ── n05 数据通信基础 ──
  { id: "q-n05-1", kcId: "n05", difficulty: 1, stem: "关于码元，下列说法正确的是：", options: ["一个码元只能携带 1 个比特", "一个码元可以携带多个比特", "码元就是比特的同义词", "码元速率单位是比特/秒"], answerIndex: 1, explanation: "码元是承载信息的基本信号单元，采用多进制调制时一个码元可表示多个比特；码元速率单位是波特，比特率才用比特/秒。" },
  { id: "q-n05-2", kcId: "n05", difficulty: 2, stem: "基带信号与带通信号的区别是：", options: ["基带信号适合远距离无线传输", "基带信号包含低频分量，带通信号被搬移到较高频段", "带通信号不需要载波", "两者没有区别"], answerIndex: 1, explanation: "基带信号直接传输数字波形，含有大量低频成分；带通信号用载波把频谱搬移到高频段，便于无线传输和频分复用。" },
  { id: "q-n05-3", kcId: "n05", difficulty: 3, stem: "对讲机同一时刻只能一方说话，这种通信方式属于：", options: ["单工", "半双工", "全双工", "并行通信"], answerIndex: 1, explanation: "半双工允许双方都能发送和接收，但不能同时进行；单工只能固定一个方向，全双工可同时双向传输，对讲机需要按键切换收发方向。" },

  // ── n06 奈奎斯特与香农定理 ──
  { id: "q-n06-1", kcId: "n06", difficulty: 1, stem: "奈奎斯特准则指出，理想低通信道的最高码元传输速率为：", options: ["W Baud", "2W Baud", "W log₂(1+S/N)", "2W log₂V"], answerIndex: 1, explanation: "奈氏准则给出最高码元速率为 2W Baud，其中 W 是信道带宽；W log₂(1+S/N) 是香农公式，2W log₂V 是在此基础上考虑多进制后的比特率。" },
  { id: "q-n06-2", kcId: "n06", difficulty: 3, stem: "香农公式 C = W log₂(1+S/N) 中的 C 表示：", options: ["码元速率", "信道容量（比特/秒）", "信号功率", "噪声功率"], answerIndex: 1, explanation: "香农公式给出的是在给定带宽和信噪比下信道的极限信息传输速率，即信道容量，单位是比特/秒；W 是带宽，S/N 是信噪比。" },
  { id: "q-n06-3", kcId: "n06", difficulty: 4, stem: "某信道带宽 3 kHz，信噪比为 30 dB，其信道容量约为：", options: ["3 kbps", "10 kbps", "30 kbps", "300 kbps"], answerIndex: 2, explanation: "30 dB 对应 S/N=1000，log₂(1001)≈10，故 C≈3k×10=30 kbps；若把 30 dB 直接当作信噪比数值会得到明显偏小的结果。" },

  // ── n07 编码与调制 ──
  { id: "q-n07-1", kcId: "n07", difficulty: 1, stem: "曼彻斯特编码的显著特点是：", options: ["每个码元中间都有一次跳变，可自带同步信息", "只有高电平表示 1", "编码后带宽减半", "必须使用多根并行线"], answerIndex: 0, explanation: "曼彻斯特编码用码元中间的跳变表示 0 或 1，接收方可从跳变中提取时钟，因此是自同步编码；代价是所需带宽比不归零编码更大。" },
  { id: "q-n07-2", kcId: "n07", difficulty: 2, stem: "16QAM 每个码元可以携带的比特数为：", options: ["1", "2", "4", "16"], answerIndex: 2, explanation: "16QAM 有 16 种状态，log₂16=4，所以每个码元携带 4 个比特；码元状态数 16 并不等于每码元比特数，二者是取对数的关系。" },
  { id: "q-n07-3", kcId: "n07", difficulty: 3, stem: "差分曼彻斯特编码相对曼彻斯特编码的优势是：", options: ["更强的抗极性反转能力", "不需要时钟", "带宽为零", "只能传模拟信号"], answerIndex: 0, explanation: "差分曼彻斯特用码元开始处是否跳变表示数据，即使传输中极性整体反转，接收方仍能正确判决；曼彻斯特依赖绝对电平，极性反转会导致误判。" },

  // ── n08 传输介质与信道复用 ──
  { id: "q-n08-1", kcId: "n08", difficulty: 1, stem: "光纤作为传输介质的主要优点是：", options: ["成本最低", "带宽大、抗电磁干扰", "便于分支连接", "不需要光电转换"], answerIndex: 1, explanation: "光纤利用光信号传输，带宽大、损耗低且不受电磁干扰；它的成本高于双绞线，分支和接续较麻烦，两端需要光电转换设备。" },
  { id: "q-n08-2", kcId: "n08", difficulty: 2, stem: "频分复用（FDM）与时分复用（TDM）的根本区别是：", options: ["FDM 按频率划分信道，TDM 按时间片划分", "FDM 只能用于数字信号", "TDM 不需要同步", "两者完全等价"], answerIndex: 0, explanation: "FDM 让多路信号同时占用不同频段，TDM 让多路信号轮流占用同一频段的不同时间片；FDM 也可传模拟信号，TDM 需要严格的时间同步。" },
  { id: "q-n08-3", kcId: "n08", difficulty: 4, stem: "波分复用（WDM）主要用于：", options: ["双绞线", "光纤", "无线信道", "同轴电缆"], answerIndex: 1, explanation: "波分复用是在一根光纤中同时传输多个不同波长的光信号，相当于光域的频分复用，可大幅提高光纤容量；其他介质不具备这种光波长复用的条件。" },

  // ── n09 数据链路层功能与成帧 ──
  { id: "q-n09-1", kcId: "n09", difficulty: 1, stem: "数据链路层常用的帧定界方法不包括：", options: ["字符计数法", "字符填充法", "比特填充法", "路由选择法"], answerIndex: 3, explanation: "帧定界可用字符计数、字符填充、比特填充和违规编码等方法；路由选择是网络层的功能，与帧边界识别无关。" },
  { id: "q-n09-2", kcId: "n09", difficulty: 2, stem: "比特填充法中，发送方在连续出现 5 个 1 后插入一个 0，目的是：", options: ["增加冗余校验", "避免数据中出现与帧定界符相同的比特模式", "压缩数据", "加密数据"], answerIndex: 1, explanation: "帧定界符是 01111110，若数据中恰好出现 5 个连续 1，就可能与定界符混淆；插入 0 可保证数据内不出现 6 个连续 1，接收方再删除插入的 0 即可还原。" },
  { id: "q-n09-3", kcId: "n09", difficulty: 3, stem: "数据链路层需要成帧，主要原因是：", options: ["让接收方识别帧的边界并分别校验", "提高 CPU 主频", "减少 IP 地址", "实现路由选择"], answerIndex: 0, explanation: "物理层只提供比特流，接收方必须知道一帧从哪里开始、到哪里结束，才能按帧校验和交付；成帧与 CPU 主频、IP 地址和路由选择没有直接关系。" },

  // ── n10 差错检测 ──
  { id: "q-n10-1", kcId: "n10", difficulty: 1, stem: "CRC 校验的主要能力是：", options: ["纠正所有错误", "检测传输中出现的错误，通常不纠错", "加密数据", "压缩数据"], answerIndex: 1, explanation: "CRC 通过模 2 除法得到的余数判断帧是否出错，检错能力强但一般只检错不纠错；发现错误后通常丢弃该帧并由上层重传。" },
  { id: "q-n10-2", kcId: "n10", difficulty: 2, stem: "简单奇偶校验能检测出的错误是：", options: ["任意偶数个比特错误", "奇数个比特错误", "所有突发错误", "只能检测 1 个比特错误"], answerIndex: 1, explanation: "奇偶校验通过 1 的个数奇偶性判断，奇数个比特翻转会改变奇偶性从而被发现；偶数个比特同时翻转可能互相抵消，无法检测。" },
  { id: "q-n10-3", kcId: "n10", difficulty: 3, stem: "CRC 中若接收方用生成多项式去除收到的比特串，余数为 0 说明：", options: ["一定没有错误", "按该生成多项式未检测到错误", "错误一定可纠正", "需要重新发送"], answerIndex: 1, explanation: "余数为 0 只表示按该生成多项式未检测出错误，仍存在极小概率的漏检；CRC 不能保证绝对无误，也不能自动纠正错误。" },

  // ── n11 停止等待协议 ──
  { id: "q-n11-1", kcId: "n11", difficulty: 1, stem: "停止等待协议中，发送方每发送一帧后必须：", options: ["继续发送下一帧", "等待确认，超时则重传", "立即释放连接", "修改 IP 地址"], answerIndex: 1, explanation: "停止等待协议规定发送一帧后停下来等待接收方的确认，若超时未收到确认就重传该帧；这样才能在不可靠链路上实现可靠传输。" },
  { id: "q-n11-2", kcId: "n11", difficulty: 2, stem: "停止等待协议的信道利用率公式是：", options: ["L/C ÷ (L/C + 2RTT)", "2RTT ÷ L/C", "1", "L/C × RTT"], answerIndex: 0, explanation: "一个周期包括发送时延 L/C 和往返传播时延 2RTT，有效发送时间只占其中 L/C，因此利用率为 (L/C)/(L/C+2RTT)；带宽时延积越大，停等协议效率越低。" },
  { id: "q-n11-3", kcId: "n11", difficulty: 3, stem: "在停止等待协议中，为了区分新帧和重传帧，序号至少需要：", options: ["1 位", "2 位", "4 位", "8 位"], answerIndex: 0, explanation: "停等协议同一时刻只有一个未确认帧，接收方只需区分当前帧与上一帧，1 位序号（0 和 1 交替）就足够；更多位不会带来额外好处。" },

  // ── n12 滑动窗口协议 ──
  { id: "q-n12-1", kcId: "n12", difficulty: 1, stem: "后退 N 帧协议（GBN）中，接收窗口的大小通常是：", options: ["1", "大于 1", "等于发送窗口", "等于 0"], answerIndex: 0, explanation: "GBN 接收方按序接收，只缓存期望的那一帧，收到失序帧就丢弃，因此接收窗口为 1；发送窗口可以大于 1，这正是它与停等协议的区别。" },
  { id: "q-n12-2", kcId: "n12", difficulty: 3, stem: "选择重传协议（SR）中，若序号用 n 位表示，发送窗口的最大尺寸为：", options: ["2ⁿ", "2ⁿ-1", "2^(n-1)", "n"], answerIndex: 2, explanation: "SR 的发送窗口与接收窗口之和不能超过 2ⁿ，通常取二者相等，故最大为 2^(n-1)；若取 2ⁿ 会导致新旧帧序号混淆。" },
  { id: "q-n12-3", kcId: "n12", difficulty: 4, stem: "GBN 与 SR 的主要区别是：", options: ["GBN 只重传出错帧，SR 重传所有后续帧", "GBN 重传出错帧及其后所有帧，SR 只重传出错帧", "两者完全相同", "SR 不需要确认"], answerIndex: 1, explanation: "GBN 接收方丢弃失序帧，发送方超时后要重传出错帧及其后的所有帧；SR 接收方缓存失序帧，发送方只需重传未被确认的那一帧，效率更高但实现更复杂。" },

  // ── n13 介质访问控制 ──
  { id: "q-n13-1", kcId: "n13", difficulty: 1, stem: "CSMA/CD 协议主要用于：", options: ["无线局域网", "有线共享式以太网", "光纤骨干网", "卫星通信"], answerIndex: 1, explanation: "CSMA/CD 通过边发送边检测冲突，适用于总线型共享式以太网；无线环境难以检测冲突，因此无线局域网采用 CSMA/CA。" },
  { id: "q-n13-2", kcId: "n13", difficulty: 2, stem: "以太网中采用 CSMA/CD 的根本原因是：", options: ["多个站点共享同一传输介质，可能同时发送", "IP 地址不够用", "需要加密数据", "链路带宽太大"], answerIndex: 0, explanation: "共享介质意味着多个站点可能同时发送而造成信号叠加冲突，CSMA/CD 通过载波监听、冲突检测和随机退避来减少并处理冲突；它与地址数量、加密和带宽大小无关。" },
  { id: "q-n13-3", kcId: "n13", difficulty: 3, stem: "无线局域网采用 CSMA/CA 而不是 CSMA/CD，主要因为：", options: ["无线信号无法可靠地进行冲突检测", "无线网不需要介质访问控制", "CSMA/CD 速度太慢", "无线网没有帧"], answerIndex: 0, explanation: "无线发送时信号强度远大于接收信号，难以同时监听并检测冲突，且存在隐藏站问题，所以改用冲突避免：先预约信道、随机退避，再发送。" },

  // ── n14 以太网与 MAC 地址 ──
  { id: "q-n14-1", kcId: "n14", difficulty: 1, stem: "以太网规定最小帧长为 64 字节，目的是：", options: ["节省带宽", "保证发送方在发送完毕前能检测到冲突", "便于加密", "与 IP 地址长度匹配"], answerIndex: 1, explanation: "若帧太短，发送方可能在冲突信号返回前就发送完毕，从而漏检冲突；64 字节保证在最远距离往返时间内仍处于发送状态，能完成冲突检测。" },
  { id: "q-n14-2", kcId: "n14", difficulty: 2, stem: "MAC 地址的长度是：", options: ["16 位", "32 位", "48 位", "128 位"], answerIndex: 2, explanation: "以太网 MAC 地址为 48 位，通常写成 6 组十六进制数；前 24 位是厂商分配的组织唯一标识，后 24 位由厂商自行分配。" },
  { id: "q-n14-3", kcId: "n14", difficulty: 3, stem: "以太网交换机转发帧时依据的是：", options: ["IP 地址", "目的 MAC 地址", "端口号", "域名"], answerIndex: 1, explanation: "交换机是数据链路层设备，根据帧的目的 MAC 地址查转发表决定从哪个端口转发；IP 地址用于网络层路由，端口号和域名属于运输层与应用层。" },

  // ── n15 IP 地址与分类编址 ──
  { id: "q-n15-1", kcId: "n15", difficulty: 1, stem: "IPv4 地址的长度是：", options: ["16 位", "32 位", "64 位", "128 位"], answerIndex: 1, explanation: "IPv4 地址为 32 位，通常用点分十进制表示；IPv6 才是 128 位，位数不同是区分两代协议的基本标志。" },
  { id: "q-n15-2", kcId: "n15", difficulty: 2, stem: "下列地址中属于私有地址的是：", options: ["8.8.8.8", "192.168.1.1", "172.32.0.1", "11.0.0.1"], answerIndex: 1, explanation: "私有地址范围是 10.0.0.0/8、172.16.0.0/12 和 192.168.0.0/16；192.168.1.1 属于第三段，172.32.0.1 已超出 172.16 到 172.31，8.8.8.8 和 11.0.0.1 都是公网地址。" },
  { id: "q-n15-3", kcId: "n15", difficulty: 3, stem: "地址 192.168.1.100/24 所在网络的广播地址是：", options: ["192.168.1.0", "192.168.1.100", "192.168.1.255", "192.168.255.255"], answerIndex: 2, explanation: "/24 表示前 24 位为网络号，主机号全 0 是网络地址 192.168.1.0，主机号全 1 是广播地址 192.168.1.255；192.168.255.255 是 /16 的广播地址。" },

  // ── n16 子网划分与 CIDR ──
  { id: "q-n16-1", kcId: "n16", difficulty: 1, stem: "子网掩码的作用是：", options: ["加密 IP 地址", "区分 IP 地址中的网络号和主机号", "分配 MAC 地址", "计算路由跳数"], answerIndex: 1, explanation: "子网掩码中 1 对应网络号、0 对应主机号，将 IP 地址与掩码按位与即可得到网络地址；它不负责加密、MAC 分配或跳数计算。" },
  { id: "q-n16-2", kcId: "n16", difficulty: 3, stem: "一个 /26 的子网中可分配给主机的地址数是：", options: ["64", "62", "30", "126"], answerIndex: 1, explanation: "/26 留下 6 位主机号，共 2⁶=64 个地址，去掉网络地址和广播地址后可用 62 个；/27 才是 30 个可用地址。" },
  { id: "q-n16-3", kcId: "n16", difficulty: 4, stem: "将 4 个连续的 /24 网络聚合成一条路由，聚合后的前缀长度是：", options: ["/22", "/23", "/24", "/21"], answerIndex: 0, explanation: "4 个 /24 需要借用 2 位网络号来表示，24−2=22，因此聚合为 /22；聚合要求这些网络在地址空间上连续且起始地址对齐。" },

  // ── n17 IP 数据报与分片 ──
  { id: "q-n17-1", kcId: "n17", difficulty: 1, stem: "IP 数据报首部中 TTL 字段的作用是：", options: ["记录数据报长度", "防止数据报在网络中无限循环", "标识上层协议", "校验首部"], answerIndex: 1, explanation: "TTL 每经过一台路由器减 1，减到 0 就丢弃并返回超时差错，从而避免路由环路导致数据报永久游荡；它不负责长度、协议标识或校验。" },
  { id: "q-n17-2", kcId: "n17", difficulty: 2, stem: "IP 数据报分片时，用于重组的关键字段是：", options: ["源地址、目的地址和 TTL", "标识、标志和片偏移", "版本、首部长度和服务类型", "总长度和校验和"], answerIndex: 1, explanation: "同一数据报的所有分片具有相同的标识，标志中的 MF/DF 指示是否还有分片及能否分片，片偏移指出该片在原数据报中的位置，三者共同完成重组。" },
  { id: "q-n17-3", kcId: "n17", difficulty: 4, stem: "某 IP 数据报总长 4000 字节、首部 20 字节，经过 MTU=1500 的链路，至少分成几片？", options: ["2", "3", "4", "5"], answerIndex: 1, explanation: "可携带数据为 4000−20=3980 字节，每片最多 1500−20=1480 字节，3980=1480+1480+1020，故需 3 片；最后一片不足 1480 字节但仍然合法。" },

  // ── n18 ARP 协议 ──
  { id: "q-n18-1", kcId: "n18", difficulty: 1, stem: "ARP 协议的作用是：", options: ["把域名解析为 IP 地址", "把 IP 地址解析为 MAC 地址", "把 MAC 地址解析为域名", "分配 IP 地址"], answerIndex: 1, explanation: "ARP 在同一局域网内广播询问某个 IP 地址对应的 MAC 地址，并用应答结果更新 ARP 缓存；域名到 IP 由 DNS 完成，IP 分配由 DHCP 完成。" },
  { id: "q-n18-2", kcId: "n18", difficulty: 2, stem: "ARP 请求报文通常以什么方式发送？", options: ["单播", "广播", "组播", "任播"], answerIndex: 1, explanation: "请求方尚不知道目标 MAC 地址，只能向本网段广播 ARP 请求；拥有该 IP 的主机以单播方式回应，随后双方可缓存映射关系。" },
  { id: "q-n18-3", kcId: "n18", difficulty: 3, stem: "主机访问另一个网段的主机时，ARP 解析的目标是：", options: ["目的主机的 MAC 地址", "默认网关的 MAC 地址", "DNS 服务器的 IP 地址", "自己的 MAC 地址"], answerIndex: 1, explanation: "跨网段时，主机把数据报发给默认网关，因此需要解析网关的 MAC 地址；目的主机的 MAC 只在最后一跳由网关解析，源主机无法直接获知。" },

  // ── n19 ICMP 协议 ──
  { id: "q-n19-1", kcId: "n19", difficulty: 1, stem: "ping 命令使用的是哪类 ICMP 报文？", options: ["差错报告报文", "回送请求与回送应答报文", "重定向报文", "路由通告报文"], answerIndex: 1, explanation: "ping 发送 ICMP 回送请求，对方返回回送应答，以此测试连通性和往返时间；差错报告用于目的不可达、超时等情况，不是 ping 的主要机制。" },
  { id: "q-n19-2", kcId: "n19", difficulty: 2, stem: "traceroute 的基本原理是：", options: ["逐次增加 TTL，利用超时差错报文发现路径", "发送 TCP 握手包", "查询 DNS 记录", "使用 ARP 广播"], answerIndex: 0, explanation: "traceroute 先发送 TTL=1 的报文，第一台路由器减到 0 后返回超时差错，从而暴露其地址；随后逐步增大 TTL，直到到达目的主机。" },
  { id: "q-n19-3", kcId: "n19", difficulty: 3, stem: "下列情况中，通常不发送 ICMP 差错报文的是：", options: ["目的主机不可达", "对 ICMP 差错报文本身再出错", "数据报 TTL 超时", "源主机被隔离"], answerIndex: 1, explanation: "为避免差错报文无限嵌套，ICMP 规定对 ICMP 差错报文不再发送差错报文；此外对非第一片分片、组播地址等也不发送差错报文。" },

  // ── n20 路由选择协议 ──
  { id: "q-n20-1", kcId: "n20", difficulty: 1, stem: "RIP 协议的最大跳数是：", options: ["15", "16", "32", "255"], answerIndex: 0, explanation: "RIP 用跳数作为度量，规定最大有效跳数为 15，16 表示不可达；这个限制使 RIP 只适合小型网络。" },
  { id: "q-n20-2", kcId: "n20", difficulty: 2, stem: "OSPF 协议计算路由时使用的算法是：", options: ["距离向量", "Dijkstra 最短路径", "Bellman-Ford", "哈希查找"], answerIndex: 1, explanation: "OSPF 属于链路状态协议，各路由器泛洪链路状态后独立运行 Dijkstra 算法计算最短路径树；RIP 才是典型的距离向量协议。" },
  { id: "q-n20-3", kcId: "n20", difficulty: 4, stem: "RIP 的「坏消息传播得慢」问题是指：", options: ["链路故障后，错误路由可能在网络中长时间循环", "RIP 报文太大", "RIP 不支持子网", "RIP 不能加密"], answerIndex: 0, explanation: "距离向量协议中，路由器会互相通告从对方学到的路由，链路断开后可能通过邻居逐次加 1 形成计数到无穷；水平分割、毒性逆转和触发更新可缓解该问题。" },

  // ── n21 BGP 与自治系统 ──
  { id: "q-n21-1", kcId: "n21", difficulty: 1, stem: "BGP 属于哪一类路由协议？", options: ["内部网关协议", "外部网关协议", "链路状态协议", "距离向量协议"], answerIndex: 1, explanation: "BGP 用于自治系统之间的路由选择，是外部网关协议；OSPF、RIP 用于自治系统内部，属于内部网关协议。" },
  { id: "q-n21-2", kcId: "n21", difficulty: 2, stem: "BGP 报文使用哪个运输层协议和端口？", options: ["UDP 53", "TCP 179", "TCP 80", "UDP 67"], answerIndex: 1, explanation: "BGP 使用 TCP 的 179 端口建立可靠连接，以便在域间长期交换路由信息；UDP 53 是 DNS，TCP 80 是 HTTP，UDP 67 是 DHCP 服务器端口。" },
  { id: "q-n21-3", kcId: "n21", difficulty: 3, stem: "BGP 不采用跳数作为主要度量，原因是：", options: ["跳数无法反映域间策略和链路质量", "BGP 不支持数字", "跳数太大", "BGP 只传 MAC 地址"], answerIndex: 0, explanation: "自治系统之间的选路往往受商业策略、政治因素和链路质量影响，单纯跳数没有意义；BGP 使用 AS 路径等属性进行路径向量选路，并可实施策略控制。" },

  // ── n22 NAT 与 IPv6 ──
  { id: "q-n22-1", kcId: "n22", difficulty: 1, stem: "NAT 的主要作用是：", options: ["把私有 IP 地址转换为公网 IP 地址", "把域名转换为 IP 地址", "把 MAC 地址转换为 IP 地址", "加密 IP 数据报"], answerIndex: 0, explanation: "NAT 在私有网络出口处修改源/目的 IP 地址和端口，使多台内网主机共享少量公网地址；域名解析由 DNS 完成，MAC 与 IP 的映射由 ARP 完成。" },
  { id: "q-n22-2", kcId: "n22", difficulty: 2, stem: "IPv6 地址的长度是：", options: ["32 位", "64 位", "128 位", "256 位"], answerIndex: 2, explanation: "IPv6 地址为 128 位，通常写成 8 组十六进制数并以冒号分隔；地址空间远大于 IPv4 的 32 位，从根本上缓解地址耗尽问题。" },
  { id: "q-n22-3", kcId: "n22", difficulty: 4, stem: "NAT 对端到端通信的主要影响是：", options: ["提高了带宽", "破坏了端到端的透明性，外部主机难以主动连接内网主机", "使 IP 地址变长", "取消了运输层端口"], answerIndex: 1, explanation: "NAT 隐藏了内网地址，外部主机无法直接寻址内网主机，需要端口映射或打洞才能建立入站连接；这破坏了互联网端到端透明的基本设计原则。" },

  // ── n23 运输层功能与端口 ──
  { id: "q-n23-1", kcId: "n23", difficulty: 1, stem: "TCP/IP 运输层端口号的长度是：", options: ["8 位", "16 位", "32 位", "48 位"], answerIndex: 1, explanation: "端口号为 16 位，取值范围 0 到 65535；其中 0 到 1023 是知名端口，1024 到 49151 是登记端口，49152 到 65535 是临时端口。" },
  { id: "q-n23-2", kcId: "n23", difficulty: 2, stem: "套接字（socket）通常由什么唯一标识？", options: ["IP 地址和端口号", "MAC 地址和端口号", "域名和 IP 地址", "进程号和线程号"], answerIndex: 0, explanation: "一个套接字由 IP 地址与端口号共同确定，即（IP, port）；同一端口在不同 IP 上可同时使用，因此单靠端口号不能唯一标识通信端点。" },
  { id: "q-n23-3", kcId: "n23", difficulty: 3, stem: "运输层的复用与分用分别指：", options: ["发送方把多个应用进程的数据交给同一运输层协议，接收方按端口交付给对应进程", "把数据压缩后再解压", "把 IP 地址转换成 MAC 地址", "建立和释放连接"], answerIndex: 0, explanation: "复用是发送方多个应用进程共用运输层服务，分用是接收方根据端口号把数据交给正确的应用进程；这是运输层区别于网络层的重要功能。" },

  // ── n24 UDP 协议 ──
  { id: "q-n24-1", kcId: "n24", difficulty: 1, stem: "UDP 首部的固定长度是：", options: ["4 字节", "8 字节", "20 字节", "可变"], answerIndex: 1, explanation: "UDP 首部由源端口、目的端口、长度和校验和四个字段组成，每个 2 字节，共 8 字节；TCP 首部最短为 20 字节。" },
  { id: "q-n24-2", kcId: "n24", difficulty: 2, stem: "下列应用最适合使用 UDP 的是：", options: ["文件传输", "实时视频会议", "网页浏览", "电子邮件发送"], answerIndex: 1, explanation: "实时音视频更看重低时延和吞吐，少量丢包可以容忍，UDP 无连接、首部小、不重传，正好合适；文件传输、网页和邮件都要求可靠交付，通常使用 TCP。" },
  { id: "q-n24-3", kcId: "n24", difficulty: 3, stem: "UDP 校验和计算时使用伪首部，其作用是：", options: ["把 IP 地址等信息纳入校验范围", "增加首部长度", "加密数据", "标识应用层协议"], answerIndex: 0, explanation: "伪首部包含源/目的 IP 地址、协议号和 UDP 长度，只参与校验和计算而不实际传输，使 UDP 能检测地址或协议字段被篡改的错误。" },

  // ── n25 TCP 连接管理 ──
  { id: "q-n25-1", kcId: "n25", difficulty: 1, stem: "TCP 三次握手的首要目的是：", options: ["协商加密算法", "同步双方序号并确认彼此的收发能力", "分配 IP 地址", "选择路由"], answerIndex: 1, explanation: "三次握手交换初始序号并各自确认对方能收能发，从而建立可靠的全双工连接；加密算法由 TLS 等上层协议协商，与 TCP 握手无关。" },
  { id: "q-n25-2", kcId: "n25", difficulty: 2, stem: "TCP 建立连接为什么需要三次握手而不是两次？", options: ["两次握手无法分配端口", "防止失效的旧连接请求突然到达，使双方对连接状态产生误解", "三次握手速度更快", "两次握手不能携带序号"], answerIndex: 1, explanation: "若只有两次，服务器收到一个早已失效的旧 SYN 就会直接建立连接并分配资源，而客户端并不想连接；第三次确认让服务器确认客户端确实收到了自己的 SYN。" },
  { id: "q-n25-3", kcId: "n25", difficulty: 4, stem: "TCP 主动关闭方进入 TIME_WAIT 状态并等待 2MSL，主要目的是：", options: ["提高传输速度", "保证最后一个 ACK 能到达，并让旧报文在网络中消失", "节省内存", "防止 IP 地址冲突"], answerIndex: 1, explanation: "若最后一个 ACK 丢失，对方会重传 FIN，主动关闭方需在 TIME_WAIT 内能再次回应；等待 2MSL 还能让本连接的旧报文全部消失，避免干扰新连接。" },

  // ── n26 TCP 可靠传输 ──
  { id: "q-n26-1", kcId: "n26", difficulty: 1, stem: "TCP 的累积确认含义是：", options: ["每收到一个字节就确认一次", "确认号表示该序号之前的所有字节都已收到", "只确认最后一个字节", "确认号可以随意填写"], answerIndex: 1, explanation: "TCP 确认号 N 表示 N 之前的所有字节均已正确收到，接收方不必对每个报文段单独确认；这种累积确认减少了确认报文数量，但丢包时可能重复发送。" },
  { id: "q-n26-2", kcId: "n26", difficulty: 2, stem: "TCP 发送方触发快速重传的条件通常是：", options: ["超时计时器到期", "连续收到 3 个重复 ACK", "收到 FIN 报文", "窗口变为 0"], answerIndex: 1, explanation: "接收方对失序报文会重复发送同一个 ACK，发送方连续收到 3 个重复 ACK 就推断该报文丢失并立即重传，而不必等到超时，从而加快恢复。" },
  { id: "q-n26-3", kcId: "n26", difficulty: 4, stem: "TCP 超时重传时间 RTO 的设定依据是：", options: ["固定为 1 秒", "根据往返时间 RTT 的加权平均值和偏差动态计算", "由接收方任意指定", "等于带宽的一半"], answerIndex: 1, explanation: "TCP 测量 RTT 并用加权平均与偏差估计 RTO，使超时时间能适应网络时延变化；固定值无法适应不同链路，容易造成误重传或恢复过慢。" },

  // ── n27 TCP 流量控制 ──
  { id: "q-n27-1", kcId: "n27", difficulty: 1, stem: "TCP 流量控制中，接收窗口 rwnd 的作用是：", options: ["告诉发送方还能接收多少字节", "告诉发送方路由跳数", "指定加密算法", "标识应用层协议"], answerIndex: 0, explanation: "接收方通过 rwnd 通告自身接收缓存的剩余空间，发送方据此限制未确认数据量，防止发送过快导致接收方缓冲区溢出；这是端到端的流量控制。" },
  { id: "q-n27-2", kcId: "n27", difficulty: 2, stem: "当接收方通告零窗口后，发送方应：", options: ["立即关闭连接", "启动持续计时器，定期发送零窗口探测报文", "永久停止发送", "把窗口改为 1"], answerIndex: 1, explanation: "零窗口表示接收缓存已满，但窗口更新报文可能丢失，因此发送方启动持续计时器，定期发送探测报文询问窗口是否已恢复，避免双方永久等待。" },
  { id: "q-n27-3", kcId: "n27", difficulty: 3, stem: "糊涂窗口综合征的典型表现是：", options: ["接收方每次只通告很小的窗口，发送方每次只发很少数据", "发送方一次发送过多数据", "网络带宽突然增大", "TCP 连接无法建立"], answerIndex: 0, explanation: "接收方应用读取很慢时可能每次只腾出几个字节就通告小窗口，发送方随之发送小报文段，导致首部开销占比过高；可用延迟确认和 Nagle 算法缓解。" },

  // ── n28 TCP 拥塞控制 ──
  { id: "q-n28-1", kcId: "n28", difficulty: 1, stem: "TCP 慢开始阶段，拥塞窗口 cwnd 的增长方式是：", options: ["每个 RTT 加 1", "每个 RTT 翻倍（指数增长）", "保持不变", "每个 RTT 减半"], answerIndex: 1, explanation: "慢开始并不是增长慢，而是从一个较小的 cwnd 开始，每经过一个 RTT 就翻倍，呈指数增长；达到慢开始门限后转入拥塞避免，改为线性增长。" },
  { id: "q-n28-2", kcId: "n28", difficulty: 2, stem: "TCP 拥塞避免阶段，cwnd 的典型增长方式是：", options: ["每个 RTT 增加 1 个 MSS", "每个 RTT 翻倍", "每个 ACK 翻倍", "保持不变"], answerIndex: 0, explanation: "拥塞避免让 cwnd 每经过一个 RTT 只增加约 1 个 MSS，呈线性增长，以避免过快增加造成拥塞；指数增长只出现在慢开始阶段。" },
  { id: "q-n28-3", kcId: "n28", difficulty: 4, stem: "TCP 快恢复算法在收到 3 个重复 ACK 后通常：", options: ["把 ssthresh 和 cwnd 都置为 0", "把 ssthresh 减半，并把 cwnd 设为 ssthresh", "继续指数增长", "直接关闭连接"], answerIndex: 1, explanation: "快重传后执行快恢复：ssthresh 减半，cwnd 设为新的 ssthresh，然后直接进入拥塞避免，而不是像超时那样回到慢开始，从而避免吞吐量骤降。" },

  // ── n29 DNS 域名系统 ──
  { id: "q-n29-1", kcId: "n29", difficulty: 1, stem: "DNS 查询默认使用的运输层协议和端口是：", options: ["TCP 53", "UDP 53", "TCP 80", "UDP 67"], answerIndex: 1, explanation: "DNS 查询报文短小且要求快速，默认使用 UDP 53；当响应超过 512 字节或进行区域传送时才使用 TCP 53。" },
  { id: "q-n29-2", kcId: "n29", difficulty: 2, stem: "递归查询与迭代查询的区别是：", options: ["递归查询由服务器代查到底，迭代查询由服务器返回下一步应查询的服务器", "递归查询不使用 DNS", "迭代查询一定更快", "两者完全一样"], answerIndex: 0, explanation: "递归查询中，被询问的服务器负责最终给出答案；迭代查询中，服务器只返回下一级服务器的地址，由查询方继续询问，直到获得答案。" },
  { id: "q-n29-3", kcId: "n29", difficulty: 3, stem: "DNS 缓存的作用是：", options: ["减少重复查询、降低解析时延", "加密域名", "分配 IP 地址", "防止域名冲突"], answerIndex: 0, explanation: "解析器和服务器都会缓存已解析的记录，在 TTL 到期前直接复用，从而减少对根和顶级域服务器的查询；缓存不负责加密、地址分配或域名注册。" },

  // ── n30 HTTP 协议 ──
  { id: "q-n30-1", kcId: "n30", difficulty: 1, stem: "HTTP 协议的基本特点是：", options: ["有状态、面向连接", "无状态、请求-响应式", "面向字节流、无首部", "基于 UDP 的广播协议"], answerIndex: 1, explanation: "HTTP 本身不保存客户端状态，每次请求独立处理，采用请求-响应模式；它通常基于 TCP 提供可靠传输，状态管理需要 Cookie/Session 等机制。" },
  { id: "q-n30-2", kcId: "n30", difficulty: 2, stem: "HTTP/1.1 默认采用持久连接，其好处是：", options: ["复用同一条 TCP 连接发送多个请求，减少握手开销", "不需要 TCP", "自动加密数据", "可以省略响应状态码"], answerIndex: 0, explanation: "持久连接允许在一条 TCP 连接上依次发送多个请求和响应，避免每个请求都重新三次握手，降低时延和服务器负载；它不改变 HTTP 无状态的本质。" },
  { id: "q-n30-3", kcId: "n30", difficulty: 3, stem: "HTTP 状态码 404 表示：", options: ["请求成功", "资源未找到", "服务器内部错误", "永久重定向"], answerIndex: 1, explanation: "404 表示服务器找不到请求的资源；200 表示成功，500 表示服务器内部错误，301 表示永久重定向，四类状态码含义不同。" },

  // ── n31 电子邮件与 FTP ──
  { id: "q-n31-1", kcId: "n31", difficulty: 1, stem: "发送电子邮件通常使用的协议是：", options: ["SMTP", "POP3", "IMAP", "HTTP"], answerIndex: 0, explanation: "SMTP 负责把邮件从客户端提交给服务器以及在服务器之间传输；POP3 和 IMAP 用于从服务器读取邮件，HTTP 用于网页访问。" },
  { id: "q-n31-2", kcId: "n31", difficulty: 2, stem: "FTP 在主动模式下使用的两个端口是：", options: ["20 和 21", "21 和 22", "80 和 443", "53 和 67"], answerIndex: 0, explanation: "FTP 使用 21 端口建立控制连接，20 端口建立数据连接（主动模式）；被动模式的数据端口由服务器临时协商，不固定为 20。" },
  { id: "q-n31-3", kcId: "n31", difficulty: 3, stem: "IMAP 与 POP3 的主要区别是：", options: ["IMAP 在服务器上保留邮件并支持多设备同步，POP3 通常下载后删除", "IMAP 不能接收邮件", "POP3 使用 UDP", "IMAP 只能发送邮件"], answerIndex: 0, explanation: "IMAP 把邮件保存在服务器并同步已读、文件夹等状态，适合多设备；POP3 通常把邮件下载到本地后删除服务器副本，状态不易在多设备间同步。" },

  // ── n32 DHCP 协议 ──
  { id: "q-n32-1", kcId: "n32", difficulty: 1, stem: "DHCP 报文默认使用的传输层协议和端口是：", options: ["TCP 67", "UDP 67/68", "TCP 53", "UDP 53"], answerIndex: 1, explanation: "DHCP 客户端使用 UDP 68，服务器使用 UDP 67；因为客户端还没有 IP 地址，报文以广播方式发送，所以使用无连接的 UDP。" },
  { id: "q-n32-2", kcId: "n32", difficulty: 2, stem: "DHCP 获取地址的四个典型步骤依次是：", options: ["Discover、Offer、Request、Ack", "Request、Offer、Discover、Ack", "Offer、Discover、Ack、Request", "Ack、Request、Offer、Discover"], answerIndex: 0, explanation: "客户端先广播 Discover 寻找服务器，服务器回 Offer 提供地址，客户端再广播 Request 确认选择，服务器最后回 Ack 确认租约，简称 DORA。" },
  { id: "q-n32-3", kcId: "n32", difficulty: 3, stem: "DHCP 租约机制的作用是：", options: ["永久分配地址", "让地址在租期到期后可被回收再利用", "加密地址", "把域名解析为 IP"], answerIndex: 1, explanation: "服务器分配的地址带有租期，客户端需在到期前续租，否则地址被回收，从而避免长期占用和地址浪费；租约与加密、域名解析无关。" },

  // ── n33 Web 缓存与 CDN ──
  { id: "q-n33-1", kcId: "n33", difficulty: 1, stem: "Web 缓存（代理缓存）的主要作用是：", options: ["减少响应时间并降低源服务器和链路负载", "加密网页内容", "分配域名", "防止 ARP 欺骗"], answerIndex: 0, explanation: "缓存把常用资源保存在离用户更近的位置，命中时直接返回，既降低时延又减少回源流量；缓存不负责加密、域名分配或 ARP 安全。" },
  { id: "q-n33-2", kcId: "n33", difficulty: 2, stem: "CDN 的基本原理是：", options: ["把内容分发到离用户较近的边缘节点，就近提供服务", "让所有用户访问同一台源服务器", "用 DNS 加密数据", "把 IP 地址转换为 MAC 地址"], answerIndex: 0, explanation: "CDN 通过全局调度把用户请求导向地理或网络距离较近的边缘节点，缩短响应时间并分担源站压力；它通常借助 DNS 调度，但不负责加密或地址解析。" },
  { id: "q-n33-3", kcId: "n33", difficulty: 3, stem: "浏览器使用 ETag 进行条件请求时，若资源未修改，服务器通常返回：", options: ["200 OK 和完整内容", "304 Not Modified 和空响应体", "404 Not Found", "500 Internal Server Error"], answerIndex: 1, explanation: "浏览器在 If-None-Match 中带上 ETag，服务器比较后发现资源未变，就返回 304 且不发送响应体，浏览器继续使用本地缓存，从而节省带宽。" },

  // ── n34 网络安全威胁与安全模型 ──
  { id: "q-n34-1", kcId: "n34", difficulty: 1, stem: "被动攻击与主动攻击的主要区别是：", options: ["被动攻击不修改数据，主动攻击会篡改或伪造数据", "被动攻击更危险", "主动攻击只窃听", "两者没有区别"], answerIndex: 0, explanation: "被动攻击如窃听、流量分析，只获取信息而不改变数据流；主动攻击如篡改、伪造、重放和拒绝服务，会破坏数据的完整性或可用性。" },
  { id: "q-n34-2", kcId: "n34", difficulty: 2, stem: "信息安全的基本三要素（CIA）是指：", options: ["机密性、完整性、可用性", "可靠性、可扩展性、可维护性", "认证、授权、审计", "加密、压缩、备份"], answerIndex: 0, explanation: "CIA 分别指机密性（防止未授权泄露）、完整性（防止未授权篡改）和可用性（保证授权用户能正常使用）；认证、授权、审计是实现安全目标的机制。" },
  { id: "q-n34-3", kcId: "n34", difficulty: 3, stem: "拒绝服务（DoS）攻击主要破坏的是：", options: ["机密性", "完整性", "可用性", "可移植性"], answerIndex: 2, explanation: "DoS 通过耗尽带宽、连接或计算资源，使合法用户无法获得服务，直接破坏可用性；它通常不窃取或篡改数据，因此机密性和完整性不是主要目标。" },

  // ── n35 对称加密与公钥加密 ──
  { id: "q-n35-1", kcId: "n35", difficulty: 1, stem: "对称加密的特点是：", options: ["加密和解密使用同一密钥，速度快", "加密和解密使用不同密钥", "不需要密钥", "只能加密文本"], answerIndex: 0, explanation: "对称加密的收发双方共享同一密钥，算法效率高，适合加密大量数据；密钥分发是其主要难题，公钥加密常用来解决这个问题。" },
  { id: "q-n35-2", kcId: "n35", difficulty: 2, stem: "公钥加密体制中，用公钥加密的数据应使用什么解密？", options: ["公钥", "私钥", "会话密钥", "哈希值"], answerIndex: 1, explanation: "公钥可以公开，任何人用公钥加密后，只有持有对应私钥的接收方能解密；反过来用私钥加密则用于数字签名，用公钥验证。" },
  { id: "q-n35-3", kcId: "n35", difficulty: 3, stem: "RSA 算法的安全性主要基于：", options: ["大整数分解困难", "矩阵乘法不可逆", "哈希碰撞", "异或运算"], answerIndex: 0, explanation: "RSA 的模数由两个大素数相乘得到，公开模数后想分解出素数在计算上不可行，因此攻击者难以由公钥推出私钥；这与矩阵、哈希和异或无关。" },

  // ── n36 报文鉴别与数字签名 ──
  { id: "q-n36-1", kcId: "n36", difficulty: 1, stem: "数字签名的正确使用方式是：", options: ["用发送方私钥签名，用发送方公钥验证", "用接收方私钥签名，用接收方公钥验证", "用对称密钥签名", "用公钥签名，用私钥验证"], answerIndex: 0, explanation: "私钥只有发送方掌握，用私钥生成的签名可证明消息来源且不可抵赖；验证者用发送方公开的公钥验证签名，因此签名与密钥用途不能颠倒。" },
  { id: "q-n36-2", kcId: "n36", difficulty: 2, stem: "安全哈希函数应具备的性质是：", options: ["可逆、速度快", "单向性、抗碰撞性、雪崩效应", "只能处理短消息", "必须使用公钥"], answerIndex: 1, explanation: "哈希函数应难以由摘要反推原文（单向性），难以找到两个不同输入得到同一摘要（抗碰撞），且输入微小变化会导致摘要大幅变化（雪崩效应）；它不是加密算法，不需要可逆。" },
  { id: "q-n36-3", kcId: "n36", difficulty: 4, stem: "消息认证码（MAC）与数字签名的主要区别是：", options: ["MAC 使用共享密钥，不能向第三方证明来源；签名使用公私钥，可防抵赖", "MAC 更安全", "签名不需要密钥", "两者完全等价"], answerIndex: 0, explanation: "MAC 由收发双方共享的密钥计算，第三方无法验证，因此不能防止发送方抵赖；数字签名用私钥生成、公钥验证，任何第三方都可验证，具有不可否认性。" },

  // ── n37 TLS 与 HTTPS ──
  { id: "q-n37-1", kcId: "n37", difficulty: 1, stem: "HTTPS 默认使用的端口是：", options: ["80", "443", "21", "53"], answerIndex: 1, explanation: "HTTPS 是 HTTP over TLS，默认端口为 443；HTTP 默认 80，FTP 控制连接默认 21，DNS 默认 53，端口不同是区分服务的重要标志。" },
  { id: "q-n37-2", kcId: "n37", difficulty: 2, stem: "TLS 握手阶段的核心任务是：", options: ["验证服务器证书并协商会话密钥", "分配 IP 地址", "进行路由选择", "压缩网页"], answerIndex: 0, explanation: "TLS 握手先验证服务器证书链以确认身份，再通过密钥交换协商出本次会话使用的对称密钥；IP 分配由 DHCP 完成，路由由网络层完成。" },
  { id: "q-n37-3", kcId: "n37", difficulty: 4, stem: "HTTPS 采用混合加密的原因是：", options: ["公钥加密速度慢，适合交换密钥；对称加密速度快，适合加密大量数据", "对称加密不需要密钥", "公钥加密无法验证身份", "混合加密可以省略证书"], answerIndex: 0, explanation: "非对称加密计算开销大，只用来安全地协商或传输会话密钥；随后用高效的对称加密保护应用数据，兼顾安全性与性能，证书仍然必需。" },

  // ── n38 无线局域网 ──
  { id: "q-n38-1", kcId: "n38", difficulty: 1, stem: "IEEE 802.11 无线局域网采用的介质访问控制方式是：", options: ["CSMA/CD", "CSMA/CA", "令牌环", "TDMA"], answerIndex: 1, explanation: "无线站点难以边发送边检测冲突，因此 802.11 采用载波监听与冲突避免，通过随机退避和可选的 RTS/CTS 减少冲突；CSMA/CD 用于有线以太网。" },
  { id: "q-n38-2", kcId: "n38", difficulty: 2, stem: "无线网络中的「隐藏站」问题是指：", options: ["两个站点彼此听不到对方，却可能同时向同一 AP 发送造成冲突", "站点被防火墙隐藏", "MAC 地址被隐藏", "AP 不广播 SSID"], answerIndex: 0, explanation: "由于距离或障碍物，两个站点互相听不到，但都能与 AP 通信，于是可能同时发送而在 AP 处冲突；RTS/CTS 机制可让 AP 统一协调，缓解该问题。" },
  { id: "q-n38-3", kcId: "n38", difficulty: 3, stem: "无线接入点（AP）在 WLAN 中的作用是：", options: ["连接无线站点并转发到有线网络", "分配 MAC 地址", "进行域名解析", "加密所有 IP 报文"], answerIndex: 0, explanation: "AP 是无线站点接入网络的桥梁，负责无线帧与有线帧的转换和转发；MAC 地址由网卡固定，域名解析由 DNS 完成，AP 本身不负责 IP 层加密。" },

  // ── n39 移动通信与 5G ──
  { id: "q-n39-1", kcId: "n39", difficulty: 1, stem: "蜂窝移动通信采用频率复用的原因是：", options: ["频谱资源有限，相隔足够远的基站可重复使用同一频率", "为了让手机更省电", "为了加密通信", "为了增加手机屏幕尺寸"], answerIndex: 0, explanation: "无线频谱是稀缺资源，把服务区划分为小区并让空间上相隔足够远的小区使用相同频率，可在不增加总带宽的情况下提高系统容量。" },
  { id: "q-n39-2", kcId: "n39", difficulty: 2, stem: "5G 相比 4G 的主要提升不包括：", options: ["更高的峰值速率", "更低的时延", "更大的连接密度", "更长的电池寿命是唯一目标"], answerIndex: 3, explanation: "5G 的三大典型场景是增强移动宽带、超可靠低时延通信和海量机器类通信，强调速率、时延和连接密度；电池寿命不是唯一目标，也不是其与 4G 的核心区别。" },
  { id: "q-n39-3", kcId: "n39", difficulty: 3, stem: "5G 采用网络切片技术的主要目的是：", options: ["在一张物理网络上划分出多个满足不同需求的逻辑网络", "把网络切成更多网线", "增加手机卡数量", "取消 IP 协议"], answerIndex: 0, explanation: "网络切片通过虚拟化在一张物理网络上生成多个隔离的逻辑网络，分别服务低时延、大带宽或海量连接等不同业务，提高资源利用率和灵活性。" },

  // ── n40 SDN 与网络新技术 ──
  { id: "q-n40-1", kcId: "n40", difficulty: 1, stem: "SDN 的核心思想是：", options: ["控制平面与数据平面分离，由集中控制器统一编程", "把所有路由器换成交换机", "取消 IP 地址", "只使用无线传输"], answerIndex: 0, explanation: "SDN 把负责决策的控制平面从转发设备中抽离，集中到控制器上，设备只按流表转发；这样可以通过软件统一编程和管理网络，而不是取消 IP 或只换硬件。" },
  { id: "q-n40-2", kcId: "n40", difficulty: 3, stem: "OpenFlow 协议中，交换机根据什么转发分组？", options: ["流表", "MAC 地址表", "路由表", "ARP 缓存"], answerIndex: 0, explanation: "OpenFlow 交换机维护控制器下发的流表，按匹配字段（如源/目的 IP、端口）和动作（转发、丢弃、修改）处理分组；传统交换机用 MAC 表，路由器用路由表。" },
  { id: "q-n40-3", kcId: "n40", difficulty: 4, stem: "网络功能虚拟化（NFV）与 SDN 的主要区别是：", options: ["NFV 把专用网络设备的功能用软件实现，SDN 侧重控制与转发分离", "两者完全相同", "NFV 只做路由，SDN 只做交换", "NFV 不需要服务器"], answerIndex: 0, explanation: "NFV 关注用通用服务器上的软件替代防火墙、负载均衡等专用硬件，SDN 关注网络控制逻辑的集中与可编程；两者可互补，但解决的问题不同。" },
];
