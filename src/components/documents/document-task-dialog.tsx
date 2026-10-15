"use client";
import { useEffect, useRef, useState } from "react";
import { X, FileText, Plus } from "lucide-react";
import type { DocumentDetail } from "@/contracts/documents";
export type DocumentTaskSource = { selection: string; blockId: string; epoch: number; expectedRevision: number; from: number; to: number };
export type DocumentTaskInput = { requestId: string; title: string; assigneeId?: string; dueDate?: string; sharePrivateContent: boolean };
export function DocumentTaskDialog({ document: detail, source, onSubmit, onClose, busy, error }: { document: DocumentDetail; source: DocumentTaskSource; onSubmit: (input: DocumentTaskInput) => void; onClose: () => void; busy: boolean; error: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [requestId] = useState(() => crypto.randomUUID()), [title, setTitle] = useState(source.selection.replace(/\s+/g, " ").slice(0, 100)), [assigneeId, setAssigneeId] = useState(detail.actorId), [dueDate, setDueDate] = useState(""), [share, setShare] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={e => { if (busy) e.preventDefault(); }} onClose={onClose} aria-labelledby="document-task-title" className="ac-card w-[min(560px,90vw)] space-y-4 p-6 text-ink backdrop:bg-ink/30">
    <header className="flex items-center justify-between"><h2 id="document-task-title" className="font-semibold">从文档创建任务</h2><button type="button" disabled={busy} aria-label="关闭创建任务" onClick={onClose}><X size={18} /></button></header>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit({ requestId, title: title.trim(), assigneeId: assigneeId || undefined, dueDate: dueDate || undefined, sharePrivateContent: share }); }}>
      <label className="block text-sm">任务标题<input required autoFocus maxLength={200} value={title} onChange={e => setTitle(e.target.value)} disabled={busy} className="mt-2 w-full rounded-lg border border-line bg-canvas p-2.5" /></label>
      <div className="grid grid-cols-2 gap-4"><label className="block text-sm">负责人<select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} disabled={busy} className="mt-2 w-full rounded-lg border border-line bg-canvas p-2.5"><option value="">暂不分配</option>{detail.members.filter(m => m.role !== "teacher").map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className="block text-sm">截止日期<input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} disabled={busy} className="mt-2 w-full rounded-lg border border-line bg-canvas p-2.5" /></label></div>
      <section className="rounded-lg border border-line bg-canvas p-3"><h3 className="mb-2 flex items-center gap-2 text-xs text-ink-soft"><FileText size={13} />{detail.title} · 来源段落</h3><p className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{source.selection}</p></section>
      <p className="text-xs leading-relaxed text-ink-soft">选中文字将作为任务说明，项目成员可以查看；任务保留返回原文的入口。</p>
      {detail.visibility === "private" && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><input required type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} className="mt-1" disabled={busy} />我确认将以上个人草稿内容共享给项目成员，原文档的访问权限保持不变。</label>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <footer className="flex justify-end gap-2"><button type="button" className="ac-btn-ghost" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="ac-btn" disabled={busy || !title.trim() || detail.visibility === "private" && !share}><Plus size={14} />{busy ? "创建中…" : "创建并关联"}</button></footer>
    </form>
  </dialog>;
}
