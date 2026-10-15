"use client";
import Link from "next/link";
import { useState } from "react";
import { Star, Clock3, FileText, Pin, ArrowUpRight, X } from "lucide-react";
import type { DocumentKnowledge, DocumentPersonal, DocumentSummary } from "@/contracts/documents";
import { documentGuideSlots } from "@/contracts/document-knowledge";
import { displayDateTime } from "@/lib/display-time";
import { TaskLink } from "@/components/tasks/task-link";
import { DocumentReferencePicker } from "./document-reference-picker";
import { documentMutation, errorMessage } from "./http";

export function ProjectDocumentGuide({ projectId, value, onChange }: { projectId: string; value: DocumentKnowledge; onChange: () => Promise<void> }) {
  const [editing, setEditing] = useState(false), [slot, setSlot] = useState<string | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function choose(document: DocumentSummary | null, selected = slot) {
    if (!selected || busy) return;
    setBusy(true); setError("");
    try { await documentMutation(`/api/projects/${projectId}/documents/knowledge`, "POST", { slot: selected, documentId: document?.id ?? null, expectedDocumentId: value.pins.find(pin => pin.slot === selected)?.documentId ?? null }); await onChange(); setSlot(null); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <section className="ac-card p-5" aria-label="项目指南"><header className="mb-3 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><Pin size={15} />项目指南</h2>{value.canManage && <button type="button" className="text-xs text-primary" onClick={() => setEditing(!editing)}>{editing ? "完成设置" : "编辑固定资料"}</button>}</header>
    {error && <p role="alert" className="my-2 text-xs text-red-700">{error}</p>}
    <div className="grid grid-cols-2 gap-x-5">{documentGuideSlots.map(item => {
      const pin = value.pins.find(p => p.slot === item.id);
      return <div key={item.id} className="min-w-0 border-t border-line py-3"><p className="mb-2 text-xs text-ink-faint">{item.label}</p><div className="flex items-center justify-between gap-2">{pin ? <Link className="min-w-0 break-words text-sm text-primary hover:underline" href={pin.href}>{pin.title}</Link> : <span className="text-xs text-ink-faint">尚未固定资料</span>}{editing && value.canManage ? <div className="flex shrink-0 gap-2 text-xs text-primary"><button disabled={busy} type="button" aria-label={`设置${item.label}`} onClick={() => setSlot(item.id)}>{pin ? "更换" : "选择"}</button>{pin && <button disabled={busy} type="button" aria-label={`取消固定${item.label}`} onClick={() => void choose(null, item.id)}><X size={13} /></button>}</div> : pin && <ArrowUpRight size={13} className="shrink-0 text-ink-faint" />}</div></div>;
    })}</div>
    <div className="mt-2 border-t border-line pt-3"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-medium text-ink-soft">相关工作</h3><Link href={`/projects/${projectId}`} className="text-xs text-primary">查看任务 →</Link></div>{value.tasks.length ? value.tasks.map(task => <TaskLink key={task.taskId} href={task.href} className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary"><span className="min-w-0 break-words">{task.title}</span><span className="shrink-0 rounded bg-primary-soft px-2 py-1 text-xs text-primary">{task.status === "doing" ? "进行中" : "待办"}</span></TaskLink>) : <p className="py-2 text-xs text-ink-faint">固定资料关联的未完成任务会显示在这里。</p>}</div>
    {slot && <DocumentReferencePicker projectId={projectId} documentId="" query="" sharedOnly onClose={() => setSlot(null)} onChoose={item => void choose(item)} />}
  </section>;
}
export function PersonalDocumentShortcuts({ value, showProject = false }: { value: DocumentPersonal; showProject?: boolean }) {
  return <aside className="space-y-4" aria-label="个人常用文档">{([{ key: "favorites", label: "我的收藏", icon: Star, empty: "点击文档旁的星标，保存常用资料。" }, { key: "recent", label: "最近打开", icon: Clock3, empty: "打开过的文档会显示在这里。" }] as const).map(group => <section key={group.key} className="ac-card p-4"><h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><group.icon size={15} className="text-ink-soft" />{group.label}</h2>{value[group.key].length ? <ul className="divide-y divide-line">{value[group.key].slice(0, showProject ? 4 : group.key === "favorites" ? 6 : 4).map(item => <li key={item.id} className="py-3"><Link href={item.href} className="flex items-start gap-2 text-sm text-ink hover:text-primary"><FileText size={14} className="mt-0.5 shrink-0 text-ink-faint" /><span className="min-w-0 break-words">{item.title}<span className="mt-1 block text-xs text-ink-faint">{showProject ? item.projectName : group.key === "recent" ? displayDateTime(item.at) : item.folder}</span></span></Link></li>)}</ul> : <p className="py-2 text-xs leading-relaxed text-ink-soft">{group.empty}</p>}</section>)}<p className="text-xs text-ink-faint">收藏和阅读记录仅自己可见。</p></aside>;
}
