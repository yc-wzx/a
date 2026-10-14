"use client";

import { useState } from "react";
import Link from "next/link";
import { TaskLink } from "@/components/tasks/task-link";
import { ArrowUpRight, Search, ListTodo, X } from "lucide-react";
import type { TaskGroup, TaskGroupKey } from "@/lib/dashboard";

const statusLabels: Record<string, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};
const filterLabels = [
  { key: "all", label: "全部" },
  { key: "overdue", label: "已逾期" },
  { key: "today", label: "今天截止" },
  { key: "next7", label: "未来 7 天" },
] as const;
export function DashboardTaskList({ groups }: { groups: TaskGroup[] }) {
  const [filter, setFilter] = useState<"all" | TaskGroupKey>("all"),
    [query, setQuery] = useState(""),
    [project, setProject] = useState(""),
    [limit, setLimit] = useState(8);
  const all = groups.flatMap((g) => g.tasks);
  const projects = [
    ...new Map(all.map((t) => [t.projectId, t.projectName])).entries(),
  ];
  const visible = groups
    .filter((g) => filter === "all" || filter === g.key)
    .map((g) => ({
      ...g,
      tasks: g.tasks.filter(
        (t) =>
          (!project || t.projectId === project) &&
          `${t.title} ${t.projectName} ${t.teamName}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
      ),
    }));
  const total = visible.reduce((n, g) => n + g.tasks.length, 0);
  const displayed = visible.map((g, index) => ({
    ...g,
    tasks: g.tasks.slice(
      0,
      Math.max(
        0,
        limit -
          visible
            .slice(0, index)
            .reduce((n, earlier) => n + earlier.tasks.length, 0),
      ),
    ),
  }));
  const reset = () => {
    setFilter("all");
    setQuery("");
    setProject("");
    setLimit(8);
  };
  return (
    <>
      <div
        className="workspace-filters"
        role="group"
        aria-label="按截止时间筛选任务"
      >
        {filterLabels.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => {
              setFilter(f.key);
              setLimit(8);
            }}
          >
            {f.label}
            <span>
              {f.key === "all"
                ? all.length
                : (groups.find((g) => g.key === f.key)?.tasks.length ?? 0)}
            </span>
          </button>
        ))}
      </div>
      <div className="flex gap-2 border-b border-line px-5 pb-4">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="absolute left-3 top-2.5 size-4 text-ink-soft"
          />
          <input
            className="ac-field pl-9!"
            aria-label="搜索我的任务"
            placeholder="搜索任务、项目或团队…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(8);
            }}
          />
        </div>
        <select
          className="ac-field w-36!"
          aria-label="按项目筛选任务"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setLimit(8);
          }}
        >
          <option value="">所有项目</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div
        className="px-5 py-3 text-xs text-ink-soft"
        role="status"
        aria-live="polite"
      >
        显示 {Math.min(total, limit)} / {total} 项
        {(query || project || filter !== "all") && (
          <button
            onClick={reset}
            type="button"
            className="ml-3 inline-flex items-center gap-1 text-primary hover:underline"
          >
            <X aria-hidden className="size-3" />
            清除筛选
          </button>
        )}
      </div>
      {!all.length ? (
        <div className="workspace-empty">
          <ListTodo aria-hidden className="size-8 text-primary/60" />
          <h3>暂无待处理任务</h3>
          <p>
            已完成的任务保留在项目看板中。可以查看项目，或加入团队开始协作。
          </p>
          <Link href="/teams" className="ac-btn-ghost">
            创建或加入团队 <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        </div>
      ) : total === 0 ? (
        <div className="workspace-empty">
          <Search aria-hidden className="size-7 text-primary/60" />
          <h3>没有符合筛选的任务</h3>
          <p>试试其他截止时间、项目或关键词。</p>
          <button type="button" className="ac-btn-ghost" onClick={reset}>
            查看全部任务
          </button>
        </div>
      ) : (
        <div className="px-5 pb-4">
          {displayed
            .filter((g) => g.tasks.length)
            .map((g) => (
              <div key={g.key} className="mb-3 last:mb-0">
                <h3
                  className={`workspace-group-title ${g.key === "overdue" ? "text-high" : "text-ink-soft"}`}
                >
                  <span
                    className={`workspace-dot ${g.key === "overdue" ? "bg-high" : g.key === "today" ? "bg-accent" : "bg-primary"}`}
                  />
                  {g.label}
                  <span className="ml-auto text-ink-soft">
                    {visible.find((v) => v.key === g.key)?.tasks.length}
                  </span>
                </h3>
                <ul className="divide-y divide-line">
                  {g.tasks.map((t) => (
                    <li key={t.id}>
                      <TaskLink
                        href={`/projects/${t.projectId}?task=${t.id}`}
                        className="workspace-task group"
                      >
                        <span
                          aria-hidden
                          className={`workspace-task-mark ${t.status === "doing" ? "is-doing" : ""}`}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-medium text-ink group-hover:text-primary">
                            {t.title}
                          </span>
                          <span className="mt-1 block text-xs text-ink-soft">
                            {t.projectName} · {t.teamName}
                          </span>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <span
                            className={`text-xs ${g.key === "overdue" ? "text-high" : "text-ink-soft"}`}
                          >
                            {t.dueDate ?? "未设置截止日期"}
                          </span>
                          <span
                            className={`workspace-status ${t.status === "doing" ? "text-primary" : "text-ink-soft"}`}
                          >
                            {t.priority === "high" && (
                              <span className="mr-1.5 text-high">
                                高优先级 ·
                              </span>
                            )}
                            {statusLabels[t.status] ?? t.status}
                          </span>
                        </div>
                        <ArrowUpRight
                          aria-hidden
                          className="size-4 shrink-0 text-primary/50"
                        />
                      </TaskLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
      {total > limit && (
        <div className="border-t border-line p-3 text-center">
          <button
            className="ac-btn-ghost"
            type="button"
            onClick={() => setLimit((n) => n + 8)}
          >
            再显示 8 项 · 还有 {total - limit} 项
          </button>
        </div>
      )}
    </>
  );
}
