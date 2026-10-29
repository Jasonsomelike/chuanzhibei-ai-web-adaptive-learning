/**
 * 记忆卡的服务端读写（/api/memories）。
 *
 * 这些函数都跑在同步的后台路径上：一次网络失败不应打断答题或复习，
 * 所以一律不抛错——失败用 null / false 表示，调用方保留本地状态，
 * 下一次变更再写穿。返回值里的卡片仍要过 parseMemories：
 * 服务端响应与本地缓存一样是不可信输入（旧版本写的行可能形状已变）。
 */

import { parseMemories, type MemoryItem } from "@/lib/memory";

const ENDPOINT = "/api/memories";

function cleanId(value: string): string {
  return value.trim();
}

/**
 * 拉取某学科的记忆卡。
 *
 * 未登录（401）、网络失败、响应形状不对都返回 null，与「服务端确实没有卡」
 * （返回空数组）区分开：调用方只有在拿到数组时才应该用远端覆盖/合并本地，
 * 否则一次断网会把本机卡片当成「服务端为空」。
 */
export async function pullMemories(
  subjectId: string,
): Promise<readonly MemoryItem[] | null> {
  const subject = cleanId(subjectId);
  if (subject === "") return null;

  try {
    const res = await fetch(`${ENDPOINT}?subjectId=${encodeURIComponent(subject)}`, {
      cache: "no-store",
      // 与知识库同理：远端悬挂时不能把本地记忆卡一起卡住
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { memories?: unknown };
    if (!Array.isArray(data.memories)) return null;
    return parseMemories(data.memories);
  } catch {
    return null;
  }
}

/**
 * 把某学科的记忆卡写穿到服务端。
 *
 * 服务端是 LWW upsert：只更新提交里出现的卡，不在列表里的行原样保留。
 * 也就是说删除必须走 clearMemories / deleteMemory，普通快照推送永远不会删卡。
 * 发送前再清洗一次：重复 id 会被契约拒绝（400），超量或坏记录也不该上线。
 */
export async function pushMemories(
  subjectId: string,
  memories: readonly MemoryItem[],
): Promise<boolean> {
  const subject = cleanId(subjectId);
  if (subject === "") return false;

  try {
    const res = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId: subject, memories: parseMemories(memories) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 清空某学科的全部记忆卡（显式删除）。
 *
 * 返回 true 只代表服务端接受了删除请求；本来就没有卡时 deleted=0 也算成功，
 * 幂等对调用方更友好。真正的删除数不在界面上展示。
 */
export async function clearMemories(subjectId: string): Promise<boolean> {
  const subject = cleanId(subjectId);
  if (subject === "") return false;

  try {
    const res = await fetch(`${ENDPOINT}?subjectId=${encodeURIComponent(subject)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 显式删除一张记忆卡。这是唯一不会在下次同步时被其它设备快照复活的删除方式。 */
export async function deleteMemory(memId: string): Promise<boolean> {
  const id = cleanId(memId);
  if (id === "") return false;

  try {
    const res = await fetch(`${ENDPOINT}?memId=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}
