"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { bulkTaskUpdateSchema, type BulkTaskUpdate } from "@/contracts/task-bulk";
import { bulkUpdateTasksAction } from "./actions";
import type { BoardTask } from "./board";

export type BulkEditableTask = BoardTask & { updatedAt: string; sprintId: string | null };
export type BulkIteration = { id: string; name: string; revision: number; status: string };
type Change = { taskId: string; title: string; field: string; before: string; after: string };
const priorities: Record<string, string> = { low: "低", medium: "中", high: "高" };
type DateMode = "keep" | "set" | "clear";

export function BulkTaskEdit({ projectId, tasks, iterations, onClose, onSaved }: {
  projectId: string;
  tasks: BulkEditableTask[];
  iterations: BulkIteration[];
  onClose: () => void;
  onSaved: (count: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [priority, setPriority] = useState("keep");
  const [iteration, setIteration] = useState("keep");
  const [startMode, setStartMode] = useState<DateMode>("keep");
  const [dueMode, setDueMode] = useState<DateMode>("keep");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ input: BulkTaskUpdate; changes: Change[] } | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  function prepare() {
    const patch: BulkTaskUpdate["patch"] = {};
    if (priority !== "keep") patch.priority = priority as "low" | "medium" | "high";
    if (startMode !== "keep") patch.startDate = startMode === "clear" ? null : startDate;
    if (dueMode !== "keep") patch.dueDate = dueMode === "clear" ? null : dueDate;
    const parsed = bulkTaskUpdateSchema.safeParse({
      requestId: crypto.randomUUID(),
      tasks: tasks.map(task => ({ taskId: task.id, expectedUpdatedAt: task.updatedAt })),
      patch,
      ...(iteration !== "keep" && { iteration: {
        id: iteration === "backlog" ? null : iteration,
        versions: iterations.map(row => ({ id: row.id, revision: row.revision })),
      } }),
    });
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    const changes: Change[] = [];
    for (const task of tasks) {
      const start = patch.startDate === undefined ? task.startDate : patch.startDate;
      const due = patch.dueDate === undefined ? task.dueDate : patch.dueDate;
      if (start && due && start > due) { setError(`「${task.title}」的开始日期将晚于截止日期，请调整日期。`); return; }
      for (const [key, value] of Object.entries(patch)) {
        const field = key as keyof typeof patch;
        if (task[field] === value) continue;
        changes.push({ taskId: task.id, title: task.title,
          field: { startDate: "开始日期", dueDate: "截止日期", priority: "优先级" }[field],
          before: field === "priority" ? priorities[task.priority] : task[field] ?? "未设置",
          after: field === "priority" ? priorities[value!] : value ?? "未设置" });
      }
      if (parsed.data.iteration) {
        if (task.parentTaskId) { setError("子任务跟随主任务所属迭代，请只为主任务调整迭代。"); return; }
        const destination = parsed.data.iteration.id;
        if (task.sprintId !== destination) changes.push({ taskId: task.id, title: task.title, field: "所属迭代",
          before: iterations.find(row => row.id === task.sprintId)?.name ?? (task.sprintId ? "原迭代" : "任务池"),
          after: iterations.find(row => row.id === destination)?.name ?? "任务池" });
      }
    }
    if (!changes.length) { setError("所选任务已符合这些设置，请调整修改内容。"); return; }
    setError("");
    setPreview({ input: parsed.data, changes });
  }
  function save() {
    if (!preview) return;
    startTransition(async () => {
      setError("");
      try {
        const result = await bulkUpdateTasksAction(projectId, preview.input);
        if ("error" in result) setError(result.error);
        else onSaved(result.taskIds.length);
      } catch { setError("暂时无法确认修改结果，可重试同一次操作或刷新核对。"); }
    });
  }

  return <dialog ref={dialog} aria-labelledby="bulk-task-title" className="m-auto w-[min(900px,90vw)] max-h-[85vh] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/30"
    onCancel={event => { if (pending) event.preventDefault(); else onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (preview) save(); else prepare(); }}>
      <header className="border-b border-line px-6 py-5"><h2 id="bulk-task-title" className="text-lg font-semibold">{preview ? "确认批量修改" : "批量编辑任务"}</h2><p className="mt-1 text-xs text-ink-soft">已选择 {tasks.length} 项任务</p></header>
      <fieldset disabled={pending} className="max-h-[58vh] overflow-auto p-6">
        {preview ? <table className="w-full text-left text-sm">
          <caption className="sr-only">批量修改前后对比</caption>
          <thead className="text-xs text-ink-soft"><tr>{["任务", "字段", "修改前", "修改后"].map(label => <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{preview.changes.map(change => <tr key={`${change.taskId}:${change.field}`} className="border-t border-line"><th scope="row" className="max-w-64 break-words px-3 py-3 font-normal">{change.title}</th><td className="px-3 py-3">{change.field}</td><td className="px-3 py-3 text-ink-soft">{change.before}</td><td className="px-3 py-3 font-medium">{change.after}</td></tr>)}</tbody>
        </table> : <div className="grid grid-cols-2 gap-5">
          <label className="space-y-2 text-sm">优先级<select className="ac-field" value={priority} onChange={event => setPriority(event.target.value)}><option value="keep">保持原值</option>{Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-2 text-sm">所属迭代<select className="ac-field" value={iteration} onChange={event => setIteration(event.target.value)}><option value="keep">保持原值</option><option value="backlog">移回任务池</option>{iterations.filter(row => row.status !== "completed").map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="space-y-2 text-sm">开始日期<select className="ac-field" value={startMode} onChange={event => setStartMode(event.target.value as DateMode)}><option value="keep">保持原值</option><option value="set">设置日期</option><option value="clear">清空日期</option></select>{startMode === "set" && <input type="date" aria-label="批量开始日期" required className="ac-field" value={startDate} onChange={event => setStartDate(event.target.value)} />}</label>
          <label className="space-y-2 text-sm">截止日期<select className="ac-field" value={dueMode} onChange={event => setDueMode(event.target.value as DateMode)}><option value="keep">保持原值</option><option value="set">设置日期</option><option value="clear">清空日期</option></select>{dueMode === "set" && <input type="date" aria-label="批量截止日期" required className="ac-field" value={dueDate} onChange={event => setDueDate(event.target.value)} />}</label>
        </div>}
      </fieldset>
      {error && <p role="alert" className="px-6 pb-4 text-sm text-high">{error}</p>}
      <footer className="flex items-center justify-end gap-3 border-t border-line px-6 py-4">
        <button type="button" disabled={pending} className="ac-btn-ghost" onClick={onClose}>取消</button>
        {preview && <button type="button" disabled={pending} className="ac-btn-ghost" onClick={() => { setPreview(null); setError(""); }}>返回调整</button>}
        <button disabled={pending} className="ac-btn">{pending ? "保存中…" : preview ? "确认修改" : "预览变更"}</button>
      </footer>
    </form>
  </dialog>;
}
