import { randomUUID } from "node:crypto";
import { TaskLink as Link } from "@/components/tasks/task-link";
import { redirect } from "next/navigation";
import { Bell, CheckCircle2, Clock3, FileCheck2, FolderKanban, MessageSquare } from "lucide-react";
import { auth } from "@/lib/auth";
import { getUnreadNotificationCount, listMyNotifications } from "@/lib/notifications";
import { notificationFilters } from "@/lib/notification-access";
import { listMyProjects } from "@/lib/project";
import { displayDateTime } from "@/lib/display-time";
import { DirectorySummary } from "@/components/directory-summary";
import type { NotificationItem } from "@/contracts/p0-p2";
import { ReadControl } from "./read-controls";

function category(type: string) {
  if (type.startsWith("deliverable.") || type.startsWith("feedback.")) return { icon: FileCheck2, label: "成果与反馈", color: "bg-accent-soft text-accent" };
  if (type.startsWith("comment.")) return { icon: MessageSquare, label: "讨论与提及", color: "bg-primary-soft text-primary" };
  if (type.includes("overdue") || type.includes("due_soon") || type.includes("blocked")) return { icon: Clock3, label: "任务提醒", color: "bg-high-soft text-high" };
  return { icon: Bell, label: "项目动态", color: "bg-primary-soft text-primary" };
}
export default async function Page({ searchParams }: {
  searchParams: Promise<{ offset?: string; unreadOnly?: string; projectId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const query = await searchParams;
  const filters = notificationFilters(new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== "") as [string, string][]));
  const [{ asOf, count }, page, projects] = await Promise.all([
    getUnreadNotificationCount(session.user.id), listMyNotifications(session.user.id, filters), listMyProjects(session.user.id),
  ]);
  const names = new Map(projects.map(p => [p.id, p.name]));
  const href = (offset: number, unreadOnly = filters.unreadOnly) => {
    const params = new URLSearchParams({ offset: String(offset) });
    if (unreadOnly) params.set("unreadOnly", "true");
    if (filters.projectId) params.set("projectId", filters.projectId);
    return `/notifications?${params}`;
  };
  const groups = page.items.reduce<Record<string, NotificationItem[]>>((all, item) => {
    const day = displayDateTime(item.createdAt).split(" ")[0];
    (all[day] ??= []).push(item); return all;
  }, {});
  return <main className="space-y-6 py-6 [overflow-wrap:anywhere]" data-notification-center>
    <header className="flex items-start justify-between gap-6"><div><p className="mb-2 text-sm text-primary">协作消息</p><h1 className="font-display text-3xl font-semibold">通知</h1><p className="mt-2 text-sm text-ink-soft">查看任务变化、教师反馈和讨论消息，直接返回相关工作。</p></div><ReadControl key={`${asOf}:${filters.projectId ?? "all"}`} requestId={randomUUID()} beforeCreatedAt={asOf} projectId={filters.projectId} label={filters.projectId ? "本项目全部已读" : "全部已读"} /></header>
    <DirectorySummary items={[
      { label: "所有项目未读", value: count, detail: "当前账号可见的未读消息", icon: Bell },
      { label: "当前筛选结果", value: page.total, detail: filters.projectId ? names.get(filters.projectId) ?? "所选项目" : "全部项目", icon: FolderKanban },
      { label: "本页消息", value: page.items.length, detail: "按发生时间从新到旧排列", icon: CheckCircle2 },
    ]} />
    <div className="grid grid-cols-[minmax(0,1fr)_260px] items-start gap-6">
      <section className="space-y-5" aria-label="通知列表">
        <div className="ac-card flex items-center justify-between gap-3 p-3">
          <nav className="flex gap-1" aria-label="通知状态"><Link href={href(0, false)} aria-current={!filters.unreadOnly ? "page" : undefined} className={`rounded-field px-4 py-2 text-sm ${!filters.unreadOnly ? "bg-primary-soft text-primary" : "text-ink-soft"}`}>查看全部</Link><Link href={href(0, true)} aria-current={filters.unreadOnly ? "page" : undefined} className={`rounded-field px-4 py-2 text-sm ${filters.unreadOnly ? "bg-primary-soft text-primary" : "text-ink-soft"}`}>只看未读</Link></nav>
          <form action="/notifications" method="get" className="flex items-center gap-2">{filters.unreadOnly && <input type="hidden" name="unreadOnly" value="true" />}<select aria-label="通知项目范围" name="projectId" defaultValue={filters.projectId ?? ""} className="max-w-48 rounded-field border border-line bg-canvas px-3 py-2 text-sm"><option value="">全部项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="ac-btn-ghost text-xs">应用筛选</button></form>
        </div>
        {page.items.length === 0 ? <div className="ac-card p-12 text-center"><Bell size={36} className="mx-auto text-ink-faint" /><h2 className="mt-4 font-semibold">{filters.unreadOnly ? "没有未读通知" : "暂无通知"}</h2><p className="mt-2 text-sm text-ink-soft">{filters.unreadOnly ? "可以切换到全部消息查看已读记录。" : "任务指派、成果反馈、提及和项目公告会出现在这里。"}</p><Link href="/dashboard" className="ac-btn-ghost mt-5">返回工作台</Link></div> : Object.entries(groups).map(([day, items]) => <section key={day} className="space-y-3"><h2 className="flex items-center gap-3 text-xs font-medium text-ink-soft"><span>{day}</span><span className="h-px flex-1 bg-line" /></h2><ul className="space-y-3">{items.map(item => {
          const { icon: Icon, label, color } = category(item.type);
          return <li key={item.id} data-notification-id={item.id} className={`ac-card flex items-start gap-4 p-5 ${!item.readAt ? "border-l-4 border-l-primary" : ""}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${color}`} aria-hidden><Icon size={18} /></span>
            <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{item.title}</h3><span className={`ac-badge shrink-0 ${item.readAt ? "bg-sunken text-ink-soft" : "bg-primary-soft text-primary"}`}>{item.readAt ? "已读" : "未读"}</span></div><p className="mt-1 text-xs text-ink-faint">{names.get(item.projectId) ?? "项目消息"} · {label}</p><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{item.summary}</p><div className="mt-4 flex flex-wrap items-center gap-3">{item.sourceRef.sourceHref ? <Link href={item.sourceRef.sourceHref} className="text-sm font-medium text-primary hover:underline">查看来源</Link> : <span className="text-xs text-ink-faint">{item.sourceRef.availability === "deleted" ? "来源已删除，通知记录保留" : "来源暂时不可用"}</span>}{!item.readAt && <ReadControl id={item.id} />}<time className="ml-auto text-xs text-ink-faint" dateTime={item.createdAt}>{displayDateTime(item.createdAt)}</time></div></div>
          </li>;
        })}</ul></section>)}
        <nav aria-label="通知分页" className="flex items-center justify-between text-sm"><span className="text-ink-soft">共 {page.total} 条 · 第 {Math.floor(page.offset / page.limit) + 1} 页</span><div className="flex gap-3">{page.offset > 0 && <Link className="ac-btn-ghost" href={href(Math.max(0, page.offset - page.limit))}>上一页</Link>}{page.nextOffset !== null && <Link className="ac-btn-ghost" href={href(page.nextOffset)}>下一页</Link>}</div></nav>
      </section>
      <aside className="ac-card space-y-4 p-5"><h2 className="font-semibold">处理通知</h2><p className="text-sm leading-6 text-ink-soft">通过「查看来源」打开任务、成果或讨论。先处理需要修改的成果与临近截止的任务。</p><div className="border-t border-line pt-4 text-xs leading-5 text-ink-soft">标记已读仅整理消息状态，不会完成任务或改变成果验收结果。</div><Link href="/settings" className="block text-sm text-primary hover:underline">管理通知渠道</Link><Link href="/help#notifications" className="block text-sm text-primary hover:underline">查看操作说明</Link></aside>
    </div>
  </main>;
}
