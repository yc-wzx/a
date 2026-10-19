"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { z } from "zod";
import { Columns3, List, ChartGantt } from "lucide-react";
import { openTaskPreview } from "@/lib/task-navigation";
import {
  parseTaskSort,
  parseTaskView,
  VIEW_LABELS,
  type TaskView,
  sortTasks,
} from "@/lib/project-views";
import { deriveColumns } from "@/lib/board-columns";
import type { GroupBy } from "@/lib/board-filters";
import { Board, type BoardTask } from "./board";
import type { Option } from "./task-card";

const STATUS = { todo: "待办", doing: "进行中", done: "已完成" };
const PRIORITY: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};
const ICONS = { board: Columns3, list: List, gantt: ChartGantt };

export function TaskWorkspace(props: {
  projectId: string;
  tasks: BoardTask[];
  groupBy: GroupBy;
  canWrite: boolean;
  members: Option[];
  milestones: Option[];
  allTasks: { id: string; title: string }[];
  dependencies: { predecessorId: string; successorId: string }[];
  today: string;
  doingLimit?: { doingLimit: number | null; doingCount: number; exceeded: boolean };
}) {
  const { tasks, today, groupBy, members, milestones } = props;
  const router = useRouter(),
    pathname = usePathname(),
    search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const view = parseTaskView(search.get("view")),
    sort = parseTaskSort(search.get("sort"));
  const rawId = search.get("task");
  const taskId = rawId && z.uuid().safeParse(rawId).success ? rawId : null;
  function change(key: string, value: string | null) {
    const params = new URLSearchParams(search.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    startTransition(() =>
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }),
    );
  }
  const open = (id: string) => openTaskPreview(`/projects/${props.projectId}?task=${id}`);
  const sorted = sortTasks(tasks, sort);
  const columns = deriveColumns(groupBy, { members, milestones });
  return (
    <div className="space-y-3" aria-busy={pending}>
      <div className="flex items-center justify-between gap-3">
        <nav
          className="inline-flex rounded-lg border border-line bg-surface p-1"
          aria-label="任务视图"
        >
          {(Object.keys(VIEW_LABELS) as TaskView[]).map((key) => {
            const Icon = ICONS[key];
            return (
              <button
                type="button"
                key={key}
                aria-pressed={view === key}
                onClick={() => change("view", key === "board" ? null : key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors ${view === key ? "bg-primary text-white" : "text-ink-soft hover:bg-sunken"}`}
              >
                <Icon size={15} aria-hidden />
                {VIEW_LABELS[key]}
              </button>
            );
          })}
        </nav>
        {view === "list" && (
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            排序
            <select
              aria-label="列表排序"
              className="ac-field w-auto py-1.5"
              value={sort}
              onChange={(e) =>
                change(
                  "sort",
                  e.target.value === "default" ? null : e.target.value,
                )
              }
            >
              <option value="default">原有顺序</option>
              <option value="due">截止日期优先</option>
              <option value="priority">优先级优先</option>
              <option value="title">标题</option>
            </select>
          </label>
        )}
      </div>
      {tasks.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-soft">
          当前没有符合筛选的任务；可清空筛选，或创建任务。
        </p>
      )}
      {view === "board" ? (
        <Board {...props} onOpenTask={open} />
      ) : view === "list" ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[680px] text-left text-sm">
            <caption className="sr-only">
              项目任务列表，点击任务标题打开详情
            </caption>
            <thead className="bg-sunken text-xs text-ink-soft">
              <tr>
                {["任务", "状态", "负责人", "优先级", "截止日期", "里程碑"].map(
                  (label) => (
                    <th
                      key={label}
                      className="px-3 py-3 font-medium"
                      scope="col"
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            {columns.map((column) => {
              const rows = sorted.filter(column.matches);
              if (!rows.length) return null;
              return (
                <tbody key={column.key}>
                  <tr className="border-t border-line bg-sunken/50">
                    <th
                      colSpan={6}
                      className="px-3 py-2 text-xs font-medium text-ink-soft"
                    >
                      {column.label} · {rows.length}
                    </th>
                  </tr>
                  {rows.map((task) => (
                    <tr
                      key={task.id}
                      className={`border-t border-line hover:bg-sunken/50 ${task.id === taskId ? "bg-primary-soft" : ""}`}
                    >
                      <th
                        scope="row"
                        className="max-w-72 px-3 py-3 font-normal"
                      >
                        <button
                          type="button"
                          className="text-left text-ink underline-offset-4 hover:text-primary hover:underline"
                          onClick={() => open(task.id)}
                        >
                          {task.parentTaskId && (
                            <span className="mr-1 text-xs text-ink-faint">
                              子任务
                            </span>
                          )}
                          {task.title}
                        </button>
                      </th>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {STATUS[task.status]}
                      </td>
                      <td className="px-3 py-3">
                        {task.assignees?.map(m => m.name).join("、") || task.assigneeName || "未指派"}
                      </td>
                      <td className="px-3 py-3">
                        {PRIORITY[task.priority] ?? task.priority}
                      </td>
                      <td
                        className={`px-3 py-3 whitespace-nowrap ${task.dueDate && task.dueDate < today && task.status !== "done" ? "text-high" : "text-ink-soft"}`}
                      >
                        {task.dueDate ?? "未排期"}
                        {task.dueDate &&
                          task.dueDate < today &&
                          task.status !== "done" && (
                            <span className="ml-1 text-xs">逾期</span>
                          )}
                      </td>
                      <td className="max-w-36 px-3 py-3 text-xs text-ink-soft">
                        {milestones.find((m) => m.id === task.milestoneId)
                          ?.name ?? "无里程碑"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      ) : (
        <ProjectGantt
          tasks={sorted}
          today={today}
          milestones={milestones}
          onOpen={open}
          activeId={taskId}
        />
      )}
    </div>
  );
}

const DAY = 86400000;
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
function ProjectGantt({
  tasks,
  today,
  milestones,
  onOpen,
  activeId,
}: {
  tasks: BoardTask[];
  today: string;
  doingLimit?: { doingLimit: number | null; doingCount: number; exceeded: boolean };
  milestones: Option[];
  onOpen: (id: string) => void;
  activeId: string | null;
}) {
  const scheduled = tasks
    .filter((t) => t.startDate || t.dueDate)
    .map((task) => {
      const start = dayMs((task.startDate ?? task.dueDate)!);
      return {
        task,
        start,
        end: Math.max(
          dayMs((task.dueDate ?? task.startDate)!) + DAY,
          start + DAY,
        ),
      };
    });
  const unscheduled = tasks.filter((t) => !t.startDate && !t.dueDate);
  const todayMs = dayMs(today);
  const start = Math.min(todayMs, ...scheduled.map((t) => t.start)) - DAY;
  const end = Math.max(todayMs + DAY, ...scheduled.map((t) => t.end)) + DAY;
  const pct = (ms: number) => ((ms - start) / (end - start)) * 100;
  const groups = [...milestones, { id: "none", name: "无里程碑" }];
  const colors = { todo: "bg-todo", doing: "bg-doing", done: "bg-done" };
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft">
        时间线按里程碑分组，横条为起始日到截止日，竖线为今日；点击标题或横条打开详情。
      </p>
      {scheduled.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <div className="min-w-[680px]">
            <div className="flex border-b border-line bg-sunken px-4 py-3">
              <span className="w-44 shrink-0 text-xs text-ink-soft">
                任务 / 里程碑
              </span>
              <div className="relative h-4 flex-1">
                {Array.from({ length: 5 }, (_, i) => {
                  const ms = start + ((end - start) * i) / 4;
                  return (
                    <span
                      key={i}
                      style={{ left: `${pct(ms)}%` }}
                      className={`absolute text-[11px] text-ink-faint ${i === 4 ? "-translate-x-full" : i === 0 ? "" : "-translate-x-1/2"}`}
                    >
                      {new Date(ms).toISOString().slice(5, 10)}
                    </span>
                  );
                })}
              </div>
            </div>
            {groups.map((group) => {
              const rows = scheduled.filter(
                (t) => (t.task.milestoneId ?? "none") === group.id,
              );
              if (!rows.length) return null;
              return (
                <section key={group.id}>
                  <h3 className="bg-sunken/50 px-4 py-2 text-xs font-medium text-ink-soft">
                    {group.name}
                  </h3>
                  {rows.map(({ task, start: from, end: to }) => (
                    <div
                      key={task.id}
                      className={`flex items-center gap-0 border-t border-line px-4 py-2 ${activeId === task.id ? "bg-primary-soft" : ""}`}
                    >
                      <button
                        type="button"
                        className="w-44 shrink-0 truncate pr-3 text-left text-xs text-ink hover:text-primary"
                        title={task.title}
                        onClick={() => onOpen(task.id)}
                      >
                        {task.parentTaskId ? "↳ " : ""}
                        {task.title}
                      </button>
                      <div className="relative h-7 flex-1">
                        <span
                          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-primary/50"
                          style={{ left: `${pct(todayMs)}%` }}
                          title={`今日 ${today}`}
                        />
                        <button
                          type="button"
                          className={`absolute top-1 h-5 rounded ${task.dueDate && task.dueDate < today && task.status !== "done" ? "bg-high" : colors[task.status]} hover:opacity-75 focus-visible:outline-2 focus-visible:outline-primary`}
                          style={{
                            left: `${pct(from)}%`,
                            width: `${Math.max(pct(to) - pct(from), 1)}%`,
                          }}
                          onClick={() => onOpen(task.id)}
                          aria-label={`打开任务：${task.title}`}
                          title={`${task.title} · ${task.startDate ?? "未设置"} → ${task.dueDate ?? "未设置"} · ${STATUS[task.status]}`}
                        />
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}
      {scheduled.length === 0 && tasks.length > 0 && (
        <p className="ac-card p-6 text-sm text-ink-soft">
          尚无已排期任务；给任务设置起始日或截止日即可显示横条。
        </p>
      )}
      {unscheduled.length > 0 && (
        <section className="ac-card p-4">
          <h3 className="text-sm font-medium text-ink">
            未排期（{unscheduled.length}）
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {unscheduled.map((t) => (
              <button
                key={t.id}
                type="button"
                className="ac-btn-ghost text-xs"
                onClick={() => onOpen(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="flex gap-4 text-xs text-ink-soft">
        {Object.entries(colors).map(([status, color]) => (
          <span key={status} className="flex items-center gap-1">
            <i aria-hidden className={`h-2 w-2 rounded-sm ${color}`} />
            {STATUS[status as keyof typeof STATUS]}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <i aria-hidden className="h-2 w-2 rounded-sm bg-high" />
          逾期
        </span>
      </div>
    </div>
  );
}
