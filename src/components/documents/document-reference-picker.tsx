"use client";
import { useEffect, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import type { DocumentList, DocumentSummary } from "@/contracts/documents";
import { documentRequest, errorMessage } from "./http";

export function DocumentReferencePicker({ projectId, documentId, query: initialQuery, onChoose, onClose, sharedOnly = false, title = "引用项目文档" }: { projectId: string; documentId?: string; query: string; onChoose: (item: DocumentSummary) => void; onClose: () => void; sharedOnly?: boolean; title?: string }) {
  const [query, setQuery] = useState(initialQuery), [items, setItems] = useState<DocumentSummary[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true), [offset, setOffset] = useState(0), [nextOffset, setNextOffset] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      void documentRequest<DocumentList>(`/api/projects/${projectId}/documents?q=${encodeURIComponent(query)}&offset=${offset}`, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setItems(result.items.filter(item => item.id !== documentId && (!sharedOnly || item.visibility === "project"))); setNextOffset(result.nextOffset); } }).catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [projectId, documentId, query, offset, sharedOnly]);
  return <dialog ref={dialog} onClose={onClose} onCancel={onClose} className="document-reference-dialog ac-card w-[min(560px,90vw)] p-5 backdrop:bg-ink/30" aria-labelledby="document-reference-title">
    <div className="mb-4 flex items-center justify-between"><h2 id="document-reference-title" className="font-semibold">{title}</h2><button type="button" aria-label="关闭文档选择" onClick={onClose}><X size={18} /></button></div>
    <label className="flex items-center gap-2 rounded-lg border border-line px-3"><Search size={15} /><input autoFocus aria-label="查找引用文档" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} className="w-full bg-transparent py-2.5 text-sm outline-none" placeholder="输入文档标题或关键词" /></label>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="my-3 max-h-80 space-y-1 overflow-auto" aria-busy={loading}>{loading ? <p role="status" className="p-4 text-sm text-ink-soft">正在查找…</p> : items.length ? items.map(item => <button type="button" key={item.id} className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-primary-soft" onClick={() => onChoose(item)}><FileText size={16} className="shrink-0 text-primary" /><span className="min-w-0"><strong className="block break-words text-sm font-medium">{item.title}</strong><span className="mt-1 block text-xs text-ink-soft">{item.folder} · {item.visibility === "private" ? "个人草稿" : "项目共享"}</span></span></button>) : <p className="p-4 text-sm text-ink-soft">没有可引用的文档。</p>}</div>
    <div className="flex items-center justify-between border-t border-line pt-3 text-xs text-ink-soft"><span>引用不会改变文档的访问权限。</span><div className="flex gap-3">{offset > 0 && <button type="button" disabled={loading} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button>}{nextOffset !== null && <button type="button" disabled={loading} onClick={() => setOffset(nextOffset)}>下一页</button>}</div></div>
  </dialog>;
}
