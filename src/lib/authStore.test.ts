import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetAuthStoreForTests,
  authStore,
  type AuthSnapshot,
  type AuthUser,
} from "@/lib/authStore";

const ALICE: AuthUser = {
  id: "user-alice",
  email: "alice@example.com",
  displayName: "Alice",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const BOB: AuthUser = {
  id: "user-bob",
  email: "bob@example.com",
  displayName: "Bob",
  createdAt: "2026-02-02T00:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockJson(body: unknown): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => jsonResponse(body));
  vi.stubGlobal("fetch", mock);
  return mock;
}

/**
 * 模拟一个 useAuth 实例：useSyncExternalStore 的语义就是
 * 「订阅 store + 每次通知后读取最新 snapshot」。
 * 两个实例之间不共享任何 React state，只共享 authStore。
 */
function mountAuthInstance(): {
  readonly current: () => AuthSnapshot;
  readonly unsubscribe: () => void;
} {
  let snapshot = authStore.getSnapshot();
  const unsubscribe = authStore.subscribe(() => {
    snapshot = authStore.getSnapshot();
  });
  return { current: () => snapshot, unsubscribe };
}

beforeEach(() => {
  __resetAuthStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetAuthStoreForTests();
});

describe("authStore 单一真相", () => {
  it("两个 useAuth 实例共享同一 user", async () => {
    mockJson({ user: ALICE });

    const first = mountAuthInstance();
    const second = mountAuthInstance();
    expect(first.current().user).toBeNull();
    expect(second.current().user).toBeNull();

    await authStore.refresh();

    // 同一个 snapshot 对象，而不是各存一份 useState
    expect(first.current().user).toEqual(ALICE);
    expect(second.current().user).toEqual(ALICE);
    expect(first.current().user).toBe(second.current().user);
    expect(first.current().loading).toBe(false);
  });

  it("refresh 后两边都更新（换账号也同步）", async () => {
    let current: AuthUser | null = ALICE;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ user: current })),
    );

    const first = mountAuthInstance();
    const second = mountAuthInstance();

    await authStore.refresh();
    expect(first.current().user?.id).toBe(ALICE.id);
    expect(second.current().user?.id).toBe(ALICE.id);

    current = BOB;
    await authStore.refresh();
    expect(first.current().user?.id).toBe(BOB.id);
    expect(second.current().user?.id).toBe(BOB.id);
  });

  it("并发 refresh 只发一次请求", async () => {
    const fetchMock = mockJson({ user: ALICE });

    const first = mountAuthInstance();
    const second = mountAuthInstance();
    await Promise.all([authStore.refresh(), authStore.refresh()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.current().user?.id).toBe(ALICE.id);
    expect(second.current().user?.id).toBe(ALICE.id);
  });

  it("refresh 拿到 5xx 时保留当前 user，不清本机状态", async () => {
    mockJson({ user: ALICE });
    const instance = mountAuthInstance();
    await authStore.refresh();
    expect(instance.current().user?.id).toBe(ALICE.id);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "boom" }, 500)),
    );
    await authStore.refresh();
    expect(instance.current().user?.id).toBe(ALICE.id);
    expect(instance.current().loading).toBe(false);
  });

  it("login / logout 直接更新所有实例", async () => {
    const first = mountAuthInstance();
    const second = mountAuthInstance();

    mockJson({ ok: true, user: ALICE });
    const loggedIn = await authStore.login("alice@example.com", "abcd1234");
    expect(loggedIn.id).toBe(ALICE.id);
    expect(first.current().user?.id).toBe(ALICE.id);
    expect(second.current().user?.id).toBe(ALICE.id);

    mockJson({ ok: true });
    await authStore.logout();
    expect(first.current().user).toBeNull();
    expect(second.current().user).toBeNull();
  });

  it("未订阅者不会收到通知，退订后也不再收到", async () => {
    mockJson({ user: ALICE });
    const listener = vi.fn();
    const unsubscribe = authStore.subscribe(listener);
    unsubscribe();

    await authStore.refresh();
    expect(listener).not.toHaveBeenCalled();
  });
});
