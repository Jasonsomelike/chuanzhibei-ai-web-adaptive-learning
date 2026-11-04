"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/useAuth";

/**
 * 导航链接与登录态。
 *
 * 单独拆成客户端组件，这样 Nav 本身可以是服务端组件，
 * 只有这一小块需要读登录态。
 */

/**
 * 导航里可点元素的共用样式。
 *
 * 移动端触控目标至少 44×44（WCAG 2.5.5 / 2.5.8 的拇指目标）：
 * `min-h-11` + `inline-flex items-center` 把高度撑到 2.75rem，并在 `sm`
 * 断点收回 `min-h-0`，桌面仍是原来的紧凑密度（链接 32px、登出 24px）。
 *
 * 垂直内边距写成任意值而不是 `py-1.5` / `py-1`：桌面像素不变，
 * 同时让「导航常量里不出现 py-1*」这条约束可以被 nav-links.test.ts 直接断言。
 * `.touch-target` 是 app/globals.css 里 `pointer: coarse` 的兜底，
 * 覆盖横屏手机、平板等宽度超过 `sm` 的触屏设备。
 */
export const NAV_LINK_CLASS =
  "inline-flex min-w-0 max-w-full min-h-11 items-center rounded-md px-2.5 py-[0.375rem] touch-target transition-colors sm:min-h-0";

/** 登出按钮：文字更小、桌面更紧凑，但移动端同样至少 44px。 */
export const NAV_LOGOUT_CLASS =
  "inline-flex min-h-11 items-center rounded-md px-2 py-[0.25rem] text-xs text-[var(--ink-faint)] touch-target hover:text-[var(--ink)] sm:min-h-0";

/** 未登录时的登录入口。 */
export const NAV_LOGIN_CLASS =
  "ml-1 inline-flex max-w-full min-h-11 items-center rounded-md bg-[var(--accent)] px-2.5 py-[0.25rem] text-xs font-medium text-[var(--on-accent)] touch-target sm:min-h-0";

const LINKS = [
  { href: "/diagnose", label: "诊断测评" },
  { href: "/path", label: "学习路径" },
  { href: "/tutor", label: "课程导师" },
  { href: "/directions", label: "我的方向" },
  { href: "/market", label: "方向市场" },
  { href: "/settings", label: "设置中心" },
  { href: "/guide", label: "使用指南" },
  { href: "/about", label: "关于项目" },
];

export function NavLinks() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  return (
    <nav className="flex min-w-0 max-w-full flex-wrap items-center gap-0.5 text-sm">
      {LINKS.map((l, index) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`${index >= 3 ? "max-sm:hidden" : ""} ${NAV_LINK_CLASS} ${
              active
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--ink-soft)] hover:bg-[var(--line)] hover:text-[var(--ink)]"
            }`}
          >
            <span className="truncate">{l.label}</span>
          </Link>
        );
      })}

      <details className="relative sm:hidden">
        <summary className={`${NAV_LINK_CLASS} cursor-pointer list-none text-[var(--ink-soft)]`}>更多 ▾</summary>
        <div className="absolute right-0 top-full z-50 mt-1 grid w-40 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] p-2 shadow-lg">
          {LINKS.slice(3).map((link) => <Link key={link.href} href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
            className="rounded-lg px-3 py-3 text-sm hover:bg-[var(--line)]">{link.label}</Link>)}
        </div>
      </details>

      {loading ? (
        <span className="ml-1 px-2 text-xs text-[var(--ink-faint)]">…</span>
      ) : user ? (
        <span className="ml-1 flex min-w-0 items-center gap-1.5">
          <span
            className="max-w-24 truncate rounded-md bg-[var(--line)] px-2 py-1 text-xs text-[var(--ink-soft)]"
            title={user.email}
          >
            {user.displayName}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className={NAV_LOGOUT_CLASS}
          >
            登出
          </button>
        </span>
      ) : (
        <Link
          href="/login"
          className={NAV_LOGIN_CLASS}
        >
          登录
        </Link>
      )}
    </nav>
  );
}
