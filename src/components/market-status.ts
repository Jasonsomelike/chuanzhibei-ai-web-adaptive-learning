/**
 * 方向市场的状态判定。
 *
 * 页面只负责网络与渲染；「该显示加载 / 加载失败 / 空态 / 列表」由这里决定。
 * 抽出来的直接原因：旧逻辑只判 `res.ok`，请求失败后 items 仍是空数组，
 * 界面就把 5xx 渲染成「还没有人公开方向」——用户会以为市场本来就是空的。
 * 失败与空态必须是两种状态：失败要给可重试的错误文案，空态才给创建入口。
 *
 * 边界：不碰 fetch、React、localStorage；同样的输入必须得到同样的输出。
 */

export interface MarketStatus {
  /** 列表区域该渲染哪种状态。 */
  readonly kind: "loading" | "error" | "empty" | "list";
  /** 分区标题右侧的提示文字。 */
  readonly hint: string;
  /** 列表区域正文；正常列表时不需要额外文案。 */
  readonly message: string | null;
  /** 是否给出「重试」按钮。 */
  readonly canRetry: boolean;
  /** 是否给出「创建方向」入口。 */
  readonly showCreate: boolean;
}

export interface MarketStatusInput {
  readonly loading: boolean;
  /** 上一次加载是否失败。只保留布尔值，后端错误细节没有进入界面的通道。 */
  readonly error: boolean;
  /** 成功加载到的条目数。 */
  readonly count: number;
  /** 当前搜索词，用于空态文案。 */
  readonly query: string;
}

/** 固定的加载失败文案：不透出 HTTP 状态码、上游报错或堆栈。 */
export const MARKET_LOAD_ERROR_MESSAGE = "加载失败，请重试";

export const MARKET_RETRY_LABEL = "重试";

export function marketStatusOf(input: MarketStatusInput): MarketStatus {
  const query = input.query.trim();

  /*
   * 失败优先于加载与空态：重试请求还在路上时若上一次已失败，
   * 界面不能退回「空市场」。count 为 0 也不能把错误说成空态。
   */
  if (input.error) {
    return {
      kind: "error",
      hint: "加载失败",
      message: MARKET_LOAD_ERROR_MESSAGE,
      canRetry: true,
      showCreate: false,
    };
  }

  if (input.loading) {
    return {
      kind: "loading",
      hint: "加载中…",
      message: "正在加载公开方向…",
      canRetry: false,
      showCreate: false,
    };
  }

  if (input.count <= 0) {
    return {
      kind: "empty",
      hint: "共 0 个公开方向",
      message:
        query !== ""
          ? `没有匹配「${query}」的方向。`
          : "还没有人公开方向。你可以先创建并公开一个。",
      canRetry: false,
      showCreate: true,
    };
  }

  return {
    kind: "list",
    hint: `共 ${input.count} 个公开方向`,
    message: null,
    canRetry: false,
    showCreate: false,
  };
}
