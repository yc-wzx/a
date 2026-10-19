"use client";
import { startTransition, useActionState, useState } from "react";
import { saveProjectSettings, deleteProjectSettings } from "./actions";
type Project = { id: string; name: string; description: string | null; startDate: string | null; endDate: string | null; status: "active" | "archived" };
export function SettingsForm({ project, version, preview }: { project: Project; version: string; preview: { token: string; counts: Record<string, number> } }) {
  const [state, action, pending] = useActionState(saveProjectSettings.bind(null, project.id, version), null);
  const [failure, remove, deleting] = useActionState(deleteProjectSettings.bind(null, project.id, preview.token), null);
  const [confirmation, setConfirmation] = useState("");
  return <div className="max-w-2xl space-y-6"><form onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => action(form)); }} className="ac-card space-y-4 p-6"><fieldset disabled={pending} className="space-y-4">
    <label className="block text-sm">项目名称<input name="name" required maxLength={200} className="ac-field mt-1" defaultValue={project.name} /></label>
    <label className="block text-sm">项目说明<textarea name="description" rows={4} maxLength={10000} className="ac-field mt-1" defaultValue={project.description ?? ""} /></label>
    <div className="grid grid-cols-2 gap-4"><label className="text-sm">开始日期<input type="date" name="startDate" className="ac-field mt-1" defaultValue={project.startDate ?? ""} /></label><label className="text-sm">结束日期<input type="date" name="endDate" className="ac-field mt-1" defaultValue={project.endDate ?? ""} /></label></div>
    <label className="block text-sm">项目状态<select name="status" className="ac-field mt-1" defaultValue={project.status}><option value="active">进行中</option><option value="archived">已归档</option></select></label>
    <p className="text-sm text-ink-soft">归档后保留任务、文档和成果供查阅，并停止项目编辑；恢复为“进行中”即可继续协作。</p>
    {state?.error && <p role="alert" className="text-sm text-high">{state.error}</p>}{state?.success && <p role="status" className="text-sm text-done">{state.success}</p>}<button className="ac-btn">{pending ? "保存中…" : "保存设置"}</button>
  </fieldset></form>
  {project.status === "archived" && <details className="ac-card border-high/30 p-6"><summary className="cursor-pointer text-sm font-medium text-high">永久删除项目</summary><div className="mt-4 space-y-4 text-sm"><p>将删除整个项目及其全部内容，包含成员的私有文档、任务讨论、成果版本和历史记录，无法恢复。该项目内的个人计划、项目助手会话和项目记忆也会删除。成员账号、全局个人助手数据和个人课表保留。</p><p>任务 {preview.counts.tasks} · 文档 {preview.counts.documents} · 成果 {preview.counts.deliverables} · 迭代 {preview.counts.iterations} · 里程碑 {preview.counts.milestones} · 资料 {preview.counts.references}</p><form action={remove} className="space-y-3"><label className="block">输入项目全名「{project.name}」确认<input name="confirmation" className="ac-field mt-2" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={deleting} autoComplete="off" /></label>{failure?.error && <p role="alert" className="text-high">{failure.error}</p>}<button className="ac-btn-ghost text-high" disabled={deleting || confirmation !== project.name}>{deleting ? "删除中…" : "永久删除项目及全部内容"}</button></form></div></details>}
  </div>;
}
