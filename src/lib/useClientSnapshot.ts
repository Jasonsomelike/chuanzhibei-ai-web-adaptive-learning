"use client";

/**
 * 挂载后才可读的外部值（localStorage / URL 参数 / 浏览器 API）的统一入口。
 *
 * 为什么不能直接在 useEffect 里 setState：react-hooks/set-state-in-effect 会把
 * 同步 setState 判为级联渲染；而 lazy useState 初始化读到客户端值又会造成
 * SSR 与首次客户端渲染不一致（hydration mismatch）。
 *
 * useSyncExternalStore 是 React 为「值只存在于客户端」准备的通道：
 * 服务端与 hydration 期间用 serverValue，hydration 完成后自动改用 getSnapshot
 * 的返回值重渲染一次——没有 effect，也没有手动 setState。
 *
 * getSnapshot 必须返回稳定引用（React 会反复调用并比较），所以读到的值缓存在
 * 组件独立的 store 里，每个组件实例只在提交后的订阅阶段读一次。
 */

import { useState, useSyncExternalStore } from "react";

/** 空订阅：快照只读一次，外部不会主动推送变化。 */
function noopSubscribe(): () => void {
  return () => {};
}

/**
 * 读取一个只在客户端存在的值。serverValue 用于服务端渲染与 hydration；
 * 挂载后返回 read() 的结果（缓存，整个生命周期只读一次）。
 *
 * 调用方后续要修改这个值时，用自己的 useState 覆盖：
 *   const stored = useClientSnapshot(loadConfig, DEFAULT_CONFIG);
 *   const [edited, setEdited] = useState<Config | null>(null);
 *   const config = edited ?? stored;
 */
export function useClientSnapshot<T>(read: () => T, serverValue: T): T {
  // Subscribe runs after commit. Reading in getSnapshot/render can capture the
  // previous URL while Next is preparing a client navigation, then cache it forever.
  const [store] = useState(() => {
    let cached = serverValue;
    let initialized = false;
    return {
      subscribe(notify: () => void) {
        if (!initialized) { cached = read(); initialized = true; }
        notify();
        return () => {};
      },
      snapshot: () => cached,
      server: () => serverValue,
    };
  });
  return useSyncExternalStore(store.subscribe, store.snapshot, store.server);
}

/** 组件是否已完成 hydration。用于「挂载后再展示/再允许交互」的 ready 标记。 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
