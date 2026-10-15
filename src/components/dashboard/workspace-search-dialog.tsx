"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search, ArrowUpRight, X } from "lucide-react";
import { openTaskPreview } from "@/lib/task-navigation";
import type { SearchKind, WorkspaceSearchResult } from "@/contracts/workspace-search";
import type { WorkspaceCommand } from "./command-menu";
import { documentRequest, errorMessage } from "@/components/documents/http";
import "./workspace.css";

export function WorkspaceSearchDialog({ entries = [] }: { entries?: WorkspaceCommand[] }) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useState(""), [kind, setKind] = useState<SearchKind>("all"), [projectId, setProjectId] = useState(""), [offset, setOffset] = useState(0), [opened, setOpened] = useState(false);
  const [remote, setRemote] = useState<{ key: string; data: WorkspaceSearchResult } | null>(null), [error, setError] = useState("");
  const router = useRouter();
  const key = JSON.stringify([search.trim(), kind, projectId, offset]);
  const result = remote?.key === key ? remote.data : null;
  const waiting = opened && !!search.trim() && !result && !error;
  function open() { setSearch(""); setKind("all"); setProjectId(""); setOffset(0); setError(""); setOpened(true); dialog.current?.showModal(); requestAnimationFrame(() => input.current?.focus()); }
  function navigate(href: string) {
    if (openTaskPreview(href)) { dialog.current?.close(); return; }
    const destination = new URL(href, window.location.href);
    if (destination.pathname !== window.location.pathname && !window.dispatchEvent(new Event("agilecampus:before-navigate", { cancelable: true }))) return;
    dialog.current?.close(); router.push(href);
  }
  useEffect(() => {
    function keydown(e: KeyboardEvent) { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !e.altKey && !e.repeat) { e.preventDefault(); if (dialog.current?.open) dialog.current.close(); else open(); } }
    document.addEventListener("keydown", keydown); return () => document.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (!opened || !search.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: search.trim(), kind, projectId, offset: String(offset) });
      void documentRequest<WorkspaceSearchResult>(`/api/workspace/search?${params}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) setRemote({ key, data }); }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [opened, search, kind, projectId, offset, key]);
  const rows = search.trim() ? result?.items ?? [] : kind === "all" && !projectId ? entries.map(item => ({ ...item, excerpt: "", projectName: item.detail ?? "" })) : [];
  const groups = [...new Set(rows.map(item => item.group))];
  const scopes = [{ id: "all", name: "全部" }, { id: "projects", name: "项目" }, { id: "tasks", name: "任务" }, { id: "documents", name: "文档" }, { id: "resources", name: "会议与资料" }] as const;
  return <><button type="button" ref={trigger} onClick={open} className="workspace-search-trigger" aria-label="快速查找任务或项目"><Search aria-hidden className="size-4" /><span>快速查找</span><kbd>Ctrl K</kbd></button>
    <dialog ref={dialog} className="workspace-command" aria-labelledby="workspace-command-title" aria-describedby="workspace-command-note" onClose={() => { setOpened(false); trigger.current?.focus(); }} onClick={e => { if (e.target === e.currentTarget) dialog.current?.close(); }}>
      <div className="workspace-command-surface"><div className="flex items-center justify-between px-4 pt-4"><h2 id="workspace-command-title" className="text-sm font-semibold">快速查找</h2><button type="button" aria-label="关闭快速查找" onClick={() => dialog.current?.close()} className="rounded p-1 text-ink-soft hover:bg-sunken"><X aria-hidden className="size-4" /></button></div>
        <p id="workspace-command-note" className="sr-only">查找有权访问的项目、任务、文档标题和正文、会议与资料。上下方向键选择，回车打开，Escape 关闭。</p>
        <Command label="快速查找关键词" loop shouldFilter={false}><div className="flex items-center gap-3 px-4"><Search aria-hidden className="size-5 text-ink-soft" /><Command.Input ref={input} value={search} maxLength={200} onValueChange={value => { setSearch(value); setOffset(0); setError(""); }} placeholder="查找项目、任务、文档或正文…" aria-label="快速查找关键词" /></div>
          <div className="flex flex-wrap items-center gap-1 border-y border-line px-3 py-2" aria-label="查找内容类型">{scopes.map(scope => <button type="button" key={scope.id} aria-pressed={kind === scope.id} className={`rounded px-2 py-1.5 text-xs ${kind === scope.id ? "bg-primary-soft text-primary" : "text-ink-soft"}`} onClick={() => { setKind(scope.id); setOffset(0); setError(""); }}>{scope.name}</button>)}<select aria-label="查找所属项目" className="ml-auto max-w-44 rounded border border-line bg-surface p-1.5 text-xs text-ink-soft" value={projectId} onChange={e => { setProjectId(e.target.value); setOffset(0); setError(""); }}><option value="">所有项目</option>{remote?.data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <Command.List aria-busy={waiting}>{error ? <p role="alert" className="p-5 text-sm text-red-700">{error}</p> : waiting ? <p role="status" className="p-8 text-center text-sm text-ink-soft">正在查找…</p> : <Command.Empty>{search.trim() ? "没有找到符合条件的内容。" : "输入关键词查找文档、任务和项目。"}</Command.Empty>}
            {groups.map(group => <Command.Group key={group} heading={group}>{rows.filter(item => item.group === group).map(item => <Command.Item key={item.id} value={item.id} onSelect={() => { navigate(item.href); }}><div className="min-w-0 flex-1"><span className="block break-words text-sm">{item.label}</span>{item.projectName && <span className="mt-1 block text-xs text-ink-faint">{item.projectName}</span>}{item.excerpt && <span className="mt-2 block line-clamp-2 break-words text-xs leading-relaxed text-ink-soft">{item.excerpt}</span>}</div><ArrowUpRight aria-hidden className="size-4 shrink-0" /></Command.Item>)}</Command.Group>)}
          </Command.List></Command>
        <footer className="flex items-center gap-3 border-t border-line bg-sunken/50 px-4 py-3 text-xs text-ink-soft"><span>↑ ↓ 选择　Enter 打开</span>{result && <span>{result.total} 项结果</span>}<div className="ml-auto flex gap-3">{offset > 0 && <button type="button" disabled={waiting} onClick={() => { setOffset(Math.max(0, offset - 20)); setError(""); }}>上一页</button>}{result?.nextOffset != null && <button type="button" disabled={waiting} onClick={() => { setOffset(result.nextOffset!); setError(""); }}>下一页</button>}<span>Esc 关闭</span></div></footer>
      </div>
    </dialog></>;
}
