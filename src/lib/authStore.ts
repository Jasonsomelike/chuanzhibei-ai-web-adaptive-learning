"use client";

/**
 * 登录态的单一真相（模块级共享 store）。
 *
 * 旧实现 useAuth 是普通 hook：每个调用方各自 useState，只在挂载时 refresh 一次。
 * 导航栏、设置页、导师页是互不相干的实例，登录 / 登出只更新其中一个，
 * 于是出现「设置页显示已保存，导师页仍认为未登录」。
 *
 * 现在所有实例通过 useSyncExternalStore 订阅同一个 snapshot：
 *   - subscribe / getSnapshot 供 useSyncExternalStore 使用；
 *   - refresh 在多个组件同时挂载时只发一次请求（in-flight 去重）；
 *   - login / register / logout 直接改共享 snapshot，所有订阅者同步更新。
 *
 * 跨标签页：会话 cookie 的变化不会触发 storage 事件，所以除了 storage，
 * 还要在 visibilitychange / focus 回到前台时 refresh 一次；refresh 只认 200，
 * 断网不会把当前 user 与本机数据清空。
 *
 * 换账号时的清除规则仍由 accountTransition.planAccountTransition 决定，
 * 本文件只执行计划（applyAccountTransition），不另写一套清库流程。
 */

import { MATERIALS_STORAGE_KEY } from "@/lib/materials";
import { clearProgressSyncCache } from "@/lib/progressClient";
import { CHAPTERS_STORAGE_KEY } from "@/lib/chapters";
import { MATERIALS_CHANGED_EVENT } from "@/lib/materialStore";
import { clearKbDatabase } from "@/lib/kbStore";
import { resetKbStorageCache } from "@/lib/kbRemote";
import { clearProvider, hydrateProviderFromServer } from "@/lib/provider";
import { SEARCH_CONFIG_KEY } from "@/lib/searchClient";
import { CALL_MODE_KEY } from "@/lib/serverConfig";
import { TTS_STORAGE_KEY } from "@/lib/tts";
import {
  ACCOUNT_OWNER_KEY,
  planAccountTransition,
  type AccountTransitionPlan,
} from "@/lib/accountTransition";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly createdAt: string;
}

export interface AuthSnapshot {
  readonly user: AuthUser | null;
  readonly loading: boolean;
}

export interface AuthStore {
  /** 供 useSyncExternalStore 订阅；返回退订函数。 */
  subscribe(listener: () => void): () => void;
  /** 当前快照。同一份状态返回同一个对象，避免 useSyncExternalStore 反复渲染。 */
  getSnapshot(): AuthSnapshot;
  /** 服务端渲染 / hydration 用的固定快照。 */
  getServerSnapshot(): AuthSnapshot;
  /** 读取 /api/auth；并发调用共享同一个请求。 */
  refresh(): Promise<void>;
  login(email: string, password: string): Promise<AuthUser>;
  register(email: string, password: string, displayName: string): Promise<AuthUser>;
  logout(): Promise<void>;
}

/** 与 learner.ts 的存储键保持一致；该常量没有导出，这里单独写一份并加注释。 */
const LEARNER_STORAGE_KEY = "alp.learner.v2";
/** 当前选中的目标（学科/方向）。登出时清掉，避免下一位用户看到上一位的界面状态。 */
const SUBJECT_STORAGE_KEY = "alp.subject";

/** 回到前台后的 refresh 节流窗口：一次切回只刷新一次。 */
const FOREGROUND_REFRESH_MIN_MS = 1000;

/**
 * 服务端与 hydration 阶段的固定快照。
 *
 * 必须是同一个对象：useSyncExternalStore 会在每次渲染时比较它，
 * 每次新建对象会让 React 认为状态一直在变。
 */
const SERVER_SNAPSHOT: AuthSnapshot = Object.freeze({ user: null, loading: true });

let snapshot: AuthSnapshot = SERVER_SNAPSHOT;
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
/**
 * 每次 login / register / logout 递增。
 * 用来丢弃「登出前发出、登出后才回来」的 refresh 响应，避免旧响应把 user 写回去。
 */
let generation = 0;
let windowSyncInstalled = false;
let lastForegroundRefresh = 0;

function sameUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.id === b.id &&
    a.email === b.email &&
    a.displayName === b.displayName &&
    a.createdAt === b.createdAt
  );
}

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** 只在 user 或 loading 真正变化时替换 snapshot 并通知订阅者。 */
function commit(next: AuthSnapshot): void {
  const user = sameUser(snapshot.user, next.user) ? snapshot.user : next.user;
  if (user === snapshot.user && next.loading === snapshot.loading) return;
  snapshot = { user, loading: next.loading };
  emit();
}

function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 隐私模式下可能不可用，忽略 */
  }
}

function readOwner(): string | null {
  try {
    return window.localStorage.getItem(ACCOUNT_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(owner: string | null): void {
  try {
    if (owner === null) window.localStorage.removeItem(ACCOUNT_OWNER_KEY);
    else window.localStorage.setItem(ACCOUNT_OWNER_KEY, owner);
  } catch {
    /* 存不进去就算了，本次会话仍按内存里的 user 工作 */
  }
}

/** 搜索与语音的密钥同样是浏览器级的，而且不在 provider 配置里。 */
function clearBrowserSecrets(): void {
  clearProvider();
  removeLocal(SEARCH_CONFIG_KEY);
  removeLocal(TTS_STORAGE_KEY);
  /*
   * 调用模式（服务端代发 / 本机直连）跟随账号：A 选了本机直连后，
   * B 登录时若继承这个值，会在没有本机 key 的情况下被当成「未配置」。
   */
  removeLocal(CALL_MODE_KEY);
}

/** 清掉资料存档并通知已挂载的面板重读；同标签页的 removeItem 不会触发 storage 事件。 */
function clearMaterialsAndChapters(): void {
  try {
    window.localStorage.removeItem(MATERIALS_STORAGE_KEY);
    window.localStorage.removeItem(CHAPTERS_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(MATERIALS_CHANGED_EVENT));
  } catch {
    /* SSR 或隐私模式下没有 window.dispatchEvent */
  }
}

function forceClearPlan(nextOwner: string | null): AccountTransitionPlan {
  return {
    clearLearner: true,
    clearKb: true,
    clearSecrets: true,
    clearMaterials: true,
    nextOwner,
  };
}

/** 执行一份切换计划；任何一步失败都不影响其余步骤。 */
async function applyAccountTransition(plan: AccountTransitionPlan): Promise<void> {
  if (typeof window === "undefined") return;

  if (plan.clearLearner) {
    removeLocal(LEARNER_STORAGE_KEY);
    clearProgressSyncCache();
  }
  if (plan.clearSecrets) clearBrowserSecrets();
  if (plan.clearMaterials) clearMaterialsAndChapters();
  if (plan.clearKb) {
    // 实例缓存里带着 firstSynced：复用旧实例会漏推登出期间新增的文档
    resetKbStorageCache();
    await clearKbDatabase();
  }

  writeOwner(plan.nextOwner);
}

/**
 * 登录/注册/refresh 成功后调用：按归属键判断是否换人。
 *
 * prev 只为一种情况存在：user.id 变了但邮箱没变（账号被重建）。
 * 归属键只记邮箱，planAccountTransition 会当成同一人，本地数据就留下了；
 * 这里显式补一次全清，服务端进度是按 user.id 存的，不补会串号。
 */
async function applyUserTransition(prev: AuthUser | null, next: AuthUser | null): Promise<void> {
  /*
   * 归属键是首选来源；旧存档可能没有它，此时用内存里的上一位用户兜底。
   * 两者都没有才是真正的匿名态（null→B 要保留本机数据）。
   */
  const prevOwner = readOwner() ?? prev?.email ?? null;
  const plan = planAccountTransition(prevOwner, next?.email ?? null);
  const idChanged = prev !== null && next !== null && prev.id !== next.id;
  await applyAccountTransition(
    idChanged && !plan.clearLearner ? forceClearPlan(plan.nextOwner) : plan,
  );
}

/**
 * 挂载一次性的跨标签页 / 回前台同步。
 *
 * storage 只在「其它标签页」写入 localStorage 时触发；cookie 变化不会触发它，
 * 所以切回前台时必须主动 refresh 一次，才能发现别处登录 / 登出。
 */
function installWindowSync(): void {
  if (windowSyncInstalled || typeof window === "undefined") return;
  windowSyncInstalled = true;

  /*
   * 只对账号归属键的变化刷新：进度 / 主题等 localStorage 写入很频繁，
   * 每次都打一次 /api/auth 没有意义。key 为 null 表示整份存储被清空。
   * 会话 cookie 本身不会触发 storage，所以下面还要监听回前台。
   */
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === null || event.key === ACCOUNT_OWNER_KEY) void refresh();
  });

  const refreshOnForeground = (): void => {
    const now = Date.now();
    if (now - lastForegroundRefresh < FOREGROUND_REFRESH_MIN_MS) return;
    lastForegroundRefresh = now;
    void refresh();
  };

  window.addEventListener("focus", refreshOnForeground);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshOnForeground();
  });
}

function subscribe(listener: () => void): () => void {
  installWindowSync();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AuthSnapshot {
  return snapshot;
}

function getServerSnapshot(): AuthSnapshot {
  return SERVER_SNAPSHOT;
}

/**
 * 读取当前会话。
 *
 * 只有拿到 200 响应才算「知道了当前账号」；5xx/网络失败按未知处理，
 * 不执行切换计划——一次断网不能把本机进度与资料清空。
 */
async function performRefresh(): Promise<void> {
  const startedAt = generation;
  try {
    const res = await fetch("/api/auth", { cache: "no-store" });
    if (!res.ok) return;

    const data = (await res.json()) as { user?: AuthUser | null };
    // 请求期间发生了登录 / 登出：这是一份过期响应，直接丢弃
    if (startedAt !== generation) return;

    const next = data.user ?? null;
    const previousUser = snapshot.user;
    if (previousUser?.id !== next?.id) commit({ user: null, loading: true });
    await applyUserTransition(previousUser, next);
    if (startedAt !== generation) return;
    commit({ user: next, loading: false });

    // 新设备本地没有 apiKey：服务端若已保存 llm 配置，靠这次水合生成本地状态。
    if (next !== null) void hydrateProviderFromServer();
  } catch {
    /* 网络失败：保留当前 user 与本机数据 */
  } finally {
    if (startedAt === generation && snapshot.loading) {
      commit({ user: snapshot.user, loading: false });
    }
  }
}

function refresh(): Promise<void> {
  installWindowSync();
  if (inFlight !== null) return inFlight;

  const run = performRefresh();
  inFlight = run;
  void run.finally(() => {
    if (inFlight === run) inFlight = null;
  });
  return run;
}

/** 登录 / 注册成功后的统一提交：换人清理、写快照、水合服务端配置。 */
async function commitAuthenticated(next: AuthUser): Promise<AuthUser> {
  const previousUser = snapshot.user;
  if (previousUser?.id !== next.id) commit({ user: null, loading: true });
  await applyUserTransition(previousUser, next);
  commit({ user: next, loading: false });
  void hydrateProviderFromServer();
  return next;
}

async function login(email: string, password: string): Promise<AuthUser> {
  // 先递增：让在途的 refresh 失效，避免它用旧会话覆盖本次登录结果
  generation += 1;
  inFlight = null;

  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", email, password }),
  });
  const data = (await res.json()) as { ok?: boolean; user?: AuthUser; error?: string };
  if (!res.ok || !data.ok) throw new Error(data.error ?? "登录失败");
  if (data.user === undefined) throw new Error("登录失败：服务端没有返回用户");

  return commitAuthenticated(data.user);
}

async function register(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthUser> {
  generation += 1;
  inFlight = null;

  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "register", email, password, displayName }),
  });
  const data = (await res.json()) as {
    ok?: boolean;
    user?: AuthUser;
    error?: string;
  };
  if (!res.ok || !data.ok) throw new Error(data.error ?? "注册失败");
  if (data.user === undefined) throw new Error("注册失败：服务端没有返回用户");

  return commitAuthenticated(data.user);
}

async function logout(): Promise<void> {
  // 登出先让在途 refresh 失效，否则旧响应可能把刚清掉的 user 写回去
  generation += 1;
  inFlight = null;

  try {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
  } catch {
    /* 网络失败也要清本地：共享电脑上残留比服务端会话更危险 */
  }

  /*
   * 登出必须无条件清：即使归属键丢了（旧存档、手工清过），
   * 也不能把 learner / 密钥 / 上传资料留给下一位用户。
   */
  await applyAccountTransition(forceClearPlan(null));
  removeLocal(SUBJECT_STORAGE_KEY);
  commit({ user: null, loading: false });
}

export const authStore: AuthStore = {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  refresh,
  login,
  register,
  logout,
};

/**
 * 测试专用：把模块级状态恢复到初始值。
 * 生产代码不应调用——它会让所有已挂载组件看到一次空状态。
 */
export function __resetAuthStoreForTests(initial: AuthSnapshot = SERVER_SNAPSHOT): void {
  generation += 1;
  inFlight = null;
  snapshot = initial;
  listeners.clear();
  windowSyncInstalled = false;
  lastForegroundRefresh = 0;
}
