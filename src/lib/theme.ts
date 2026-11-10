"use client";

import { useSyncExternalStore } from "react";
import { THEMES, THEME_KEY, MODE_KEY, applyTheme, type ThemeId, type ModeId } from "@/lib/themes";

const EVENT = "alp:theme";
const validTheme = (value: unknown): ThemeId => THEMES.some(t => t.id === value) ? value as ThemeId : "olive";
const validMode = (value: unknown): ModeId => value === "light" || value === "dark" ? value : "system";
function snapshot() {
  const root = document.documentElement;
  return `${validTheme(root.dataset.theme)}|${validMode(root.dataset.colorPreference)}|${root.dataset.mode === "dark" ? "dark" : "light"}|1`;
}
function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const system = () => {
    const root = document.documentElement;
    if (validMode(root.dataset.colorPreference) === "system") applyTheme(validTheme(root.dataset.theme), "system");
    callback();
  };
  const storage = (event: StorageEvent) => {
    if (![null, THEME_KEY, MODE_KEY].includes(event.key)) return;
    const root = document.documentElement;
    const theme = event.key === null || event.key === THEME_KEY ? validTheme(event.newValue) : validTheme(root.dataset.theme);
    const mode = event.key === null || event.key === MODE_KEY ? validMode(event.newValue) : validMode(root.dataset.colorPreference);
    root.dataset.colorPreference = mode;
    applyTheme(theme, mode);
    callback();
  };
  media.addEventListener("change", system);
  window.addEventListener("storage", storage);
  window.addEventListener(EVENT, callback);
  return () => { media.removeEventListener("change", system); window.removeEventListener("storage", storage); window.removeEventListener(EVENT, callback); };
}
export function useTheme() {
  const [theme, mode, resolvedMode, ready] = useSyncExternalStore(subscribe, snapshot, () => "olive|system|light|0").split("|");
  const setTheme = (next: ThemeId) => {
    try { localStorage.setItem(THEME_KEY, validTheme(next)); } catch { /* session-only preference */ }
    applyTheme(validTheme(next), validMode(document.documentElement.dataset.colorPreference));
    window.dispatchEvent(new Event(EVENT));
  };
  const setMode = (next: ModeId) => {
    const preference = validMode(next);
    try { localStorage.setItem(MODE_KEY, preference); } catch { /* session-only preference */ }
    document.documentElement.dataset.colorPreference = preference;
    applyTheme(validTheme(document.documentElement.dataset.theme), preference);
    window.dispatchEvent(new Event(EVENT));
  };
  return { theme: validTheme(theme), mode: validMode(mode), setTheme, setMode, ready: ready === "1", resolvedMode: resolvedMode as "light" | "dark" };
}
