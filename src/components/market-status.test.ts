import { describe, expect, it } from "vitest";

import {
  MARKET_LOAD_ERROR_MESSAGE,
  MARKET_RETRY_LABEL,
  marketStatusOf,
} from "@/components/market-status";

/**
 * F8：市场把 /api/directions 的 5xx 渲染成「还没有人公开方向」。
 * 状态判定收在这个纯函数里，失败、空态、加载态三者互斥。
 */
const IDLE = { loading: false, error: false, count: 0, query: "" } as const;

describe("marketStatusOf", () => {
  it("加载中返回加载态", () => {
    const status = marketStatusOf({ ...IDLE, loading: true });
    expect(status.kind).toBe("loading");
    expect(status.hint).toContain("加载中");
    expect(status.message).toContain("正在加载");
    expect(status.canRetry).toBe(false);
  });

  it("加载失败返回错误态与固定文案", () => {
    const status = marketStatusOf({ ...IDLE, error: true });
    expect(status.kind).toBe("error");
    expect(status.message).toBe("加载失败，请重试");
    expect(status.message).toBe(MARKET_LOAD_ERROR_MESSAGE);
    expect(status.canRetry).toBe(true);
    expect(status.showCreate).toBe(false);
  });

  it("失败优先于空态：count=0 也不能说「还没有人公开方向」", () => {
    const status = marketStatusOf({ ...IDLE, error: true, count: 0 });
    expect(status.kind).toBe("error");
    expect(status.message).not.toContain("还没有人公开方向");
  });

  it("失败优先于加载态：正在重试也不能退回加载文案", () => {
    const status = marketStatusOf({ ...IDLE, loading: true, error: true });
    expect(status.kind).toBe("error");
  });

  it("错误文案不拼接查询词，也不透出后端细节", () => {
    const status = marketStatusOf({
      ...IDLE,
      error: true,
      query: "500 Internal Server Error",
    });
    expect(status.message).toBe(MARKET_LOAD_ERROR_MESSAGE);
    expect(status.message).not.toContain("500");
    expect(status.message).not.toContain("Internal");
  });

  it("count=0 返回空态并给出创建入口", () => {
    const status = marketStatusOf(IDLE);
    expect(status.kind).toBe("empty");
    expect(status.message).toContain("还没有人公开方向");
    expect(status.showCreate).toBe(true);
    expect(status.canRetry).toBe(false);
  });

  it("空态带关键词时提示没有匹配项", () => {
    const status = marketStatusOf({ ...IDLE, query: " 树结构 " });
    expect(status.kind).toBe("empty");
    expect(status.message).toBe("没有匹配「树结构」的方向。");
  });

  it("有数据时返回列表态并给出条数", () => {
    const status = marketStatusOf({ ...IDLE, count: 3, query: "树" });
    expect(status.kind).toBe("list");
    expect(status.hint).toBe("共 3 个公开方向");
    expect(status.message).toBeNull();
    expect(status.canRetry).toBe(false);
    expect(status.showCreate).toBe(false);
  });

  it("加载中即使已有旧数据也标记加载态", () => {
    const status = marketStatusOf({ ...IDLE, loading: true, count: 5 });
    expect(status.kind).toBe("loading");
    expect(status.hint).toBe("加载中…");
  });

  it("重试按钮文案是常量", () => {
    expect(MARKET_RETRY_LABEL).toBe("重试");
  });
});
