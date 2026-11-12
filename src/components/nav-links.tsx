"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, ClipboardCheck, GraduationCap, House, Network, NotebookPen } from "lucide-react";

export const NAV_LINK_CLASS = "shell-nav-link inline-flex min-h-11 items-center touch-target";
const LINKS = [
  { href: "/", label: "学习概览", short: "概览", icon: House },
  { href: "/path", label: "知识图谱", short: "图谱", icon: Network },
  { href: "/diagnose", label: "诊断测评", short: "测评", icon: ClipboardCheck },
  { href: "/mistakes", label: "错题本", short: "错题", icon: NotebookPen },
  { href: "/tutor", label: "课程导师", short: "导师", icon: GraduationCap },
  { href: "/directions", label: "我的课程", short: "课程", icon: BookOpen },
];
export function NavLinks() {
  const pathname = usePathname();
  return <nav className="shell-navigation" aria-label="主导航">{LINKS.map(link => <Link key={link.href} href={link.href} aria-label={link.label} aria-current={pathname === link.href || link.href === "/directions" && pathname === "/market" ? "page" : undefined} className={NAV_LINK_CLASS} title={link.label}><link.icon size={25} /><span className="nav-long">{link.label}</span><span className="nav-short">{link.short}</span></Link>)}</nav>;
}
export function MobileNav() {
  const pathname = usePathname();
  return <nav className="mobile-learning-nav" aria-label="手机主导航">{LINKS.map(link => <Link key={link.href} href={link.href} aria-label={link.label} aria-current={pathname === link.href || link.href === "/directions" && pathname === "/market" ? "page" : undefined}><link.icon size={23} /><span>{link.short}</span></Link>)}</nav>;
}
