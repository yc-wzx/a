export const metadata = { title: "我的团队 · AgileCampus" };
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, teamMembers, teams } from "@/db/schema";
import { TeamDirectory } from "@/components/team-directory";
import { TeamForms } from "./team-forms";
import { listMyTeamJoinRequests } from "@/lib/team-management";
import { displayDateTime } from "@/lib/display-time";
import { teamManagementSettings } from "@/db/team-management-schema";

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const myTeams = await db.select({
    id: teams.id, name: teams.name, inviteCode: teams.inviteCode, role: teamMembers.role,
    memberCount: sql<number>`(select count(*)::int from ${teamMembers} where ${teamMembers.teamId} = ${teams.id})`,
    projectCount: sql<number>`(select count(*)::int from ${projects} where ${projects.teamId} = ${teams.id})`,
    activeCount: sql<number>`(select count(*)::int from ${projects} where ${projects.teamId} = ${teams.id} and ${projects.status} = 'active')`,
    archivedAt: teamManagementSettings.archivedAt,
    inviteEnabled: teamManagementSettings.inviteEnabled,
    inviteExpired: sql<boolean>`coalesce(${teamManagementSettings.inviteExpiresAt} <= now(), false)`,
  }).from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id)).leftJoin(teamManagementSettings, eq(teamManagementSettings.teamId, teams.id)).where(eq(teamMembers.userId, session.user.id)).orderBy(teams.name);
  const requests = await listMyTeamJoinRequests(session.user.id);
  const requestNames = { pending: "等待管理员审核", approved: "已同意加入", rejected: "未通过，可获取邀请码后重新申请" };
  return <TeamDirectory teams={myTeams.map(t => ({ ...t, archivedAt: t.archivedAt?.toISOString() ?? null }))}><TeamForms />{requests.length > 0 && <section className="ac-card space-y-3 p-5"><h2 className="font-semibold">我的加入申请</h2>{requests.map(r => <div key={r.id} className="border-t border-line pt-3"><p className="text-sm font-medium">{r.teamName}</p><p className="mt-1 text-xs text-ink-soft">{requestNames[r.status]}</p><p className="mt-1 text-xs text-ink-faint">{displayDateTime(r.createdAt)}</p></div>)}</section>}</TeamDirectory>;
}
