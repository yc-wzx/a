import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import { getTeamManagement } from "@/lib/team-management";
import { displayDateTime } from "@/lib/display-time";
import { InvitationSettings, JoinRequestControls, TeamDangerZone } from "./settings-controls";
export const metadata = { title: "团队设置 · AgileCampus" };
export default async function TeamSettingsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const session = await auth(); if (!session?.user?.id) redirect("/login");
  const { teamId } = await params;
  let data; try { data = await getTeamManagement(session.user.id, teamId); } catch (e) { if (e instanceof ForbiddenError) notFound(); throw e; }
  const archived = !!data.settings.archivedAt, pending = data.requests.filter(r => r.status === "pending");
  return <main className="mx-auto max-w-4xl space-y-6 py-6"><header><Link href="/teams" className="text-sm text-ink-soft">← 我的团队</Link><h1 className="mt-3 font-display text-3xl font-semibold">{data.team.name} · 团队设置</h1><p className="mt-2 text-sm text-ink-soft">{archived ? "团队已归档" : "管理邀请码、加入审核和团队生命周期"}</p></header>
    <InvitationSettings teamId={teamId} code={data.team.inviteCode} revision={data.settings.revision} enabled={data.settings.inviteEnabled} requireApproval={data.settings.requireApproval} expiresAt={data.settings.inviteExpiresAt?.toISOString() ?? null} archived={archived} />
    <section className="ac-card space-y-4 p-5"><div className="flex justify-between"><h2 className="font-semibold">待审核加入申请 · {pending.length}</h2><Link href={`/teams/${teamId}/members`} className="text-sm text-primary">查看团队成员</Link></div>{pending.length ? <ul className="divide-y divide-line">{pending.map(r => <li key={r.id} className="flex items-center justify-between py-3"><div><p className="font-medium">{r.name}</p><p className="mt-1 text-xs text-ink-soft">{displayDateTime(r.createdAt)}</p></div><JoinRequestControls teamId={teamId} requestId={r.id} archived={archived} /></li>)}</ul> : <p className="text-sm text-ink-soft">暂无待审核申请。</p>}</section>
    <TeamDangerZone key={`danger-${data.settings.revision}`} teamId={teamId} name={data.team.name} revision={data.settings.revision} archived={archived} />
  </main>;
}
