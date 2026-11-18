"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, FileText, GitFork } from "lucide-react";
import { KnowledgeUpload } from "./knowledge-upload";
import { DirectionProposal } from "./direction-proposal";
import { type DirectionDraft, validateTitle, withTitle } from "@/lib/direction";
import { type PlanTurn, planDirection } from "@/lib/directionPlanner";
import { directionWorkspaceId } from "@/lib/directionWorkspaceId";
import { loadSearchConfig } from "@/lib/searchClient";

interface Session {
  key: string; turns: PlanTurn[]; documents: { id: string; name: string; include: boolean }[];
  proposalTurn?: number; references?: Record<string, number[]>;
  draft: DirectionDraft | null; title: string; input: string; model: string; web: boolean; changed: boolean;
}

function blank(): Session {
  return { key: crypto.randomUUID(), turns: [], documents: [], draft: null, title: "", input: "", model: "",
    web: loadSearchConfig().defaultOn, changed: false };
}

export function DirectionStudio({ owner, onSaved }: { owner: string; onSaved: (id: string) => void }) {
  const storageKey = "alp.direction-studio.v1." + owner;
  const [session, setSession] = useState<Session>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Session | null;
      if (stored?.key && Array.isArray(stored.turns) && Array.isArray(stored.documents)) return stored;
    } catch { /* Storage can be unavailable. */ }
    return blank();
  });
  const [target, setTarget] = useState<{ key: string; id: string } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publish, setPublish] = useState(false);
  const active = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const locked = !!status || uploading || target?.key !== session.key;
  useEffect(() => {
    let failed = false;
    try { localStorage.setItem(storageKey, JSON.stringify(session)); } catch { failed = true; }
    const timer = window.setTimeout(() => setStorageError(failed), 0);
    return () => window.clearTimeout(timer);
  }, [session, storageKey]);
  useEffect(() => {
    let mounted = true;
    void directionWorkspaceId(owner, session.key).then(id => { if (mounted) setTarget({ key: session.key, id }); });
    return () => { mounted = false; };
  }, [owner, session.key]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [session.turns.length]);

  async function send(build: boolean) {
    if (locked || active.current || !target) return;
    const message = session.input.trim();
    const turns: PlanTurn[] = message ? [...session.turns, { role: "user", text: message }] : session.turns;
    if (!turns.length || (!build && !message)) return;
    const controller = new AbortController();
    active.current = controller;
    setError(""); setStatus("正在整理学习目标…");
    try {
      const result = await planDirection({ turns, previous: session.draft, build, web: session.web,
        docIds: session.documents.filter(d => d.include).map(d => d.id), targetId: target.id,
        draftKey: session.key, signal: controller.signal, progress: setStatus });
      controller.signal.throwIfAborted();
      setSession(s => ({ ...s, turns: [...turns, result.turn], model: result.model, input: "",
        ...(result.draft && { proposalTurn: turns.length, references: result.references }),
        draft: result.draft ?? s.draft, title: result.draft?.title ?? s.title, changed: !result.draft }));
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "规划失败，请重试。");
    } finally { active.current = null; setStatus(""); }
  }

  async function save() {
    if (!session.draft || locked || active.current || session.changed || session.input.trim()) return;
    const issue = validateTitle(session.title)[0];
    if (issue) { setError(issue); return; }
    const controller = new AbortController();
    active.current = controller;
    setError(""); setStatus("正在保存方向…");
    try {
      const response = await fetch("/api/directions", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftKey: session.key,
          description: session.turns[0].text.slice(0, 500), draft: withTitle(session.draft, session.title), isPublic: publish }) });
      const data = await response.json();
      if (!response.ok || !data.id) throw new Error(data.error ?? "方向保存失败。");
      try { localStorage.removeItem(storageKey); } catch { /* In-memory session still resets. */ }
      setSession(blank()); setPublish(false); onSaved(data.id);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "保存失败，请重试。"); }
    finally { active.current = null; setStatus(""); }
  }

  return <div className="direction-studio">
    <div className="direction-discussion">
      <header><h3>与规划导师讨论</h3><p>说说你想学会什么，也可以先导入讲义或比赛大纲。</p></header>
      {session.turns.length > 0 && <div className="direction-transcript" ref={transcript} role="log" aria-label="方向规划对话">
        {session.turns.map((t, i) => <article key={i} data-author={t.role}>
          <strong>{t.role === "user" ? "你" : "规划导师"}</strong><p>{t.text}</p>
          {t.notice && <small>{t.notice}</small>}
          {!!t.sources?.length && <details><summary>本轮参考 · {t.sources.length} 处</summary>
            {t.sources.map((s, j) => <blockquote key={j}><b>[来源{j+1}] </b>
              {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a> : s.label}<p>{s.excerpt}</p></blockquote>)}</details>}
        </article>)}
      </div>}
      <label className="direction-message"><span>{session.turns.length ? "补充或调整目标" : "你的学习目标"}</span>
        <textarea rows={3} maxLength={2000} disabled={!!status} value={session.input} placeholder="例如：我第一次参加蓝桥杯，会写循环，希望六周后能独立做搜索题。"
          onChange={e => setSession({ ...session, input: e.target.value })} /></label>
      <div className="direction-tools"><label><input type="checkbox" checked={session.web} disabled={locked}
        onChange={e => setSession({ ...session, web: e.target.checked, changed: true })} /> 辅助联网搜索</label>
        <button className="direction-primary" disabled={locked || !session.input.trim()} onClick={() => void send(false)}>发送给导师</button></div>
      <div className="direction-studio-status" role="status">{status || (session.model && "本轮使用 " + session.model)}</div>
      {storageError && <p role="status">浏览器未能保存草稿，请在离开前保存方向。</p>}
      {error && <p className="direction-error" role="alert">{error} <Link href="/settings?panel=provider">模型设置</Link></p>}
      {target?.key === session.key && <KnowledgeUpload key={session.key} userId={owner} directionId={target.id} concepts={[]}
        draftKey={session.key} disabled={!!status} onBusyChange={setUploading}
        onImported={doc => { if (doc) setSession(s => ({ ...s, changed: true,
          documents: [...s.documents.filter(d => d.id !== doc.id), { id: doc.id, name: doc.name, include: s.documents.filter(d => d.id !== doc.id && d.include).length < 20 }] })); }} />}
      {session.documents.length > 0 && <fieldset className="direction-materials" disabled={locked}><legend>本次规划参考{session.documents.length >= 20 && "（每轮最多 20 份）"}</legend>
        {session.documents.map(doc => <label key={doc.id}><input type="checkbox" checked={doc.include} disabled={!doc.include && session.documents.filter(d => d.include).length >= 20}
          onChange={e => setSession({ ...session, changed: true, documents: session.documents.map(d => d.id === doc.id ? { ...d, include: e.target.checked } : d) })} />
          <FileText size={15} />{doc.name}</label>)}</fieldset>}
    </div>
    <div className="direction-preview"><header><GitFork size={20}/><h3>学习方案</h3></header>
      {session.draft ? <DirectionProposal draft={session.draft} references={session.references} sources={session.turns[session.proposalTurn ?? -1]?.sources} title={session.title} setTitle={title => setSession(s => ({ ...s, title }))} /> :
        <div className="direction-preview-empty"><BookOpen size={28}/><p>讨论学习起点和目标后，在这里查看阶段安排和先修图谱。</p></div>}
      <button className="direction-outline" disabled={locked || !session.turns.length} onClick={() => void send(true)}>
        {session.draft ? "按最新讨论调整图谱" : "生成学习方案与图谱"}</button>
      {session.draft && <div className="direction-confirm"><label><input type="checkbox" checked={publish} disabled={locked} onChange={e => setPublish(e.target.checked)} /> 公开到方向市场</label>
        {(session.changed || session.input.trim()) && <small>有新的补充，请先调整图谱。</small>}
        <button className="direction-primary" onClick={() => void save()} disabled={locked || session.changed || !!session.input.trim()}>保存这个方向</button></div>}
    </div>
  </div>;
}
