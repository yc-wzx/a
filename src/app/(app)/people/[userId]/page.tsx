import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, CheckCircle2, Clock3, FileText, ListTodo, Pencil, Users } from "lucide-react";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getMemberProfile } from "@/lib/member-profile";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { TEAM_ROLE_NAMES } from "@/contracts/member-profile";
import { MemberAvatar } from "@/components/people/member-avatar";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DELIVERABLE_LABELS } from "@/lib/deliverable-labels";

const filters = { all: "全部任务", todo: "待开始", doing: "进行中", done: "已完成", overdue: "逾期" };
const date = (iso: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
export default async function Page({ params, searchParams }: {
  params: Promise<{ userId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const { userId } = await params, sp = await searchParams;
  if (!z.uuid().safeParse(userId).success) notFound();
  const tab = typeof sp.tab === "string" && ["overview", "tasks", "deliverables"].includes(sp.tab) ? sp.tab : "overview";
  let data;
  try { data = await getMemberProfile(session.user.id, userId, {
    ...(sp.team !== undefined ? { teamId: String(sp.team) } : {}),
    ...(sp.filter !== undefined ? { filter: String(sp.filter) as keyof typeof filters } : {}),
    ...(sp.page !== undefined ? { page: Number(sp.page) } : {}),
  }); } catch (error) { if (error instanceof ForbiddenError || error instanceof ValidationError) notFound(); throw error; }
  const { person, stats } = data;
  const href = (values: { tab?: string; filter?: string; page?: number; team?: string } = {}) => {
    const query = new URLSearchParams({ tab: values.tab ?? tab });
    const team = values.team ?? data.selectedTeamId; if (team) query.set("team", team);
    if (values.filter) query.set("filter", values.filter); if (values.page) query.set("page", String(values.page));
    return `/people/${userId}?${query}`;
  };
  const taskItems = tab === "overview" ? data.tasks.items.slice(0, 5) : data.tasks.items;
  return <main className="space-y-6 py-6" data-member-profile>
    <div className="flex items-center justify-between text-sm text-ink-soft"><Link href="/teams" className="hover:text-primary">← 我的团队</Link><span className="flex items-center gap-2"><Users size={14} />共同团队可见</span></div>
    <header className="ac-card overflow-hidden" data-tour="member-introduction">
      <div className="h-3 bg-primary" />
      <div className="flex items-start justify-between gap-6 p-7"><div className="flex min-w-0 flex-1 items-start gap-6"><MemberAvatar name={person.name} color={person.avatarColor} label={person.avatarLabel} large /><div className="min-w-0 space-y-3"><div className="flex flex-wrap items-center gap-3"><h1 className="font-display text-3xl font-semibold [overflow-wrap:anywhere]">{person.name}</h1>{data.isSelf && <span className="ac-badge bg-primary-soft text-primary">我的主页</span>}</div><div className="flex flex-wrap gap-2">{data.teams.map(team => <Link key={team.id} href={`/teams/${team.id}/members`} className="ac-badge bg-sunken text-ink-soft">{team.name} · {TEAM_ROLE_NAMES[team.role]}</Link>)}</div><p className="max-w-2xl whitespace-pre-wrap break-words text-sm leading-6 text-ink-soft">{person.bio || "尚未填写个人简介。"}</p><div className="flex flex-wrap gap-2">{person.skills.map(skill => <span key={skill} className="rounded-full border border-line px-3 py-1 text-xs text-ink-soft">{skill}</span>)}</div></div></div>{data.isSelf && <Link href="/settings/profile" className="ac-btn-ghost shrink-0"><Pencil size={14} />编辑个人资料</Link>}</div>
    </header>
    <section className="grid grid-cols-4 gap-4" aria-label="个人工作概况">{[
      { label: "参与项目", value: stats.projects, icon: BriefcaseBusiness }, { label: "进行中任务", value: stats.doing, icon: Clock3 },
      { label: "已完成任务", value: stats.done, icon: CheckCircle2 }, { label: "已提交成果", value: stats.deliverables, icon: FileText },
    ].map(item => <div key={item.label} className="ac-card p-5"><div className="flex items-center justify-between text-sm text-ink-soft"><span>{item.label}</span><item.icon size={17} /></div><p className="mt-3 text-3xl font-semibold tabular-nums">{item.value}</p></div>)}</section>
    <div className="flex items-center justify-between border-b border-line" data-tour="member-tabs"><nav className="flex gap-6" aria-label="个人主页分区">{[["overview", "概览"], ["tasks", "任务"], ["deliverables", "成果"]].map(([key, label]) => <Link key={key} href={href({ tab: key })} aria-current={tab === key ? "page" : undefined} className={`border-b-2 px-1 py-3 text-sm ${tab === key ? "border-primary font-medium text-primary" : "border-transparent text-ink-soft hover:text-primary"}`}>{label}</Link>)}</nav><span className="text-xs text-ink-faint">任务数包含子任务，不代表投入时长或贡献评分。</span></div>
    {tab === "overview" && <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] items-start gap-6">
      <section className="ac-card space-y-4 p-6"><h2 className="flex items-center gap-2 font-semibold"><BriefcaseBusiness size={17} />参与项目</h2>{data.projects.length ? data.projects.map(project => <Link key={project.id} href={`/projects/${project.id}/overview`} className="block rounded-xl border border-line p-4 hover:border-primary/40"><div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words font-medium">{project.name}</h3><StatusBadge status={project.status} /></div><p className="mt-2 text-xs text-ink-soft">{project.isLeader ? "项目负责人" : TEAM_ROLE_NAMES[project.role]} · 本人任务 {project.tasks} 项 · 已完成 {project.done} 项</p><div className="mt-3 flex items-center justify-between text-xs text-ink-faint"><span>{project.startDate ?? "未设置开始日期"} — {project.endDate ?? "未设置结束日期"}</span><ArrowRight size={14} /></div></Link>) : <p className="py-5 text-sm text-ink-soft">暂无可查看的项目。加入团队后，项目与工作记录会显示在这里。</p>}</section>
      <section className="ac-card space-y-4 p-6"><h2 className="font-semibold">近期协作记录</h2><p className="text-xs leading-5 text-ink-soft">记录已发生的项目操作，最多显示最近 10 条。</p>{data.activity.length ? <ol className="max-h-80 space-y-5 overflow-y-auto pr-2">{data.activity.map(event => <li key={event.id} className="border-l-2 border-primary/20 pl-4"><p className="text-sm leading-5">{event.summary}</p><div className="mt-2 flex items-center justify-between gap-3 text-xs text-ink-faint"><Link href={`/projects/${event.projectId}/overview`} className="truncate hover:text-primary">{event.projectName}</Link><time dateTime={event.occurredAt} className="shrink-0">{date(event.occurredAt)}</time></div></li>)}</ol> : <p className="py-5 text-sm text-ink-soft">暂无可查看的协作记录。</p>}</section>
    </div>}
    {(tab === "overview" || tab === "tasks") && <section className="ac-card p-6" data-profile-tasks><div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><ListTodo size={17} />负责的任务</h2>{tab === "overview" && <Link href={href({ tab: "tasks" })} className="text-sm text-primary">查看全部 {stats.tasks} 项 →</Link>}</div>
      {tab === "tasks" && <nav aria-label="任务状态筛选" className="mb-5 flex flex-wrap gap-2">{Object.entries(filters).map(([key, label]) => <Link key={key} href={href({ filter: key })} aria-current={(typeof sp.filter === "string" ? sp.filter : "all") === key ? "page" : undefined} className={`rounded-field px-3 py-2 text-sm ${(sp.filter ?? "all") === key ? "bg-primary-soft font-medium text-primary" : "bg-sunken text-ink-soft"}`}>{label}{key === "overdue" ? ` ${stats.overdue}` : ""}</Link>)}</nav>}
      {taskItems.length ? <div className="divide-y divide-line">{taskItems.map(task => <Link key={task.id} href={`/projects/${task.projectId}?task=${task.id}`} className="flex items-center justify-between gap-5 py-4 hover:text-primary"><div className="min-w-0"><p className="truncate text-sm font-medium">{task.parentTaskId && <span className="mr-2 text-xs text-ink-faint">子任务</span>}{task.title}</p><p className="mt-1 text-xs text-ink-faint">{task.projectName}</p></div><div className="flex shrink-0 items-center gap-3 text-xs text-ink-soft">{task.isBlocked && <span className="text-high">阻塞</span>}<span>{task.dueDate ?? "未设截止日"}</span><StatusBadge status={task.status} /><ArrowRight size={14} /></div></Link>)}</div> : <p className="py-6 text-sm text-ink-soft">此范围暂无任务。</p>}
      {tab === "tasks" && <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-xs text-ink-soft"><span>共 {data.tasks.total} 项 · 第 {data.tasks.page} 页</span><div className="flex gap-4">{data.tasks.page > 1 && <Link href={href({ filter: String(sp.filter ?? "all"), page: data.tasks.page - 1 })}>上一页</Link>}{data.tasks.page * data.tasks.pageSize < data.tasks.total && <Link href={href({ filter: String(sp.filter ?? "all"), page: data.tasks.page + 1 })}>下一页</Link>}</div></div>}
    </section>}
    {tab === "deliverables" && <section className="ac-card space-y-4 p-6"><div><h2 className="font-semibold">提交的成果</h2><p className="mt-2 text-xs text-ink-soft">展示已正式提交的材料与审核状态，最近 20 项；草稿在各项目成果页维护。</p></div>{data.deliverables.length ? <div className="grid grid-cols-2 gap-4">{data.deliverables.map(material => <Link key={material.id} href={`/projects/${material.projectId}/deliverables/${material.id}`} className="rounded-xl border border-line p-5 hover:border-primary/40"><div className="flex items-center justify-between"><span className="text-xs text-primary">{DELIVERABLE_LABELS[material.type]} · V{material.version}</span><StatusBadge status={material.status} /></div><h3 className="mt-3 break-words font-medium">{material.title}</h3><p className="mt-2 text-xs text-ink-soft">{material.projectName}</p><p className="mt-4 text-xs text-ink-faint">{material.submittedAt ? date(material.submittedAt) : "未记录提交时间"}</p></Link>)}</div> : <p className="py-8 text-sm text-ink-soft">暂无可查看的正式成果。</p>}</section>}
    <p className="text-xs leading-5 text-ink-faint">此页按共同团队汇总可见项目中的工作；个人课表、私有文档和 AI 会话由各自的访问权限管理。</p>
  </main>;
}
