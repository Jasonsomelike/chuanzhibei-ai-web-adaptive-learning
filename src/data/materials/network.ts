/**
 * 计算机网络内置资料包：第 5 章（运输层）。
 *
 * 章名必须与 src/data/subjects/network.ts 中 n23–n28 的 chapter 字面量一致。
 * 本包故意保留两处真实译名分歧（运输层 / 传输层、慢开始 / 慢启动）：
 * 它们不是文字游戏，而是学生读不同教材、不同 RFC 译本时确实会遇到的冲突，
 * 用来验证「不替用户选边」这条产品约束。
 */

import type { MaterialPack } from "@/lib/materials";

export const networkMaterialPack: MaterialPack = {
  id: "network",
  title: "计算机网络（运输层）",
  sources: [
    {
      id: "net-textbook",
      kind: "textbook",
      title: "计算机网络（第 8 版）",
      author: "谢希仁",
      publisher: "电子工业出版社",
      edition: "第 8 版",
      year: 2021,
      note: "覆盖第 5 章运输层，页码为纸质书页码",
    },
    {
      id: "net-lecture",
      kind: "lecture",
      title: "计算机网络课堂讲义（第 5 章）",
      author: "课程组",
      note: "按课时编排，页码为讲义页码，与教材页码不通用",
    },
  ],
  chunks: [
    {
      id: "net-n23-text-1",
      sourceId: "net-textbook",
      kcIds: ["n23"],
      chapter: "第5章 运输层",
      section: "5.1 运输层协议概述",
      pageFrom: 182,
      pageTo: 184,
      text:
        "运输层为相互通信的应用进程提供逻辑通信。它使用端口号完成复用与分用：" +
        "发送方多个应用进程可以共用同一个运输层协议，接收方依据目的端口把数据交付给对应的进程。" +
        "端口号为 16 位，套接字由 IP 地址与端口号共同标识。",
    },
    {
      id: "net-n23-lect-1",
      sourceId: "net-lecture",
      kcIds: ["n23"],
      chapter: "第5章 运输层",
      section: "5.1 章名与端到端通信",
      pageFrom: 1,
      pageTo: 2,
      text:
        "本课程沿用谢希仁教材的章节命名，第 5 章称为运输层；部分教材与 RFC 中文译本把它称为传输层，" +
        "指的是同一层（transport layer）。阅读英文资料时 transport layer 一律对应该章，" +
        "不要因为译名不同而当成两章。",
    },
    {
      id: "net-n24-text-1",
      sourceId: "net-textbook",
      kcIds: ["n24"],
      chapter: "第5章 运输层",
      section: "5.2 UDP 协议",
      pageFrom: 186,
      pageTo: 188,
      text:
        "UDP 只在 IP 数据报服务之上增加了复用分用和差错检测功能。首部只有 8 字节，" +
        "由源端口、目的端口、长度和校验和组成。" +
        "UDP 不保证可靠交付，适合实时音视频、DNS 查询等对时延敏感或可容忍少量丢包的场景。",
    },
    {
      id: "net-n25-text-1",
      sourceId: "net-textbook",
      kcIds: ["n25"],
      chapter: "第5章 运输层",
      section: "5.3 TCP 连接管理",
      pageFrom: 190,
      pageTo: 194,
      text:
        "TCP 用三次握手建立连接：客户端发送 SYN 并携带初始序号，服务器回复 SYN+ACK，客户端再发送 ACK。" +
        "四次挥手释放连接，主动关闭方进入 TIME_WAIT 并等待 2MSL，" +
        "以保证最后一个 ACK 能够到达，并让旧报文在网络中消失。",
    },
    {
      id: "net-n26-text-1",
      sourceId: "net-textbook",
      kcIds: ["n26"],
      chapter: "第5章 运输层",
      section: "5.4 TCP 可靠传输",
      pageFrom: 195,
      pageTo: 198,
      text:
        "TCP 使用序号与确认号实现累积确认；超时重传时间 RTO 根据往返时间 RTT 的加权平均值与偏差动态计算。" +
        "接收方连续发送重复 ACK 时，发送方收到 3 个重复 ACK 可触发快速重传，不必等到超时。",
    },
    {
      id: "net-n26-lect-1",
      sourceId: "net-lecture",
      kcIds: ["n26"],
      chapter: "第5章 运输层",
      section: "5.4 快速重传的触发条件",
      pageFrom: 28,
      pageTo: 30,
      text:
        "快速重传的判据是连续收到 3 个重复 ACK，而不是收到 1 个。收到重复 ACK 说明有报文段失序或丢失，" +
        "连续三个则大概率是该序号之后的报文段丢了；此时立即重传，不等超时计时器到期。",
    },
    {
      id: "net-n27-text-1",
      sourceId: "net-textbook",
      kcIds: ["n27"],
      chapter: "第5章 运输层",
      section: "5.5 TCP 流量控制",
      pageFrom: 199,
      pageTo: 201,
      text:
        "流量控制通过接收窗口 rwnd 通告接收方剩余缓存。接收方通告零窗口后，" +
        "发送方启动持续计时器，定期发送零窗口探测报文；窗口更新报文丢失时，双方不会永久等待。" +
        "糊涂窗口综合征可用延迟确认与 Nagle 算法缓解。",
    },
    {
      id: "net-n28-text-1",
      sourceId: "net-textbook",
      kcIds: ["n28"],
      chapter: "第5章 运输层",
      section: "5.6 TCP 拥塞控制",
      pageFrom: 202,
      pageTo: 206,
      text:
        "拥塞控制包括慢开始、拥塞避免、快重传与快恢复四个算法。慢开始阶段拥塞窗口 cwnd 从较小值开始，" +
        "每经过一个 RTT 翻倍；达到慢开始门限 ssthresh 后转入拥塞避免，每个 RTT 只增加约一个 MSS。" +
        "收到 3 个重复 ACK 时执行快重传与快恢复：ssthresh 减半，cwnd 设为新的 ssthresh，随后直接进入拥塞避免。",
    },
    {
      id: "net-n28-lect-1",
      sourceId: "net-lecture",
      kcIds: ["n28"],
      chapter: "第5章 运输层",
      section: "5.6 慢开始与慢启动的译名",
      pageFrom: 31,
      pageTo: 33,
      text:
        "教材写「慢开始」，部分中文资料写成「慢启动」，英文都是 slow start，指同一个算法：" +
        "从较小的 cwnd 起步、每 RTT 翻倍。慢开始并不慢，名字强调的是起点小而不是增长速度慢；" +
        "答题时两种译名都可以，但同一份作业里应保持统一。",
    },
  ],
  claims: [
    {
      id: "net-claim-chapter-a",
      kcId: "n23",
      topic: "第 5 章的章名",
      statement: "第 5 章叫运输层",
      basis: "textbook",
      sourceId: "net-textbook",
      pageFrom: 182,
      pageTo: 182,
    },
    {
      id: "net-claim-chapter-b",
      kcId: "n23",
      topic: "第 5 章的章名",
      statement: "第 5 章叫传输层",
      basis: "lecture",
      sourceId: "net-lecture",
      pageFrom: 1,
      pageTo: 1,
    },
    {
      id: "net-claim-slow-a",
      kcId: "n28",
      topic: "slow start 的中文译名",
      statement: "slow start 叫慢开始",
      basis: "textbook",
      sourceId: "net-textbook",
      pageFrom: 202,
      pageTo: 202,
    },
    {
      id: "net-claim-slow-b",
      kcId: "n28",
      topic: "slow start 的中文译名",
      statement: "slow start 叫慢启动",
      basis: "lecture",
      sourceId: "net-lecture",
      pageFrom: 31,
      pageTo: 31,
    },
    {
      id: "net-claim-zero-window",
      kcId: "n27",
      topic: "零窗口时发送方的动作",
      statement: "启动持续计时器，定期发送零窗口探测报文",
      basis: "textbook",
      sourceId: "net-textbook",
      pageFrom: 201,
      pageTo: 201,
    },
  ],
};
