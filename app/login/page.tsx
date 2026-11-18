"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CredentialForm, newRecoveryProof, RecoveryFields } from "@/components/account-security";
import type { RecoveryProof } from "@/lib/recovery";
import { useSwapIn } from "@/components/motion";
import { useAuth } from "@/lib/useAuth";

export default function LoginPage() {
  const router = useRouter();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register" | "recover">("login");
  const [proof, setProof] = useState<RecoveryProof | null>(null);
  const [notice, setNotice] = useState("");
  const formColumn = useRef<HTMLElement>(null);
  useSwapIn(formColumn, mode);
  const title = mode === "login" ? "登录账号" : mode === "register" ? "创建账号" : "找回密码";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mismatch =
    mode === "register" && confirmation !== "" && confirmation !== password;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (mode === "register" && password !== confirmation) {
      setError("两次输入的密码不一致，请重新输入。");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password, name, proof ?? undefined);
      const value = new URLSearchParams(window.location.search).get("next");
      let destination = "/";
      if (value?.startsWith("/") && !value.startsWith("//")) {
        const url = new URL(value, window.location.origin);
        if (url.origin === window.location.origin && url.pathname !== "/login")
          destination = url.pathname + url.search + url.hash;
      }
      router.replace(destination);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "登录失败，请重试。",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <main id="main" className="login-page">
      <section className="login-introduction" aria-labelledby="login-benefits">
        <h2 id="login-benefits">保存你的学习进度</h2>
        <ul>
          <li>在不同设备继续学习</li>
          <li>保留完整导师会话</li>
          <li>管理自定义学习方向</li>
        </ul>
        <Link href="/">
          <ArrowLeft size={20} />
          返回学习概览
        </Link>
      </section>
      <section
        className="login-form-column"
        ref={formColumn} aria-label={title}
      >
        <div className="login-modes" role="group" aria-label="登录或注册">
          {(["login", "register"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={busy}
              onClick={() => {
                setMode(value);
                setPassword("");
                setNotice("");
                setProof(null);
                setError(null);
                setConfirmation("");
              }}
            >
              {value === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>
        <h1>{title}</h1>
        {notice && <p role="status">{notice}</p>}
        {mode === "recover" ? <CredentialForm action="reset-password" onReset={address => {
          setEmail(address); setPassword(""); setMode("login"); setNotice("密码已重设。请使用新密码登录，并在账号与隐私中重新设置找回方式。");
        }} /> : (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            {mode === "register" ? (
              <label>
                昵称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="nickname"
                  placeholder="你希望学伴怎样称呼你"
                  maxLength={30}
                  required
                />
              </label>
            ) : null}
            <label>
              邮箱
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>
            <label>
              密码
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder="输入密码"
                maxLength={200}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                aria-describedby={
                  mode === "register" ? "password-requirement" : undefined
                }
              />
            </label>
            {mode === "register" ? (
              <>
                <p id="password-requirement" className="login-field-hint">
                  至少 8 位，同时包含字母和数字。
                </p>
                <label>
                  确认密码
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    type="password"
                    placeholder="再输入一次密码"
                    autoComplete="new-password"
                    maxLength={200}
                    required
                    aria-invalid={mismatch || undefined}
                    aria-describedby={
                      mismatch ? "confirmation-error" : undefined
                    }
                  />
                </label>
                {mismatch ? (
                  <p id="confirmation-error" className="login-error">
                    两次输入的密码不一致。
                  </p>
                ) : null}
              </>
            ) : null}
            {mode === "register" && <>
              <label><span><input type="checkbox" checked={proof !== null} onChange={event => setProof(event.target.checked ? newRecoveryProof() : null)} /> 设置密码找回方式</span></label>
              {proof && <RecoveryFields proof={proof} onChange={setProof} enrolling />}
            </>}
            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="login-submit"
              disabled={
                busy ||
                !email.trim() ||
                !password ||
                (mode === "register" &&
                  (!name.trim() || !confirmation || mismatch))
              }
            >
              {busy ? "正在处理…" : mode === "login" ? "登录" : "创建账号"}
            </button>
          </fieldset>
        </form>)}
        {mode === "login" && <button type="button" disabled={busy} className="login-anonymous" onClick={() => { setMode("recover"); setPassword(""); setNotice(""); setError(null); }}>忘记密码？</button>}
        <Link href="/directions" className="login-anonymous">
          不登录，继续学习
        </Link>
        <details className="login-privacy" open>
          <summary>我们保存什么</summary>
          <p>
            账号、学习记录、自定义方向，以及你在导师中发送的完整问答、引用、练习结果和压缩后的问题图片。
          </p>
          <p>
            登录后的记录保存在账号中。匿名会话留在当前浏览器。模型配置在设置页单独管理。
          </p>
        </details>
      </section>
    </main>
  );
}
