"use client";

import { useEffect, useRef } from "react";
import { ArrowUpRight, ListTodo, X } from "lucide-react";
import { TaskLink } from "@/components/tasks/task-link";
import { DashboardTaskList } from "./task-list";
import type { TaskGroup } from "@/lib/dashboard";

export function RecentTasks({ groups, error }: { groups: TaskGroup[] | null; error?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const tasks = groups?.flatMap(group => group.tasks);
  useEffect(() => {
    const close = () => dialog.current?.close();
    window.addEventListener("agilecampus:before-task-change", close);
    return () => window.removeEventListener("agilecampus:before-task-change", close);
  }, []);
  return <section id="tasks" className="workspace-panel workspace-recent scroll-mt-24" data-tour="workspace-tasks">
    <div className="workspace-section-heading"><h2>近期任务</h2><ListTodo size={16} aria-hidden className="text-ink-soft" /></div>
    {error ? <p role="status" className="workspace-brief-empty">{error}</p> : !tasks?.length ? <p className="workspace-brief-empty">暂无分配给你的待办任务。</p> : <ul className="workspace-recent-list">{tasks.slice(0, 3).map(task => <li key={task.id}>
      <TaskLink href={`/projects/${task.projectId}?task=${task.id}`} className="workspace-recent-link">
        <span className={`workspace-task-mark ${task.status === "doing" ? "is-doing" : ""}`} aria-hidden />
        <span className="min-w-0"><strong>{task.title}</strong><span className="workspace-recent-project">{task.projectName}</span><span className="workspace-recent-meta"><span>{task.status === "doing" ? "进行中" : task.status === "review" ? "待检查" : "待办"}</span><span>{task.dueDate ? `${task.dueDate.slice(5)} 截止` : "未定截止日期"}</span></span></span>
        <ArrowUpRight size={14} aria-hidden className="text-ink-soft" />
      </TaskLink>
    </li>)}</ul>}
    {groups && <button type="button" className="workspace-all-tasks" onClick={() => dialog.current?.showModal()}>全部任务{tasks?.length ? ` · ${tasks.length}` : ""}<ArrowUpRight size={14} aria-hidden /></button>}
    <dialog ref={dialog} className="workspace-task-dialog" aria-labelledby="workspace-task-dialog-title" onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="workspace-task-dialog-surface"><header className="workspace-section-heading"><div><h2 id="workspace-task-dialog-title">我的工作 · 任务列表</h2><p className="mt-2 text-xs text-ink-soft">按截止时间排列，包含指派给你的子任务。</p></div><button type="button" className="workspace-icon-button" aria-label="关闭任务列表" onClick={() => dialog.current?.close()}><X size={18} /></button></header>{groups && <DashboardTaskList groups={groups} />}</div>
    </dialog>
  </section>;
}
