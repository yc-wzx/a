"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  deriveColumns,
  type BoardColumn,
  type ColumnPatch,
} from "@/lib/board-columns";
import type { GroupBy } from "@/lib/board-filters";
import { moveTaskAction } from "./actions";
import { TaskCard, type Option } from "./task-card";

const columnCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.code)) return;
  event.preventDefault();
  const columns = [...context.droppableRects.entries()].sort((a, b) => a[1].left - b[1].left);
  const index = columns.findIndex(([id]) => id === context.over?.id);
  const target = columns[index + (event.code === "ArrowLeft" ? -1 : 1)];
  const current = context.collisionRect;
  if (!target || !current) return currentCoordinates;
  return { x: currentCoordinates.x + target[1].left - current.left + 12, y: currentCoordinates.y + target[1].top - current.top + 42 };
};

export type BoardTask = {
  assignees?: { id: string; name: string }[];
  id: string;
  title: string;
  description: string | null;
  completionNote: string | null;
  status: "todo" | "doing" | "done";
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  milestoneId: string | null;
  labels: { id: string; name: string; color: string }[];
  parentTaskId: string | null;
};

function Column({
  column,
  tasks,
  canWrite,
  allTasks,
  dependencies,
  onOpenTask,
  columns, onMove, doingLimit,
}: {
  column: BoardColumn;
  tasks: BoardTask[];
  canWrite: boolean;
  allTasks: { id: string; title: string }[];
  dependencies: { predecessorId: string; successorId: string }[];
  onOpenTask: (taskId: string) => void;
  columns: BoardColumn[]; onMove: (taskId: string, columnKey: string) => void;
  doingLimit?: { doingLimit: number | null; doingCount: number; exceeded: boolean };
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <div
      ref={setNodeRef}
      className={`min-h-40 min-w-0 space-y-3 rounded-xl p-3 transition-colors ${
        isOver ? "bg-primary-soft" : "bg-sunken"
      }`}
    >
      <h3
        className={`flex items-center gap-2 text-sm font-semibold ${column.tone}`}
      >
        {column.label}
        <span className="ac-badge bg-surface text-ink-soft">
          {tasks.length}
        </span>
      </h3>
      {column.key === "doing" && doingLimit?.doingLimit != null && <p className={`text-xs ${doingLimit.exceeded ? "text-high" : "text-ink-soft"}`}>全项目主任务 {doingLimit.doingCount} / 建议 {doingLimit.doingLimit}{doingLimit.exceeded ? " · 已超出建议数量" : ""}</p>}
      {tasks.map((t) => (
        <TaskCard
          key={t.id}
          task={t}
          canWrite={canWrite}
          allTasks={allTasks}
          dependencies={dependencies}
          onOpen={() => onOpenTask(t.id)}
          columns={columns} onMove={onMove}
        />
      ))}
    </div>
  );
}

export function Board({
  projectId,
  tasks,
  groupBy,
  canWrite,
  members,
  milestones,
  allTasks,
  dependencies,
  onOpenTask,
  doingLimit,
}: {
  projectId: string;
  tasks: BoardTask[];
  groupBy: GroupBy;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  dependencies: { predecessorId: string; successorId: string }[];
  onOpenTask: (taskId: string) => void;
  doingLimit?: { doingLimit: number | null; doingCount: number; exceeded: boolean };
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optimisticTasks, moveOptimistic] = useOptimistic(
    tasks,
    (current, move: { taskId: string; patch: ColumnPatch }) =>
      current.map((t) => (t.id === move.taskId ? { ...t, ...move.patch } : t)),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  );

  const columns = deriveColumns(groupBy, { members, milestones });

  function handleDragEnd(event: DragEndEvent) { move(String(event.active.id), event.over ? String(event.over.id) : ""); }
  function move(taskId: string, over: string) {
    if (!over) return;
    const column = columns.find((c) => c.key === String(over));
    const task = optimisticTasks.find((t) => t.id === taskId);
    // 已在目标列则无须提交
    if (!column || !task || column.matches(task)) return;

    startTransition(async () => {
      setError(null);
      moveOptimistic({ taskId, patch: column.patch });
      try { const res = await moveTaskAction({
        taskId,
        projectId,
        patch: column.patch,
      });
      if (res?.error) setError(res.error); } catch { setError("移动结果未确认，请刷新核对后重试"); }
    });
  }

  return (
    <DndContext
      id={`board-${projectId}`}
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ screenReaderInstructions: { draggable: "按空格开始拖动，左右方向键选择目标列，再按空格放下；Esc 取消。也可以使用卡片的移动至菜单。" } }}
      onDragEnd={handleDragEnd}
    >
      {error && <p className="text-sm text-high">{error}</p>}
      <div className="overflow-x-auto pb-2"><div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(250px, 1fr))` }}>
        {columns.map((col) => (
          <Column
            key={col.key}
            column={col}
            tasks={optimisticTasks.filter((t) => col.matches(t))}
            canWrite={canWrite}
            allTasks={allTasks}
            dependencies={dependencies}
            onOpenTask={onOpenTask}
            columns={columns} onMove={move} doingLimit={groupBy === "status" ? doingLimit : undefined}
          />
        ))}
      </div></div>
    </DndContext>
  );
}
