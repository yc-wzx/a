"use client";

import { GripVertical } from "lucide-react";
import type { BoardColumn } from "@/lib/board-columns";
import { useDraggable } from "@dnd-kit/core";
import { LABEL_COLOR_CLASS } from "@/lib/board-columns";
import type { BoardTask } from "./board";

export type Option = { id: string; name: string };
type TaskOption = { id: string; title: string };

const PRIORITY_BADGE: Record<string, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
};

export function TaskCard({
  task,
  canWrite,
  allTasks,
  dependencies,
  onOpen,
  columns, onMove,
}: {
  task: BoardTask;
  canWrite: boolean;
  allTasks: TaskOption[];
  dependencies: { predecessorId: string; successorId: string }[];
  onOpen: () => void;
  columns: BoardColumn[]; onMove: (taskId: string, columnKey: string) => void;
}) {
  // 登录布局统一托管详情面板；卡片仅把点击交给 TaskWorkspace。
  // 打开详情只更新浏览器历史，不重新跳转项目页。
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    disabled: !canWrite,
  });
  const successorTitles = dependencies
    .filter((d) => d.predecessorId === task.id)
    .map((d) => allTasks.find((t) => t.id === d.successorId)?.title)
    .filter(Boolean);

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={`ac-card p-3 text-sm transition hover:shadow-md ${isDragging ? "opacity-50" : ""}`}
    >
      <div>
        {canWrite && <button type="button" ref={setActivatorNodeRef} {...listeners} {...attributes} aria-label={`拖动任务：${task.title}`} title="空格开始，左右方向键选择列，空格放下，Esc 取消" className="float-right -mr-1 -mt-1 cursor-grab rounded p-1 text-ink-faint hover:bg-sunken"><GripVertical size={16} /></button>}
        <button
          type="button"
          // 阻止冒泡：拖拽把手覆盖了整张卡片，点标题不能被当成开始拖拽
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onOpen}
          className="block w-full text-left font-medium text-ink hover:text-primary hover:underline"
        >
          {task.title}
        </button>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
          <span>{task.assignees?.map(m => m.name).join("、") || task.assigneeName || "未分配"}</span>
          {(task.startDate || task.dueDate) && (
            <span>· {task.startDate ?? "…"}→{task.dueDate ?? "…"}</span>
          )}
          <span className={`ac-badge ${PRIORITY_BADGE[task.priority] ?? "bg-low-soft text-low"}`}>
            {{ high: "高", medium: "中", low: "低" }[task.priority] ?? task.priority}
          </span>
        </p>
        {task.labels.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1">
            {task.labels.slice(0, 3).map((l) => (
              <span
                key={l.id}
                className={`ac-badge ${LABEL_COLOR_CLASS[l.color] ?? LABEL_COLOR_CLASS.slate}`}
              >
                {l.name}
              </span>
            ))}
            {task.labels.length > 3 && (
              <span className="text-xs text-ink-faint">+{task.labels.length - 3}</span>
            )}
          </p>
        )}
        {task.description && (
          <p className="mt-1 text-xs text-ink-soft line-clamp-2">{task.description}</p>
        )}
        {task.status === "done" && task.completionNote && (
          <p className="mt-1 rounded bg-done/10 px-2 py-1 text-xs text-done">
            完成情况：{task.completionNote}
          </p>
        )}
        {successorTitles.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">后置：{successorTitles.join("、")}</p>
        )}
      </div>

      {canWrite && <label className="mt-2 flex items-center gap-2 text-xs text-ink-soft">移动至<select aria-label={`移动任务：${task.title}`} value="" onChange={event => onMove(task.id, event.target.value)} className="min-w-0 rounded border border-line bg-surface p-1"><option value="">选择列</option>{columns.filter(c => !c.matches(task)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>}
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 text-xs text-ink-faint hover:text-primary hover:underline"
      >
        {canWrite ? "编辑" : "详情"}
      </button>
    </div>
  );
}
