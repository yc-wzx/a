"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DraftCards, type Draft } from "@/app/(app)/projects/[projectId]/draft-cards";
import { DocumentQuestionAnswer } from "@/components/documents/document-question-answer";
import { TaskLink } from "@/components/tasks/task-link";
import { newRequestId } from "@/lib/request-id";
import { AssistantLayout } from "./resizable-layout";
import "./assistant.css";
type Conversation = { id: string; projectId: string; title: string | null; projectName: string };
type Memory = { id: string; projectId: string | null; content: string; enabled: boolean };
type Message = { role: "user" | "assistant"; content: string; drafts?: Draft[]; stopped?: boolean };
type Option = { id: string; name: string };
async function api(input?: unknown, query = "") {
  const r = await fetch("/api/assistant" + query, input ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) } : { cache: "no-store" });
  const data = await r.json(); if (!r.ok) throw Error(data.error ?? "操作失败"); return data;
}
export function AssistantWorkspace({ userId, projects, projectId, assistantName, configured, members, milestones, tasks }: { userId: string; projects: Option[]; projectId: string; assistantName: string; configured: boolean; members: Option[]; milestones: Option[]; tasks: { id: string; title: string; status: string }[] }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]), [memories, setMemories] = useState<Memory[]>([]);
  const [current, setCurrent] = useState<string | null>(null), [messages, setMessages] = useState<Message[]>([]), [input, setInput] = useState("");
  const [pending, setPending] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState("");
  const [mode, setMode] = useState<"chat" | "documents">("chat"), [memoryOpen, setMemoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [memoryEdit, setMemoryEdit] = useState<Memory | null>(null), [memoryText, setMemoryText] = useState(""), [memoryScope, setMemoryScope] = useState<string>("");
  const [last, setLast] = useState<{ text: string; requestId: string; conversationId: string } | null>(null);
  const controller = useRef<AbortController | null>(null), selection = useRef(0), active = useRef(true), viewport = useRef<HTMLDivElement>(null), bottom = useRef(true);
  const refresh = useCallback(async () => { const d = await api(); if (active.current) { setConversations(d.conversations); setMemories(d.memories); } }, []);
  useEffect(() => { active.current = true; void refresh().catch(e => setError(e.message)); return () => { active.current = false; controller.current?.abort(); }; }, [refresh]);
  useEffect(() => { if (bottom.current) viewport.current?.scrollTo({ top: viewport.current.scrollHeight }); }, [messages, progress]);
  async function openConversation(c: Conversation) {
    if (pending) return;
    if (c.projectId !== projectId) { router.push(`/assistant?projectId=${c.projectId}&conversation=${c.id}`); return; }
    const version = ++selection.current; setLoading(true); setError("");
    try { const d = await api(undefined, `?projectId=${projectId}&conversationId=${c.id}`); if (version === selection.current && active.current) { setCurrent(c.id); setMessages(d.items.filter((m: Message) => m.role !== ("tool" as string))); setLast(null); router.replace(`/assistant?projectId=${projectId}&conversation=${c.id}`, { scroll: false }); } } catch (e) { setError((e as Error).message); } finally { if (version === selection.current) setLoading(false); }
  }
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("conversation");
    // Restore an explicit browser URL, including navigation from another project.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && conversations.some(c => c.id === id) && !current) void openConversation(conversations.find(c => c.id === id)!);
    // Conversation choice is local UI state; load the explicit URL selection once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);
  async function send(retry = false) {
    if (pending || !projectId || !configured) return;
    const text = retry ? last?.text ?? "" : input.trim(); if (!text) return;
    setPending(true); setError(""); setProgress("准备当前项目上下文"); bottom.current = true;
    const abort = new AbortController(); controller.current = abort;
    try {
      let id = retry ? last?.conversationId : current;
      if (!id) { const c = await api({ op: "create", projectId }); id = c.id as string; setCurrent(id); await refresh(); }
      const requestId = retry ? last!.requestId : newRequestId();
      setLast({ text, requestId, conversationId: id! });
      setMessages(m => [...(retry ? m.slice(0, -2) : m), { role: "user", content: text }, { role: "assistant", content: "" }]);
      if (!retry) setInput("");
      const r = await fetch("/api/assistant/stream", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal, body: JSON.stringify({ requestId, projectId, conversationId: id, userText: text }) });
      if (!r.ok) throw Error((await r.json()).error ?? "生成失败");
      const reader = r.body!.getReader(), decoder = new TextDecoder(); let buffer = "", complete = false;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop()!;
        for (const line of lines) { if (!line.trim()) continue; const e = JSON.parse(line);
          if (!active.current) return;
          if (e.type === "delta") setMessages(m => m.map((x, i) => i === m.length - 1 ? { ...x, content: x.content + e.text } : x));
          if (e.type === "progress") setProgress(e.text);
          if (e.type === "error") throw Error(e.error);
          if (e.type === "done") { complete = true; setMessages(m => m.map((x, i) => i === m.length - 1 ? { role: "assistant", content: e.result.text, drafts: e.result.drafts } : x)); setLast(null); }
        }
      }
      if (!complete) throw Error("连接提前中断，可核对历史后重试");
      if (conversations.find(c => c.id === id)?.title === "新对话" || !conversations.some(c => c.id === id)) await api({ op: "rename", projectId, conversationId: id, title: text.slice(0, 40) });
      await refresh();
    } catch (e) {
      if (active.current) { setError(abort.signal.aborted ? "已停止生成" : (e as Error).message); setMessages(m => m.map((x, i) => i === m.length - 1 ? { ...x, stopped: true } : x)); }
    } finally { if (active.current) { setPending(false); setProgress(""); } controller.current = null; }
  }
  async function mutate(input: unknown) { try { setError(""); await api(input); await refresh(); return true; } catch (e) { setError((e as Error).message); return false; } }
  function newConversation() {
    ++selection.current; setCurrent(null); setMessages([]); setLast(null); setError(""); setLoading(false);
    router.replace(projectId ? `/assistant?projectId=${projectId}` : "/assistant", { scroll: false });
  }
  function selectProject(id: string) {
    if (pending || id === projectId) return;
    if (input.trim() && !window.confirm("切换项目会清空尚未发送的问题，继续？")) return;
    router.push(`/assistant?projectId=${id}`);
  }
  return <AssistantLayout userId={userId} sidebar={<>
    <h2 className="assistant-sidebar-title">我的助手</h2>
    <div className="assistant-create-actions"><button className="ac-btn w-full" disabled={pending} onClick={newConversation}>＋ 新对话</button><Link href="/projects/new" className="assistant-new-project" aria-disabled={pending} onClick={event => { if (pending) event.preventDefault(); }}>＋ 新建项目</Link></div>
    <nav className="assistant-projects" aria-label="按项目查看历史对话"><p className="assistant-section-label">项目与历史对话</p>{projects.map(p => <section key={p.id} className="assistant-project-group">
      <button className={`assistant-project-name ${p.id === projectId ? "is-current" : ""}`} disabled={pending} onClick={() => selectProject(p.id)} aria-pressed={p.id === projectId} title={p.name}><span aria-hidden>▾</span><span>{p.name}</span></button>
      {conversations.filter(c => c.projectId === p.id).map(c => <div key={c.id} className={`assistant-history-row ${current === c.id ? "is-current" : ""}`}>
        <button className="assistant-history-name" disabled={pending} onClick={() => void openConversation(c)} title={c.title || "未命名对话"}>{c.title || "未命名对话"}</button>
        <details className="assistant-history-menu"><summary aria-label={`管理对话：${c.title || "未命名对话"}`}>⋯</summary><div><button disabled={pending} onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); const title = prompt("对话名称", c.title ?? ""); if (title?.trim()) void mutate({ op: "rename", conversationId: c.id, projectId: c.projectId, title }); }}>重命名</button><button disabled={pending} onClick={async event => { event.currentTarget.closest("details")?.removeAttribute("open"); if (!confirm("删除这段个人对话？")) return; const deleted = await mutate({ op: "delete", conversationId: c.id, projectId: c.projectId }); if (deleted && current === c.id) newConversation(); }}>删除</button></div></details>
      </div>)}
      {!conversations.some(c => c.projectId === p.id) && <p className="assistant-no-history">暂无历史对话</p>}
    </section>)}{!projects.length && <p className="text-sm text-ink-soft">先创建或加入一个项目。</p>}</nav>
    <footer className="assistant-sidebar-footer"><button onClick={() => { setContextOpen(true); setMemoryOpen(true); }}>偏好记忆</button><Link href="/settings#my-ai">模型与密钥设置</Link></footer>
  </>}>
    <header className="assistant-main-header"><div className="min-w-0"><p className="assistant-current-project">{projects.find(p => p.id === projectId)?.name || "尚未选择项目"}</p><h1>{assistantName}</h1></div><div className="assistant-header-actions"><span>仅本人可见</span><button className="text-primary" aria-expanded={contextOpen} onClick={() => setContextOpen(v => !v)}>上下文与记忆 ▸</button></div></header>
    {error && <p role="alert" className="assistant-error">{error} {last && !pending && <button className="ml-3 underline" onClick={() => void send(true)}>核对并重试本轮</button>}</p>}
    <nav className="assistant-mode-tabs" aria-label="助手工作模式"><button aria-pressed={mode === "chat"} onClick={() => setMode("chat")}>项目对话</button><button aria-pressed={mode === "documents"} onClick={() => setMode("documents")}>资料问答</button></nav>
    {mode === "documents" ? <div className="assistant-document-qa">{projectId ? <DocumentQuestionAnswer projectId={projectId} /> : <p>请先创建或加入项目。</p>}</div> : <>
      <div ref={viewport} onScroll={e => { const el = e.currentTarget; bottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className={`assistant-message-viewport ${!messages.length ? "is-empty" : ""}`} aria-live="polite">
        {loading && <p className="text-sm text-ink-faint">读取历史对话…</p>}
        {!messages.length && !loading && <div className="assistant-welcome"><h2>从当前项目的下一步开始</h2><p>查询项目进度、梳理待办，或拟定下一步目标。</p><div className="assistant-suggestions">{["帮我整理当前项目的待办和风险", "根据现有进度，为我拟定下一步任务", "列出我负责的任务，建议先做什么"].map((t, i) => <button key={t} onClick={() => setInput(t)}>{["整理待办和风险", "拟定下一步任务", "我应该先做什么"][i]} ↗</button>)}</div></div>}
        {messages.map((m, i) => <article key={i} className={`assistant-message ${m.role === "user" ? "from-user" : "from-assistant"}`}><p className="mb-2 text-xs font-medium text-ink-faint">{m.role === "user" ? "我" : assistantName}</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{m.content || (pending ? "正在处理…" : "本轮未生成完整回答")}</p>{m.stopped && <p className="mt-2 text-xs text-ink-faint">未完成 · 不会执行任务变更</p>}{m.role === "assistant" && m.content && <button className="mt-2 text-xs text-primary" onClick={() => void navigator.clipboard.writeText(m.content)}>复制</button>}{m.drafts?.length ? <DraftCards projectId={projectId} drafts={m.drafts} members={members} milestones={milestones} /> : null}</article>)}
      </div>
      <form className="assistant-composer-area" onSubmit={e => { e.preventDefault(); void send(); }}><div className="assistant-composer"><textarea aria-label="向我的助手提问" value={input} onChange={e => setInput(e.target.value)} maxLength={4000} rows={3} placeholder="输入问题，或描述你要完成的项目工作…" disabled={loading} /><div className="assistant-compose-footer"><span role="status">{pending ? progress : configured ? "已使用个人模型配置" : "个人模型尚未配置"}</span>{!configured && <Link href="/settings#my-ai">前往设置 →</Link>}{pending ? <button type="button" className="ac-btn-ghost ml-auto" onClick={() => controller.current?.abort()}>停止生成</button> : <button className="ac-btn ml-auto" disabled={!configured || !projectId || !input.trim() || loading}>发送</button>}</div></div><p className="assistant-compose-rule">任务草案由你确认后保存；个人密钥与偏好记忆由你管理。</p></form>
    </>}
    {contextOpen && <aside className="assistant-context-panel" aria-label="项目上下文与个人记忆"><div className="mb-5 flex items-center justify-between"><h2 className="font-semibold">上下文与记忆</h2><button aria-label="关闭上下文面板" onClick={() => setContextOpen(false)} className="ac-btn-ghost">✕</button></div><section><h2 className="mb-3 text-sm font-semibold">当前项目</h2><p className="text-sm">{projects.find(p => p.id === projectId)?.name}</p><p className="mt-2 text-xs leading-5 text-ink-faint">项目数据在提问时重新核对权限与进度。任务讨论和私人日程内容不会自动加入。</p><div className="mt-3 max-h-56 space-y-2 overflow-y-auto">{tasks.slice(0, 12).map(t => <TaskLink key={t.id} href={`/projects/${projectId}?task=${t.id}`} className="block rounded-lg bg-surface p-2 text-xs">{t.status === "done" ? "✓" : "○"} {t.title}</TaskLink>)}</div>{projectId && <Link href={`/projects/${projectId}/ai-drafts`} className="mt-3 inline-block text-xs text-primary">迭代草案与项目助手 ↗</Link>}</section>
        <section className="border-t border-line pt-4"><div className="flex justify-between"><h2 className="text-sm font-semibold">我的记忆</h2><button className="text-xs text-primary" onClick={() => setMemoryOpen(!memoryOpen)}>{memoryOpen ? "收起" : "管理"}</button></div><p className="mt-2 text-xs leading-5 text-ink-faint">只保存你确认的工作偏好。禁用或删除后不再用于新回答。</p><p className="mt-2 text-xs">{memories.filter(m => m.enabled && (!m.projectId || m.projectId === projectId)).length} 条启用</p>
          {memoryOpen && <div className="mt-3 space-y-3">{memories.map(m => <div key={m.id} className="rounded-xl border border-line bg-surface p-3 text-xs"><p className="whitespace-pre-wrap">{m.content}</p><p className="my-1 text-ink-faint">{m.projectId ? projects.find(p => p.id === m.projectId)?.name : "所有个人项目"}</p><div className="flex gap-3"><button onClick={() => { setMemoryEdit(m); setMemoryText(m.content); setMemoryScope(m.projectId ?? ""); }}>编辑</button><button onClick={() => void mutate({ op: "memory", ...m, enabled: !m.enabled })}>{m.enabled ? "禁用" : "启用"}</button><button onClick={() => void mutate({ op: "forget", id: m.id })}>删除</button></div></div>)}<form className="space-y-2" onSubmit={async e => { e.preventDefault(); try { await api({ op: "memory", id: memoryEdit?.id, projectId: memoryScope || null, content: memoryText, enabled: memoryEdit?.enabled ?? true }); setMemoryEdit(null); setMemoryText(""); await refresh(); } catch (e) { setError((e as Error).message); } }}><textarea aria-label="记忆内容" value={memoryText} onChange={e => setMemoryText(e.target.value)} maxLength={1000} rows={3} className="ac-field w-full text-xs" placeholder="例如：偏好将目标拆为半小时可完成的小任务" required /><select aria-label="记忆适用范围" value={memoryScope} className="ac-field w-full text-xs" onChange={e => setMemoryScope(e.target.value)}><option value="">所有个人项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="ac-btn w-full text-xs">{memoryEdit ? "确认修改记忆" : "确认加入记忆"}</button>{memoryEdit && <button type="button" onClick={() => { setMemoryEdit(null); setMemoryText(""); }}>取消编辑</button>}</form></div>}
        </section>
    </aside>}
  </AssistantLayout>;
}
