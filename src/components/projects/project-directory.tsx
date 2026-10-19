"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, FileText, FolderKanban, Search, Users } from "lucide-react";
import { DirectorySummary } from "@/components/directory-summary";

export type ProjectDirectoryItem = {
  id: string; name: string; status: string; teamId: string; teamName: string;
  description: string | null; startDate: string | null; endDate: string | null;
  taskTotal: number; doneCount: number; doingCount: number;
};
export function ProjectDirectory({ projects }: { projects: ProjectDirectoryItem[] }) {
  const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [team, setTeam] = useState("all"), [sort, setSort] = useState("recent");
  const active = projects.filter(p => p.status === "active").length;
  const done = projects.reduce((n, p) => n + p.doneCount, 0), total = projects.reduce((n, p) => n + p.taskTotal, 0);
  const teams = [...new Map(projects.map(p => [p.teamId, p.teamName])).entries()];
  const filtered = projects.filter(p => (status === "all" || p.status === status) && (team === "all" || p.teamId === team) && `${p.name} ${p.teamName} ${p.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  if (sort === "name") filtered.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  if (sort === "deadline") filtered.sort((a, b) => (a.endDate ?? "9999").localeCompare(b.endDate ?? "9999"));
  const reset = () => { setQuery(""); setStatus("all"); setTeam("all"); setSort("recent"); };
  return <main className="space-y-6 py-6" data-project-directory>
    <header className="flex items-start justify-between gap-6">
      <div><p className="mb-2 text-sm text-primary">课程协作</p><h1 className="font-display text-3xl font-semibold">所有项目</h1><p className="mt-2 text-sm text-ink-soft">集中查看各团队项目，继续任务、整理文档与提交成果。</p></div>
      <div className="flex shrink-0 gap-2"><Link className="ac-btn" href="/projects/new">创建项目</Link><Link className="ac-btn-ghost" href="/teams"><Users size={16} />团队管理</Link></div>
    </header>
    <DirectorySummary items={[
      { label: "参与项目", value: projects.length, icon: FolderKanban, detail: "当前账号可访问的项目" },
      { label: "进行中项目", value: active, icon: CalendarDays, detail: `已归档 ${projects.length - active} 个` },
      { label: "已完成任务", value: `${done} / ${total}`, icon: CheckCircle2, detail: "包含子任务，成果验收另行记录" },
    ]} />
    <section className="ac-card p-4" aria-label="项目筛选">
      <div className="flex items-center gap-4">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-field border border-line bg-canvas px-3"><Search size={17} className="text-ink-faint" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索项目、团队或描述" aria-label="搜索项目" className="w-full bg-transparent py-2.5 text-sm outline-none" /></label>
        <label className="text-sm text-ink-soft">团队<select aria-label="项目所属团队" className="ml-2 rounded-field border border-line bg-surface px-3 py-2" value={team} onChange={e => setTeam(e.target.value)}><option value="all">全部团队</option>{teams.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-sm text-ink-soft">排序<select aria-label="项目排序" className="ml-2 rounded-field border border-line bg-surface px-3 py-2" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近创建</option><option value="deadline">结束日期</option><option value="name">项目名称</option></select></label>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
        <div className="flex gap-1" aria-label="项目状态">{[["all", "全部"], ["active", "进行中"], ["archived", "已归档"]].map(([id, label]) => <button key={id} aria-pressed={status === id} onClick={() => setStatus(id)} className={`rounded-field px-4 py-2 text-sm ${status === id ? "bg-primary-soft font-medium text-primary" : "text-ink-soft hover:bg-canvas"}`}>{label}</button>)}</div>
        <span className="text-xs text-ink-soft">显示 {filtered.length} 个项目</span>
      </div>
    </section>
    {filtered.length ? <ul className="grid grid-cols-2 gap-5">{filtered.map(p => {
      const percent = p.taskTotal ? Math.round(p.doneCount / p.taskTotal * 100) : 0;
      return <li key={p.id} className="ac-card flex flex-col overflow-hidden transition-shadow hover:shadow-pop">
        <div className="flex-1 p-5">
          <div className="flex items-start justify-between gap-3"><span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-lg font-semibold text-primary">{p.name.slice(0, 1)}</span><span className={`ac-badge ${p.status === "archived" ? "bg-sunken text-ink-soft" : "bg-done/12 text-done"}`}>{p.status === "archived" ? "已归档" : "进行中"}</span></div>
          <Link href={`/projects/${p.id}/overview`} className="mt-4 block truncate font-display text-lg font-semibold hover:text-primary">{p.name}</Link>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-soft"><Users size={13} />{p.teamName}</p>
          <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-ink-soft">{p.description || "尚未填写项目说明，团队管理员可在项目设置中完善。"}</p>
          <div className="mt-5 flex justify-between text-xs"><span className="text-ink-soft">任务完成 {p.doneCount} / {p.taskTotal}</span><span className="tabular-nums text-primary">{p.taskTotal ? `${percent}%` : "暂无任务"}</span></div>
          <div role="progressbar" aria-label={`${p.name}任务完成进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken"><div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} /></div>
          <div className="mt-3 flex items-center justify-between text-xs text-ink-faint"><span>进行中任务 {p.doingCount}</span><span className="inline-flex items-center gap-1"><CalendarDays size={12} />{p.endDate ? `结束 ${p.endDate}` : "未设置结束日期"}</span></div>
        </div>
        <div className="flex items-center gap-4 border-t border-line bg-canvas/50 px-5 py-3 text-sm">
          <Link href={`/projects/${p.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><FolderKanban size={14} />任务</Link>
          <Link href={`/projects/${p.id}/documents`} className="inline-flex items-center gap-1 text-ink-soft hover:text-primary"><FileText size={14} />文档</Link>
          <Link href={`/projects/${p.id}/deliverables`} className="text-ink-soft hover:text-primary">成果</Link>
          <Link aria-label={`查看${p.name}概览`} href={`/projects/${p.id}/overview`} className="ml-auto text-ink-soft hover:text-primary"><ArrowRight size={16} /></Link>
        </div>
      </li>;
    })}</ul> : <section className="ac-card p-12 text-center"><FolderKanban size={36} className="mx-auto text-ink-faint" /><h2 className="mt-4 font-semibold">{projects.length ? "没有符合条件的项目" : "尚未参与项目"}</h2><p className="mt-2 text-sm text-ink-soft">{projects.length ? "调整关键词、团队或状态后重新查看。" : "加入团队后，由团队管理员创建课程项目。"}</p><div className="mt-5 flex justify-center">{projects.length ? <button className="ac-btn-ghost" onClick={reset}>清除筛选</button> : <Link href="/teams" className="ac-btn">前往团队</Link>}</div></section>}
  </main>;
}
