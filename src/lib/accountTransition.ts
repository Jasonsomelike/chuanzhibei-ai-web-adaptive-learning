/**
 * 账号切换时浏览器级存档的处置计划。
 *
 * 这些存档（学习进度、上传知识库、搜索/语音密钥、教材与讲义）都不分账号，
 * 换人时必须显式决定清还是留，否则 B 会读到 A 的笔记与密钥。
 * 把规则收成一个纯函数，登录、注册、登出与「直接换号登录」走同一份判断，
 * 不再各自手写 if。
 *
 * 规则：
 * - A→B、A→null：全部清除。上一账号的数据不能留给下一个人，也不能回流到匿名态。
 * - null→B：只登记归属，不清任何东西。本机数据本来就是当前这个人的匿名数据，
 *   learner 要保留下来并入账号（进度合并由 useLearner 完成），资料与密钥同理。
 * - B→B、null→null：什么都不用清。
 */

/** 资料归属键；与 useAuth / 资料面板共用同一个键，避免两处各写一份。 */
export const ACCOUNT_OWNER_KEY = "alp.materials.owner";

export interface AccountTransitionPlan {
  /** 清 localStorage 里的学习者进度（随后以服务端/新匿名状态为准）。 */
  readonly clearLearner: boolean;
  /** 清 IndexedDB 里的上传知识库（文档与片段）。 */
  readonly clearKb: boolean;
  /** 清搜索与语音配置里的密钥（Tavily、TTS）。 */
  readonly clearSecrets: boolean;
  /** 清教材正文、口径选择、讲义与章节勾选。 */
  readonly clearMaterials: boolean;
  /** 切换后应写入归属键的邮箱；null 表示归属键应删除（匿名）。 */
  readonly nextOwner: string | null;
}

/** 空串与纯空白都视为匿名；归属键在 localStorage 里可能就是空串。 */
function cleanOwner(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 邮箱比较不区分大小写：同一账号用不同大小写登录不应被当成换人，
 * 否则会把本机资料误清一次。
 */
function sameAccount(prev: string, next: string | null): boolean {
  return next !== null && prev.toLowerCase() === next.toLowerCase();
}

/**
 * 算出一次账号切换要清哪些存档。
 *
 * prevOwner 取自归属键（从未登录过时为 null），nextEmail 是本次登录/注册的邮箱。
 * 只有「上一个归属是一个账号，且与本次不是同一个账号」才需要清除；
 * 匿名态没有可泄漏的外人数据，因此 null→B 一律保留。
 */
export function planAccountTransition(
  prevOwner: string | null | undefined,
  nextEmail: string | null | undefined,
): AccountTransitionPlan {
  const prev = cleanOwner(prevOwner);
  const next = cleanOwner(nextEmail);

  const foreign = prev !== null && !sameAccount(prev, next);

  return {
    clearLearner: foreign,
    clearKb: foreign,
    clearSecrets: foreign,
    clearMaterials: foreign,
    nextOwner: next,
  };
}
