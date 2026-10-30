"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Nav, Card, Pill } from "@/components/ui";
import { useStaggerIn, useSwapIn } from "@/components/motion";
import { useAuth } from "@/lib/useAuth";

/**
 * 登录 / 注册页。
 *
 * 一个页面两种模式，用 tab 切换。注册成功直接进入登录态，不要求再登录一次。
 * 密码要求写在输入框下方而不是等提交后报错——减少一次往返。
 */

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mainRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  /* 登录态没有切换；这里只播一次性入场，切换登录 / 注册时表单再淡入一次。 */
  useStaggerIn(mainRef);
  useSwapIn(formRef, mode);

  /** 两次输入的密码不一致时，就地提示而不是等提交后才报错。 */
  const confirmMismatch =
    mode === "register" && confirmPassword !== "" && confirmPassword !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "register" && password !== confirmPassword) {
      setError("两次输入的密码不一致，请重新输入。");
      return;
    }
    setBusy(true);

    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await register(email, password, displayName);
      }
      // 注册或登录成功后回到诊断页，那是最自然的下一步
      router.push("/diagnose");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Nav />
      <main id="main" ref={mainRef} className="mx-auto max-w-md px-5 py-12">
        <div className="mb-6" data-motion="hero">
          <h1 className="text-2xl font-semibold tracking-tight">
            {mode === "login" ? "登录" : "创建账号"}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-soft)]">
            {mode === "login"
              ? "登录后学习进度会保存在服务端，换设备也能继续。"
              : "账号只用于保存进度与自定义方向，不需要验证邮箱。"}
          </p>
        </div>

        {/* 模式切换 */}
        <div className="mb-5 flex gap-1.5" data-motion="tabs">
          <button
            type="button"
            onClick={() => {
              setMode("login");
              setError(null);
              setConfirmPassword("");
            }}
            aria-pressed={mode === "login"}
            className={`rounded-lg px-4 py-1.5 text-sm ${
              mode === "login"
                ? "bg-[var(--accent)] text-[var(--on-accent)]"
                : "border border-[var(--line-strong)] text-[var(--ink-soft)]"
            }`}
          >
            登录
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("register");
              setError(null);
            }}
            aria-pressed={mode === "register"}
            className={`rounded-lg px-4 py-1.5 text-sm ${
              mode === "register"
                ? "bg-[var(--accent)] text-[var(--on-accent)]"
                : "border border-[var(--line-strong)] text-[var(--ink-soft)]"
            }`}
          >
            注册
          </button>
        </div>

        <div ref={formRef} data-motion="form">
        <Card>
          <form onSubmit={submit} className="space-y-4">
            {mode === "register" ? (
              <label className="block">
                <span className="block text-sm font-medium">昵称</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                  显示在你自己创建的方向上
                </span>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                  placeholder="例如：小李"
                  maxLength={30}
                  autoComplete="nickname"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="block text-sm font-medium">邮箱</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="mt-1.5 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium">密码</span>
              {mode === "register" ? (
                <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                  至少 8 位，需同时含字母和数字
                </span>
              ) : null}
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="mt-1.5 w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2 text-sm"
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
              />
            </label>

            {mode === "register" ? (
              <label className="block">
                <span className="block text-sm font-medium">确认密码</span>
                <input
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  type="password"
                  className={`mt-1.5 w-full rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm ${
                    confirmMismatch
                      ? "border-[var(--bad)]"
                      : "border-[var(--line-strong)]"
                  }`}
                  placeholder="再输入一次密码"
                  autoComplete="new-password"
                  required
                  aria-invalid={confirmMismatch || undefined}
                />
                {confirmMismatch ? (
                  <span className="mt-1 block text-xs text-[var(--bad)]">
                    两次输入的密码不一致
                  </span>
                ) : null}
              </label>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-[var(--bad)] bg-[var(--bad-soft)] p-3 text-sm">
                <p className="text-[var(--bad)]">{error}</p>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={
                busy ||
                email.trim() === "" ||
                password === "" ||
                (mode === "register" && (confirmPassword === "" || confirmMismatch))
              }
              className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "处理中…" : mode === "login" ? "登录" : "创建账号"}
            </button>
          </form>
        </Card>
        </div>

        <div className="mt-5 space-y-3 text-sm text-[var(--ink-soft)]" data-motion="privacy">
          <p>
            <Link href="/diagnose" className="underline">
              不登录继续使用
            </Link>
            ——进度会存在本浏览器，换设备不同步。
          </p>
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-xs">
            <p className="flex items-center gap-2 font-medium">
              <Pill tone="accent">隐私</Pill>
              我们保存什么
            </p>
            <ul className="mt-1.5 space-y-1 text-[var(--ink-soft)]">
              <li>· 邮箱、昵称、密码的加盐哈希（不存明文）</li>
              <li>· 各学科的作答记录与掌握度</li>
              <li>· 你创建的自定义方向（是否公开由你决定）</li>
            </ul>
            <p className="mt-1.5 text-[var(--ink-faint)]">
              不收集手机号、不接入第三方统计。密码用 PBKDF2 加盐哈希存储。
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
