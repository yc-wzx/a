"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, CheckSquare, Link2, Pencil, Trash2 } from "lucide-react";
import type { Result } from "@/contracts/p0-p2";
import type { ChecklistItem, TaskEnhancements as EnhancementData } from "@/contracts/task-enhancements";
import { addChecklistItemAction, deleteChecklistItemAction, getTaskEnhancementsAction, linkTaskMaterialAction, setTaskWatchingAction, unlinkTaskMaterialAction, updateChecklistItemAction } from "@/app/(app)/projects/[projectId]/tasks/enhancement-actions";
import { newRequestId } from "@/lib/request-id";

export function TaskEnhancementSection({ projectId, taskId, onSaved }: { projectId: string; taskId: string; onSaved?: () => void }) {
  const [data, setData] = useState<EnhancementData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let cancelled = false;
    getTaskEnhancementsAction(projectId, taskId).then((result) => {
      if (cancelled) return;
      if (result.ok) { setData(result.data); setError(null); }
      else { setData(null); setError(result.error); }
    }).catch(() => { if (!cancelled) { setData(null); setError("暂时无法读取检查清单与资料，请重试"); } });
    return () => { cancelled = true; };
  }, [projectId, taskId, nonce]);

  function run(operation: () => Promise<Result<unknown>>, after?: () => void, rollback?: () => void) {
    startTransition(async () => {
      setError(null);
      try {
        const result = await operation();
        if (!result.ok) { rollback?.(); setError(result.error); if (result.code === "CONFLICT") setNonce((n) => n + 1); return; }
        after?.();
        const fresh = await getTaskEnhancementsAction(projectId, taskId);
        if (fresh.ok) setData(fresh.data); else setError(fresh.error);
        onSaved?.();
      } catch { rollback?.(); setError("保存状态暂时无法确认，请刷新后重试"); }
    });
  }
  if (!data || data.taskId !== taskId) return <section className="space-y-2 border-t border-line pt-4" aria-label="任务检查清单与关联资料">
    <p className="text-sm text-ink-soft">{error ?? "载入检查清单与关联资料…"}</p>
    {error && <button type="button" className="ac-btn-ghost text-sm" onClick={() => setNonce((n) => n + 1)}>重试</button>}
  </section>;
  const done = data.checklist.filter((item) => item.checked).length;
  const linked = new Set(data.materials.map((m) => `${m.kind}:${m.sourceId}`));
  const available = data.materialOptions.filter((m) => !linked.has(`${m.kind}:${m.id}`));
  return <section className="space-y-4 border-t border-line pt-4" aria-label="任务检查清单与关联资料">
    <div className="flex items-center justify-between gap-2">
      <button type="button" disabled={pending || !data.canWatch} onClick={() => run(() => setTaskWatchingAction(projectId, taskId, { requestId: newRequestId(), watching: !data.watching }))}
        className={`ac-btn-ghost flex items-center gap-1.5 text-sm ${data.watching ? "text-primary" : ""}`} aria-pressed={data.watching}>
        <Bell size={15} aria-hidden="true" />{data.watching ? "已关注 · 取消关注" : "关注任务"}
      </button>
      <span className="text-xs text-ink-faint">{data.watchCount} 人关注</span>
    </div>
    <div className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-ink"><CheckSquare size={15} aria-hidden="true" />完成检查清单 <span className="ml-auto text-xs font-normal text-ink-soft">{done}/{data.checklist.length}</span></h4>
      {!data.checklist.length && <p className="text-xs text-ink-soft">用检查项记录完成前的小步骤。</p>}
      {data.checklist.length > 0 && <progress className="h-1.5 w-full accent-primary" value={done} max={data.checklist.length} aria-label="检查项完成进度" />}
      <ul className="space-y-2">
        {data.checklist.map((item) => <ChecklistRow key={item.id} item={item} canWrite={data.canWrite} pending={pending}
          onUpdate={(patch) => {
            // Reflect a tick immediately, while preserving the server revision
            // and rolling the visual change back if authorization/save fails.
            if (patch.checked !== undefined) setData({ ...data, checklist: data.checklist.map(row => row.id === item.id ? { ...row, checked: patch.checked! } : row) });
            run(() => updateChecklistItemAction(projectId, taskId, { requestId: newRequestId(), itemId: item.id, expectedRevision: item.revision, ...patch }), undefined, () => setData(data));
          }}
          onDelete={() => run(() => deleteChecklistItemAction(projectId, taskId, { requestId: newRequestId(), itemId: item.id, expectedRevision: item.revision }))} />)}
      </ul>
      {data.canWrite && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (text.trim()) run(() => addChecklistItemAction(projectId, taskId, { requestId: newRequestId(), text }), () => setText("")); }}>
        <input className="ac-field min-w-0 flex-1 text-sm" aria-label="新检查项" placeholder="例如：异常流程已测试" value={text} maxLength={500} disabled={pending} onChange={(event) => setText(event.target.value)} />
        <button className="ac-btn-ghost shrink-0 text-sm" disabled={pending || !text.trim() || data.checklist.length >= 50}>添加</button>
      </form>}
    </div>
    <div className="space-y-2">
      <h4 className="flex items-center gap-1.5 text-sm font-medium text-ink"><Link2 size={15} aria-hidden="true" />关联资料</h4>
      {!data.materials.length && <p className="text-xs text-ink-soft">关联已有会议资料或正式成果版本，便于完成任务时查看。</p>}
      <ul className="space-y-2">{data.materials.map((material) => <li key={material.id} className="flex items-start gap-2 rounded-field bg-sunken p-2 text-sm">
        <a href={material.href} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-words text-primary hover:underline">{material.title} ↗</a>
        {data.canWrite && <button type="button" className="shrink-0 text-xs text-ink-soft hover:text-high" disabled={pending} onClick={() => run(() => unlinkTaskMaterialAction(projectId, taskId, { requestId: newRequestId(), linkId: material.id, expectedRevision: material.revision }))} aria-label={`解除关联：${material.title}`}>解除</button>}
      </li>)}</ul>
      {data.canWrite && available.length > 0 && <form className="flex gap-2" onSubmit={(event) => {
        event.preventDefault(); const option = available.find((m) => `${m.kind}:${m.id}` === source); if (option) run(() => linkTaskMaterialAction(projectId, taskId, { requestId: newRequestId(), kind: option.kind, sourceId: option.id }), () => setSource(""));
      }}>
        <select aria-label="选择关联资料" className="ac-field min-w-0 flex-1 text-sm" value={source} disabled={pending} onChange={(event) => setSource(event.target.value)}>
          <option value="">选择项目资料或成果版本</option>
          {available.map((option) => <option key={`${option.kind}:${option.id}`} value={`${option.kind}:${option.id}`}>{option.kind === "resource" ? "资料" : "成果"} · {option.title}</option>)}
        </select><button className="ac-btn-ghost shrink-0 text-sm" disabled={pending || !source || data.materials.length >= 50}>关联</button>
      </form>}
    </div>
    {error && <p role="alert" className="text-sm text-high">{error}</p>}
  </section>;
}

function ChecklistRow({ item, canWrite, pending, onUpdate, onDelete }: { item: ChecklistItem; canWrite: boolean; pending: boolean; onUpdate: (patch: { text?: string; checked?: boolean }) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  return <li className="space-y-1.5 rounded-field bg-sunken p-2">
    <div className="flex items-start gap-2">
      <label className="flex min-w-0 flex-1 items-start gap-2 text-sm"><input type="checkbox" checked={item.checked} disabled={pending || !canWrite} onChange={(event) => onUpdate({ checked: event.target.checked })} className="mt-0.5 accent-primary" /><span className={`break-words ${item.checked ? "text-ink-faint line-through" : "text-ink"}`}>{item.text}</span></label>
      {canWrite && <><button type="button" aria-label={`编辑检查项：${item.text}`} className="text-ink-faint hover:text-ink" disabled={pending} onClick={() => { setText(item.text); setEditing(!editing); }}><Pencil size={14} /></button><button type="button" aria-label={`删除检查项：${item.text}`} className="text-ink-faint hover:text-high" disabled={pending} onClick={onDelete}><Trash2 size={14} /></button></>}
    </div>
    {editing && <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (text.trim()) { onUpdate({ text }); setEditing(false); } }}><input aria-label="编辑检查项内容" className="ac-field min-w-0 flex-1 text-sm" value={text} maxLength={500} disabled={pending} onChange={(event) => setText(event.target.value)} /><button className="ac-btn-ghost text-sm" disabled={pending || !text.trim()}>保存</button></form>}
  </li>;
}
