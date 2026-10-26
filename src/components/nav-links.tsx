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

const LINKS = [
  { href: "/diagnose", label: "诊断" },
  { href: "/path", label: "路径" },
  { href: "/tutor", label: "导师" },
  { href: "/directions", label: "方向" },
  { href: "/market", label: "市场" },
  { href: "/settings", label: "设置" },
  { href: "/about", label: "关于" },
];

export function NavLinks() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-0.5 text-sm">
      {LINKS.map((l) => {
        const active = pathname === l.href;
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 transition-colors ${
              active
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--ink-soft)] hover:bg-[var(--line)] hover:text-[var(--ink)]"
            }`}
          >
            {l.label}
          </Link>
        );
      })}

      {loading ? (
        <span className="ml-1 px-2 text-xs text-[var(--ink-faint)]">…</span>
      ) : user ? (
        <span className="ml-1 flex items-center gap-1.5">
          <span
            className="max-w-24 truncate rounded-md bg-[var(--line)] px-2 py-1 text-xs text-[var(--ink-soft)]"
            title={user.email}
          >
            {user.displayName}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md px-2 py-1 text-xs text-[var(--ink-faint)] hover:text-[var(--ink)]"
          >
            登出
          </button>
        </span>
      ) : (
        <Link
          href="/login"
          className="ml-1 rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-[var(--on-accent)]"
        >
          登录
        </Link>
      )}
    </nav>
  );
}
