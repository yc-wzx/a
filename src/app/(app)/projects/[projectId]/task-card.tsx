"use client";

import { GripVertical, MoreHorizontal } from "lucide-react";
import type { BoardColumn } from "@/lib/board-columns";
import { useDraggable } from "@dnd-kit/core";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import type { BoardTask } from "./board";

export type Option = { id: string; name: string };
type TaskOption = { id: string; title: string };
const PRIORITY_BADGE: Record<string, string> = { high: "bg-high-soft text-high", medium: "bg-medium-soft text-medium", low: "bg-low-soft text-low" };

export function TaskCard({ task, canWrite, allTasks, dependencies, onOpen, columns, onMove }: {
  task: BoardTask; canWrite: boolean; allTasks: TaskOption[];
  dependencies: { predecessorId: string; successorId: string }[];
  onOpen: () => void; columns: BoardColumn[]; onMove: (taskId: string, columnKey: string) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: task.id, disabled: !canWrite });
  const successorTitles = dependencies.filter(d => d.predecessorId === task.id).map(d => allTasks.find(t => t.id === d.successorId)?.title).filter(Boolean);
  return <article ref={setNodeRef} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
    className={`project-task-card ac-card p-3.5 text-sm ${isDragging ? "opacity-50" : ""}`}>
    <div className="flex items-start gap-2 pr-5">
      <button type="button" onPointerDown={e => e.stopPropagation()} onClick={onOpen} className="min-w-0 flex-1 text-left font-medium leading-6 text-ink hover:text-primary hover:underline">{task.title}</button>
      <div className="flex shrink-0 items-start">
        {canWrite && <button type="button" ref={setActivatorNodeRef} {...listeners} {...attributes} aria-label={`拖动任务：${task.title}`} title="空格开始，左右方向键选择列，空格放下，Esc 取消" className="cursor-grab rounded p-1 text-ink-faint hover:bg-sunken"><GripVertical size={15} /></button>}
      </div>
    </div>
        <details className="project-card-menu"><summary aria-label={`更多任务操作：${task.title}`}><MoreHorizontal size={16} /></summary><div>
          <button type="button" onClick={onOpen} className="mb-3 text-primary">打开任务详情</button>
          {canWrite && <label className="block text-xs text-ink-soft">移动至<select aria-label={`移动任务：${task.title}`} value="" onChange={event => { if (!event.target.value) return; onMove(task.id, event.target.value); event.currentTarget.closest("details")?.removeAttribute("open"); }} className="ac-field mt-1"><option value="">选择列</option>{columns.filter(c => !c.matches(task)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
          {task.description && <p className="mt-3 whitespace-pre-wrap text-xs text-ink-soft">{task.description}</p>}
          {task.status === "done" && task.completionNote && <p className="mt-2 text-xs text-done">完成情况：{task.completionNote}</p>}
          {successorTitles.length > 0 && <p className="mt-2 text-xs text-ink-faint">后置：{successorTitles.join("、")}</p>}
        </div></details>
    <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft"><span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? "bg-low-soft text-low"}`}>{{ high: "高", medium: "中", low: "低" }[task.priority] ?? task.priority}</span>{task.dueDate && <span>截止 {task.dueDate}</span>}<span className="ml-auto">{task.assignees?.map(m => m.name).join("、") || task.assigneeName || "未分配"}</span></p>
    {(task.labels.length > 0 || task.parentTaskId) && <p className="mt-2 flex flex-wrap items-center gap-1">{task.parentTaskId && <span className="ac-badge bg-sunken text-ink-soft">子任务</span>}{task.labels.slice(0, 2).map(l => <span key={l.id} className={`ac-badge ${LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}`}>{l.name}</span>)}{task.labels.length > 2 && <span className="text-xs text-ink-faint">+{task.labels.length - 2}</span>}</p>}
  </article>;
}
