"use client";

import { useRef, useState, type FormEvent } from "react";
import { SettingsGroup, inputClass } from "./ui";
import { recoveryQuestions, type RecoveryProof } from "@/lib/recovery";

export function newRecoveryProof(): RecoveryProof {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return { question: recoveryQuestions[0], answer: "", code: Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("") };
}

export function RecoveryFields({ proof, onChange, enrolling }: {
  proof: RecoveryProof; onChange: (value: RecoveryProof) => void; enrolling: boolean;
}) {
  return <>
    <label>安全问题<select className={inputClass} value={proof.question} onChange={e => onChange({ ...proof, question: e.target.value })}>{recoveryQuestions.map(q => <option key={q}>{q}</option>)}</select></label>
    <label>安全答案<input className={inputClass} type="password" autoComplete="off" required maxLength={120} value={proof.answer} onChange={e => onChange({ ...proof, answer: e.target.value })} /></label>
    <label>{enrolling ? "请另存这份一次性恢复码" : "一次性恢复码"}<input className={inputClass} readOnly={enrolling} required autoComplete="off" spellCheck={false} value={proof.code} maxLength={32} onFocus={e => { if (enrolling) e.currentTarget.select(); }} onChange={e => onChange({ ...proof, code: e.target.value })} /></label>
    {enrolling && <p className="login-field-hint">找回密码时需要同时提供答案和恢复码。请把恢复码存进密码管理器。</p>}
  </>;
}

type SecurityAction = "change-password" | "set-recovery" | "reset-password";

export function CredentialForm({ action, onReset }: { action: SecurityAction; onReset?: (email: string) => void }) {
  const [proof, setProof] = useState<RecoveryProof>(() => action === "set-recovery" ? newRecoveryProof() : { question: recoveryQuestions[0], answer: "", code: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const next = fields.get("newPassword");
    if (next !== fields.get("confirm")) { setMessage("两次输入的新密码不一致。"); return; }
    submitting.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: fields.get("email"), password: fields.get("password"), newPassword: next, recovery: proof }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败，请重试。");
      form.reset();
      if (action === "reset-password") { onReset?.(String(fields.get("email"))); return; }
      if (action === "set-recovery") setProof(newRecoveryProof());
      setMessage(action === "set-recovery" ? "找回方式已保存。下次重新设置时会替换原恢复码。" : "密码已更改，其他设备需要重新登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请求未完成，请重试。");
    } finally { submitting.current = false; setBusy(false); }
  }
  const savedRecovery = action === "set-recovery" && message.startsWith("找回方式已保存");
  return <form className="account-security-form" onSubmit={submit}>
    {!savedRecovery && <fieldset disabled={busy}>
      {action === "reset-password"
        ? <label>注册邮箱<input className={inputClass} name="email" type="email" autoComplete="username" required maxLength={254} /></label>
        : <label>当前密码<input className={inputClass} name="password" type="password" autoComplete="current-password" required maxLength={200} /></label>}
      {action !== "change-password" && <RecoveryFields proof={proof} onChange={setProof} enrolling={action === "set-recovery"} />}
      {action !== "set-recovery" && <>
        <label>新密码<input className={inputClass} name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={200} /></label>
        <p className="login-field-hint">至少 8 位，同时包含字母和数字。</p>
        <label>确认新密码<input className={inputClass} name="confirm" type="password" autoComplete="new-password" required maxLength={200} /></label>
      </>}
      <button className="login-submit" type="submit">{busy ? "正在保存…" : action === "set-recovery" ? "保存找回方式" : action === "reset-password" ? "重设密码" : "保存新密码"}</button>
    </fieldset>}
    {message && <p role="status">{message}</p>}
    {savedRecovery && <button type="button" onClick={() => setMessage("")}>重新设置找回方式</button>}
  </form>;
}

export function AccountSecurity() {
  const [action, setAction] = useState<SecurityAction | null>(null);
  return <SettingsGroup title="账号安全">
    {(["change-password", "set-recovery"] as const).map(key => <div key={key} className="security-disclosure">
      <button type="button" aria-expanded={action === key} onClick={() => setAction(action === key ? null : key)}>{key === "change-password" ? "更改密码" : "设置安全问题与恢复码"}<span aria-hidden="true">{action === key ? "−" : "+"}</span></button>
      {action === key && <CredentialForm action={key} />}
    </div>)}
  </SettingsGroup>;
}
