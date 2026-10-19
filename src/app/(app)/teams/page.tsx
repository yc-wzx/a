export const metadata = { title: "我的团队 · AgileCampus" };
import { eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projects, teamMembers, teams } from "@/db/schema";
import { TeamDirectory } from "@/components/team-directory";
import { TeamForms } from "./team-forms";

export default async function TeamsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const myTeams = await db.select({
    id: teams.id, name: teams.name, inviteCode: teams.inviteCode, role: teamMembers.role,
    memberCount: sql<number>`(select count(*)::int from ${teamMembers} where ${teamMembers.teamId} = ${teams.id})`,
    projectCount: sql<number>`(select count(*)::int from ${projects} where ${projects.teamId} = ${teams.id})`,
    activeCount: sql<number>`(select count(*)::int from ${projects} where ${projects.teamId} = ${teams.id} and ${projects.status} = 'active')`,
  }).from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id)).where(eq(teamMembers.userId, session.user.id)).orderBy(teams.name);
  return <TeamDirectory teams={myTeams}><TeamForms /></TeamDirectory>;
}
