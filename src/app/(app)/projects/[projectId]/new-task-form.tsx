"use client";

import { MemberPicker } from "@/components/tasks/member-picker";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { emptyTaskDraft, hasTaskDraft, readTaskDraft, taskDraftKey, type TaskCreationDraft } from "@/lib/task-creation-draft";
import { installUnsavedChangesGuard } from "@/lib/unsaved-changes";
import { createTaskAction, type FormState } from "./actions";

export function NewTaskForm({ projectId, userId, members, milestones, iterations = [] }: {
  projectId: string;
  userId: string;
  members: { id: string; name: string }[];
  milestones: { id: string; title: string }[];
  iterations?: { id: string; name: string; revision: number }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [draft, setDraft] = useState(emptyTaskDraft);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [saved, setSaved] = useState(false);
  const unsaved = useRef(false);
  const key = taskDraftKey(userId, projectId);

  useEffect(() => {
    try {
      const restored = readTaskDraft(localStorage.getItem(key));
      if (restored) {
        // Hydrate the browser-owned draft after the server render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraft(restored);
        setSaved(true);
        if (detailsRef.current) detailsRef.current.open = true;
      }
    } catch { setStorageError("浏览器无法保存草稿，请在离开前复制任务内容。"); }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready || !formRef.current) return;
    return installUnsavedChangesGuard(() => unsaved.current,
      () => window.confirm("草稿尚未保存到浏览器，确定离开并放弃当前输入吗？"), formRef.current);
  }, [ready]);

  function change(patch: Partial<TaskCreationDraft>) {
    const next = { ...draft, ...patch, requestId: crypto.randomUUID() };
    setDraft(next);
    unsaved.current = hasTaskDraft(next);
    try {
      if (hasTaskDraft(next)) localStorage.setItem(key, JSON.stringify(next));
      else localStorage.removeItem(key);
      setStorageError(""); setSaved(hasTaskDraft(next)); unsaved.current = false;
    } catch { setStorageError("浏览器无法保存草稿，请在离开前复制任务内容。"); setSaved(false); }
  }
  function clearDraft() {
    if (hasTaskDraft(draft) && !window.confirm("确定清除这份未发布的任务草稿吗？")) return;
    try { localStorage.removeItem(key); setStorageError(""); }
    catch { setStorageError("清除失败，请检查浏览器存储设置后重试。"); return; }
    setDraft(emptyTaskDraft()); setSaved(false); unsaved.current = false;
  }
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (previous, form) => {
    try {
      const result = await createTaskAction(previous, form);
      if (result?.createdId) {
        try {
          if (readTaskDraft(localStorage.getItem(key))?.requestId === form.get("requestId")) localStorage.removeItem(key);
        } catch { setStorageError("任务已发布，浏览器草稿清理失败。再次提交相同草稿会返回同一任务。"); }
        setDraft(emptyTaskDraft()); setSaved(false); unsaved.current = false;
      }
      return result;
    } catch { return { error: "暂时无法确认创建结果，草稿已保留，可重试同一次提交或刷新核对。" }; }
  }, null);
  const missingMembers = draft.assigneeIds.some(id => !members.some(member => member.id === id));
  const missingIteration = !!draft.iterationId && !iterations.some(row => row.id === draft.iterationId);
  const missingMilestone = !!draft.milestoneId && !milestones.some(row => row.id === draft.milestoneId);

  return <details ref={detailsRef} className="project-new-task">
    <summary className="ac-btn cursor-pointer">＋ 新建任务{saved && <span className="ml-2 text-xs">有草稿</span>}</summary>
    {ready && <form ref={formRef} id="new-task" className="project-new-task-form scroll-mt-24 space-y-4 p-5"
      onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(() => formAction(form)); }}>
      <fieldset disabled={pending} className="space-y-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-medium text-ink">新建任务</h2><button type="button" className="text-xs text-ink-soft hover:text-high" onClick={clearDraft}>清除草稿</button></div>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="requestId" value={draft.requestId} />
        <input type="hidden" name="iterationRevision" value={iterations.find(row => row.id === draft.iterationId)?.revision ?? ""} />
        <input name="title" aria-label="新任务标题" required maxLength={200} placeholder="任务标题" className="ac-field" value={draft.title} onChange={event => change({ title: event.target.value })} />
        <textarea name="description" aria-label="任务描述" maxLength={10000} placeholder="任务描述（可选）" rows={2} className="ac-field" value={draft.description} onChange={event => change({ description: event.target.value })} />
        <MemberPicker members={members} selected={draft.assigneeIds} onChange={assigneeIds => change({ assigneeIds })} />
        {missingMembers && <p role="alert" className="text-sm text-high">部分已选成员已离开团队。<button type="button" className="ml-2 underline" onClick={() => change({ assigneeIds: draft.assigneeIds.filter(id => members.some(member => member.id === id)) })}>移除失效成员</button></p>}
        <div className="grid grid-cols-3 items-end gap-3">
          <label className="space-y-1 text-xs text-ink-soft">所属迭代<select name="iterationId" className="ac-field" value={draft.iterationId} onChange={event => change({ iterationId: event.target.value })}><option value="">暂放任务池</option>{missingIteration && <option disabled value={draft.iterationId}>原迭代已失效，请重新选择</option>}{iterations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="space-y-1 text-xs text-ink-soft">里程碑<select name="milestoneId" className="ac-field" value={draft.milestoneId} onChange={event => change({ milestoneId: event.target.value })}><option value="">无里程碑</option>{missingMilestone && <option disabled value={draft.milestoneId}>原里程碑已失效，请重新选择</option>}{milestones.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
          <label className="space-y-1 text-xs text-ink-soft">优先级<select name="priority" className="ac-field" value={draft.priority} onChange={event => change({ priority: event.target.value as TaskCreationDraft["priority"] })}><option value="low">低</option><option value="medium">中</option><option value="high">高</option></select></label>
          <label className="space-y-1 text-xs text-ink-soft">开始日期<input type="date" name="startDate" className="ac-field" value={draft.startDate} onChange={event => change({ startDate: event.target.value })} /></label>
          <label className="space-y-1 text-xs text-ink-soft">截止日期<input type="date" name="dueDate" className="ac-field" value={draft.dueDate} onChange={event => change({ dueDate: event.target.value })} /></label>
        </div>
        {state?.error && <p role="alert" className="text-sm text-high">{state.error}</p>}
        {storageError && <p role="alert" className="text-sm text-high">{storageError}</p>}
        {(missingIteration || missingMilestone) && <p role="alert" className="text-sm text-high">草稿中的迭代或里程碑已结束、删除或失去访问权限，请重新选择。</p>}
        <div className="flex items-center gap-3"><button disabled={pending || missingMembers || missingIteration || missingMilestone} className="ac-btn px-3 py-2 text-sm">{pending ? "发布中…" : "创建任务"}</button><p role="status" className="text-xs text-ink-soft">{state?.createdId && !hasTaskDraft(draft) ? "任务已创建。" : saved ? "草稿已保存在此浏览器，发布后通知成员。" : "填写后自动保存为本账号在此浏览器的草稿。"}</p></div>
      </fieldset>
    </form>}
  </details>;
}
