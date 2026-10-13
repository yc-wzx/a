"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowRight, Check, Copy, FolderKanban, GraduationCap, Search, ShieldCheck, Users } from "lucide-react";
import { DirectorySummary } from "./directory-summary";

export type TeamDirectoryItem = { id: string; name: string; inviteCode: string; role: string; memberCount: number; projectCount: number; activeCount: number };
const roles: Record<string, string> = { admin: "管理员", teacher: "指导教师", student: "成员" };
function Invitation({ code }: { code: string }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState("");
  return <div className="flex items-center justify-between gap-2 rounded-field border border-line bg-canvas px-3 py-2 text-xs">
    <span className="text-ink-soft">邀请码 <code className="ml-2 select-all text-ink">{code}</code></span>
    <button className="inline-flex items-center gap-1 text-primary" aria-label="复制邀请码" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); setError(""); setTimeout(() => setCopied(false), 2000); } catch { setError("请选中邀请码后手动复制"); } }}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "已复制" : "复制"}</button>
    {error && <span role="status">{error}</span>}
  </div>;
}
export function TeamDirectory({ teams, children }: { teams: TeamDirectoryItem[]; children: ReactNode }) {
  const [query, setQuery] = useState(""), [role, setRole] = useState("all");
  const filtered = teams.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase()) && (role === "all" || t.role === role));
  return <main className="space-y-6 py-6" data-team-directory>
    <header className="flex items-start justify-between gap-6"><div><p className="mb-2 text-sm text-primary">团队协作</p><h1 className="font-display text-3xl font-semibold">我的团队</h1><p className="mt-2 text-sm text-ink-soft">管理协作关系、进入团队项目，邀请成员共同推进课程工作。</p></div><a href="#team-actions" className="ac-btn">创建或加入团队<ArrowRight size={15} /></a></header>
    <DirectorySummary items={[
      { label: "已加入团队", value: teams.length, detail: "当前账号的协作空间", icon: Users },
      { label: "参与项目", value: teams.reduce((n, t) => n + t.projectCount, 0), detail: "各团队项目合计，含归档项目", icon: FolderKanban },
      { label: "管理的团队", value: teams.filter(t => t.role === "admin").length, detail: "可以管理成员角色与项目", icon: ShieldCheck },
    ]} />
    <div className="grid grid-cols-[minmax(0,1fr)_320px] items-start gap-6">
      <section className="space-y-4" aria-label="团队列表">
        <div className="ac-card flex items-center gap-3 p-3"><label className="flex flex-1 items-center gap-2 px-2"><Search size={17} className="text-ink-faint" /><input aria-label="搜索团队" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索团队名称" className="w-full bg-transparent py-2 text-sm outline-none" /></label><select aria-label="我的团队角色" className="rounded-field border border-line bg-canvas px-3 py-2 text-sm" value={role} onChange={e => setRole(e.target.value)}><option value="all">全部角色</option>{Object.entries(roles).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></div>
        <p role="status" className="text-xs text-ink-soft">显示 {filtered.length} 个团队</p>
        {filtered.length ? <ul className="space-y-4">{filtered.map(t => <li key={t.id} className="ac-card p-5">
          <div className="flex items-start gap-3"><span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-lg font-semibold text-primary">{t.name.slice(0, 1)}</span><div className="min-w-0 flex-1"><Link href={`/teams/${t.id}/projects`} className="block truncate font-display text-lg font-semibold hover:text-primary">{t.name}</Link><span className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-soft">{t.role === "teacher" ? <GraduationCap size={13} /> : <ShieldCheck size={13} />}{roles[t.role]}</span></div><Link aria-label={`进入${t.name}项目`} href={`/teams/${t.id}/projects`} className="ac-btn-ghost text-xs">进入项目<ArrowRight size={14} /></Link></div>
          <div className="my-4 flex items-center gap-6 text-sm"><span><strong className="font-semibold">{t.memberCount}</strong> <span className="text-ink-soft">位成员</span></span><span><strong className="font-semibold">{t.projectCount}</strong> <span className="text-ink-soft">个项目</span></span><span className="text-xs text-ink-faint">{t.activeCount} 个进行中</span></div>
          <Invitation code={t.inviteCode} />
          <div className="mt-4 flex flex-wrap gap-4 border-t border-line pt-3 text-sm text-ink-soft"><Link href={`/teams/${t.id}/members`} className="hover:text-primary">{t.role === "admin" ? "成员管理" : "团队成员"}</Link><Link prefetch={false} href={`/teams/${t.id}/availability`} className="hover:text-primary">忙碌日程</Link><Link href={`/teams/${t.id}/resources`} className="hover:text-primary">资源占用</Link><Link href={`/teams/${t.id}/labels`} className="hover:text-primary">任务标签</Link></div>
        </li>)}</ul> : <div className="ac-card p-10 text-center"><Users className="mx-auto text-ink-faint" size={34} /><h2 className="mt-4 font-medium">{teams.length ? "没有符合条件的团队" : "尚未加入团队"}</h2><p className="mt-2 text-sm text-ink-soft">{teams.length ? "调整关键词或角色筛选后查看。" : "填写邀请码加入团队，或创建自己的课程团队。"}</p>{teams.length > 0 && <button onClick={() => { setQuery(""); setRole("all"); }} className="ac-btn-ghost mt-4">清除筛选</button>}</div>}
      </section>
      <aside id="team-actions" className="scroll-mt-24 space-y-4">{children}<div className="rounded-xl border border-line bg-primary-soft p-4 text-sm"><h2 className="font-medium">协作权限</h2><p className="mt-2 leading-6 text-ink-soft">加入后默认是成员。管理员设置指导教师角色、创建项目及管理成员；项目负责人是分工职责，不自动改变团队权限。</p><Link href="/help#roles" className="mt-3 inline-flex items-center gap-1 text-primary">查看角色操作说明<ArrowRight size={13} /></Link></div></aside>
    </div>
  </main>;
}
