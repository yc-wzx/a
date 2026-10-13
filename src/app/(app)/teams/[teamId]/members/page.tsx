import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Search, Users } from "lucide-react";
import { auth } from "@/lib/auth";
import { getTeamMemberDirectory } from "@/lib/member-profile";
import { ForbiddenError } from "@/lib/errors";
import { TEAM_ROLE_NAMES } from "@/contracts/member-profile";
import { MemberAvatar } from "@/components/people/member-avatar";
import { updateRoleAction } from "./actions";

export default async function MembersPage({ params, searchParams }: {
  params: Promise<{ teamId: string }>; searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const { teamId } = await params, sp = await searchParams;
  let data;
  try { data = await getTeamMemberDirectory(session.user.id, teamId); }
  catch (error) { if (error instanceof ForbiddenError) notFound(); throw error; }
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const role = typeof sp.role === "string" && sp.role in TEAM_ROLE_NAMES ? sp.role : "all";
  const filtered = data.members.filter(member => (role === "all" || member.role === role)
    && (!q || `${member.name} ${member.skills.join(" ")}`.toLocaleLowerCase().includes(q.toLocaleLowerCase())));
  return <main className="space-y-6 py-6" data-team-members>
    <header className="space-y-3"><Link href="/teams" className="text-sm text-ink-soft hover:text-primary">← 我的团队</Link><div className="flex items-end justify-between"><div><p className="mb-2 text-sm text-primary">{data.team.name}</p><h1 className="font-display text-3xl font-semibold">团队成员</h1><p className="mt-3 text-sm text-ink-soft">了解成员的分工方向，进入个人主页查看项目、任务和成果。</p></div><span className="flex items-center gap-2 text-sm text-ink-soft"><Users size={18} />{data.members.length} 位成员</span></div></header>
    <form method="get" className="ac-card flex items-end gap-4 p-4"><label className="flex-1 text-sm">搜索成员或技能<div className="relative mt-2"><Search size={16} className="absolute left-3 top-3 text-ink-faint" /><input name="q" aria-label="搜索成员或技能" defaultValue={q} maxLength={80} className="ac-field pl-10" placeholder="姓名、前端开发、交互设计…" /></div></label><label className="w-44 text-sm">团队角色<select name="role" className="ac-field mt-2" defaultValue={role}><option value="all">全部角色</option>{Object.entries(TEAM_ROLE_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="ac-btn">筛选成员</button>{(q || role !== "all") && <Link href={`/teams/${teamId}/members`} className="ac-btn-ghost">清除</Link>}</form>
    <div className="grid grid-cols-3 gap-5">{filtered.map(member => <article key={member.id} className="ac-card flex flex-col p-5" data-member-card>
      <Link href={`/people/${member.id}?team=${teamId}`} className="flex items-center gap-3 hover:text-primary"><MemberAvatar name={member.name} color={member.avatarColor} label={member.avatarLabel} /><div className="min-w-0"><h2 className="truncate font-semibold">{member.name}</h2><p className="mt-1 text-xs text-ink-soft">{TEAM_ROLE_NAMES[member.role]}{member.id === session.user.id ? " · 我" : ""}</p></div></Link>
      <p className="mt-4 line-clamp-3 min-h-16 break-words text-sm leading-6 text-ink-soft">{member.bio || "尚未填写个人简介。可进入主页查看已记录的任务与成果。"}</p>
      <div className="mb-5 mt-3 flex flex-wrap gap-2">{member.skills.slice(0, 4).map(skill => <span key={skill} className="rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-soft">{skill}</span>)}</div>
      <div className="mt-auto space-y-3 border-t border-line pt-4"><Link href={`/people/${member.id}?team=${teamId}`} className="flex items-center justify-between text-sm text-primary">查看个人主页<ArrowRight size={15} /></Link>
        {data.role === "admin" && member.id !== session.user.id && <form action={updateRoleAction} className="flex items-center gap-2"><input type="hidden" name="teamId" value={teamId} /><input type="hidden" name="userId" value={member.id} /><select key={member.role} name="role" defaultValue={member.role} aria-label={`${member.name}的团队角色`} className="ac-field flex-1 py-1.5 text-xs">{Object.entries(TEAM_ROLE_NAMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="ac-btn-ghost px-2 py-1.5 text-xs">保存角色</button></form>}
      </div>
    </article>)}</div>
    {!filtered.length && <div className="ac-card py-14 text-center text-sm text-ink-soft">没有找到匹配成员，请调整姓名、技能或角色筛选。</div>}
  </main>;
}
