"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { BookOpen, CircleHelp, Compass, LogOut, Settings, UserRound } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { NavLinks, MobileNav } from "@/components/nav-links";
import { AppDialog } from "@/components/primitives/dialog";
import { CommandMenu } from "@/components/command-menu";
import { useAuth } from "@/lib/useAuth";
import { useTheme } from "@/lib/theme";
import { useAppearance } from "@/lib/appearance";

const titles: Record<string, string> = {
  "/": "学习概览", "/path": "知识图谱", "/diagnose": "课程诊断", "/mistakes": "错题本", "/tutor": "课程导师",
  "/directions": "我的课程", "/market": "课程探索", "/settings": "设置", "/guide": "使用指南", "/about": "关于项目", "/login": "登录 / 注册",
};
export function AppShell({ children }: { children: ReactNode }) {
  useTheme();
  useAppearance();
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  return <div className={`editorial-shell ${pathname === "/tutor" ? "is-tutor" : ""}`}>
    <aside className="shell-sidebar">
      <Link href="/" className="shell-brand" aria-label="自适应学习路径首页"><BrandMark size={36} /><span>自适应学习路径</span></Link>
      <NavLinks />
      <div className="shell-sidebar-utilities">
        <Link className="shell-rail-item" href="/settings?panel=appearance" aria-label="设置" aria-current={pathname === "/settings" ? "page" : undefined}><Settings size={22} aria-hidden="true" /><span>设置</span></Link>
        <button className="shell-rail-item" type="button" onClick={() => setAccountOpen(true)} aria-haspopup="dialog" aria-expanded={accountOpen} aria-label={user ? `账号：${user.displayName}` : "账号与帮助"}><UserRound size={22} aria-hidden="true" /><span>{user?.displayName ?? "账号"}</span></button>
      </div>
    </aside>
    <header className="shell-header">
      <Link className="shell-wordmark" href="/">自适应学习路径</Link><span className="shell-page-title">{titles[pathname] ?? "学习工作台"}</span>
      <CommandMenu />
      <Link href="/settings?panel=appearance" className="shell-mobile-settings" aria-label="设置中心"><Settings size={21} /><span>设置</span></Link>
    </header>
    <div className="editorial-content">{children}</div>
    <MobileNav />
    <AppDialog open={accountOpen} onOpenChange={setAccountOpen} title="账号与帮助" description="管理账号，或查看学习使用说明。">
      <div className="shell-account-links">
        {loading ? <p role="status">正在读取账号…</p> : user ? <><p>{user.displayName}<span className="block text-sm text-[var(--ink-faint)]">{user.email}</span></p><button type="button" onClick={() => { setAccountOpen(false); void logout(); }}><LogOut size={18} />登出</button></> : <Link href="/login" onClick={() => setAccountOpen(false)}><UserRound size={18} />登录 / 注册</Link>}
        <Link href="/market" onClick={() => setAccountOpen(false)}><Compass size={18} />课程探索</Link>
        <Link href="/guide" onClick={() => setAccountOpen(false)}><CircleHelp size={18} />使用指南</Link>
        <Link href="/about" onClick={() => setAccountOpen(false)}><BookOpen size={18} />关于项目</Link>
      </div>
    </AppDialog>
  </div>;
}
