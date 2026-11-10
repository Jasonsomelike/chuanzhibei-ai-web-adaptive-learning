"use client";

import { useSyncExternalStore } from "react";

export const LAYOUT_KEY = "alp.layout";
export const MOTION_KEY = "alp.reducedMotion";
export const APPEARANCE_EVENT = "alp:appearance";
export const LAYOUTS = [
  { id: "paper", name: "导览", note: "宽导航、图谱与详情，底部学习顺序" },
  { id: "atlas", name: "地图", note: "精简导航、主图谱与学习清单", default: true },
  { id: "chapters", name: "章节", note: "顶部导航、章节目录与纵向图谱" },
] as const;
export type LayoutId = (typeof LAYOUTS)[number]["id"];
export function validLayout(value: unknown): LayoutId {
  return LAYOUTS.some(layout => layout.id === value) ? value as LayoutId : "atlas";
}
function snapshot(): string {
  const root = document.documentElement;
  return `${validLayout(root.dataset.layout)}|${root.dataset.reducedMotion === "true" ? "1" : "0"}`;
}
function subscribe(callback: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key === null || event.key === LAYOUT_KEY) document.documentElement.dataset.layout = validLayout(event.key === null ? null : event.newValue);
    if (event.key === null || event.key === MOTION_KEY) document.documentElement.dataset.reducedMotion = String(event.newValue === "true");
    callback();
  };
  window.addEventListener("storage", sync);
  window.addEventListener(APPEARANCE_EVENT, callback);
  return () => { window.removeEventListener("storage", sync); window.removeEventListener(APPEARANCE_EVENT, callback); };
}
function update(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* apply for this page even when storage is unavailable */ }
  if (key === LAYOUT_KEY) document.documentElement.dataset.layout = value;
  if (key === MOTION_KEY) document.documentElement.dataset.reducedMotion = value;
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}
export function useAppearance() {
  const value = useSyncExternalStore(subscribe, snapshot, () => "atlas|0");
  const [layout, motion] = value.split("|");
  return {
    layout: validLayout(layout), reducedMotion: motion === "1",
    setLayout: (next: LayoutId) => update(LAYOUT_KEY, validLayout(next)),
    setReducedMotion: (next: boolean) => update(MOTION_KEY, String(next)),
  };
}
