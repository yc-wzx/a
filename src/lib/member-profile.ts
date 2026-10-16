import { assignedTo } from "./task-assignees";
import { and, asc, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "@/db";
import { users, userProfiles, teamMembers, teams, projects, tasks, deliverables, deliverableVersions, projectActivities } from "@/db/schema";
import { AVATAR_COLORS, profileBrowseSchema, profileEditSchema, type ProfileEditInput } from "@/contracts/member-profile";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";
import { shanghaiDay } from "./schedule/types";

const profileFields = {
  id: users.id, name: users.name, bio: userProfiles.bio, skills: userProfiles.skills,
  avatarColor: userProfiles.avatarColor, avatarLabel: userProfiles.avatarLabel,
  revision: userProfiles.revision, updatedAt: userProfiles.updatedAt,
};
type ProfileRow = { id: string; name: string; bio: string | null; skills: string[] | null; avatarColor: string | null; avatarLabel: string | null; revision: number | null; updatedAt: Date | null };
function profileView(row: ProfileRow) {
  return { ...row, bio: row.bio ?? "", skills: row.skills ?? [],
    avatarColor: AVATAR_COLORS.find(c => c === row.avatarColor) ?? "blue",
    avatarLabel: row.avatarLabel ?? "", revision: row.revision ?? 0,
    updatedAt: row.updatedAt?.toISOString() ?? null };
}
function validIdentity(id: string) { if (!z.uuid().safeParse(id).success) throw new ForbiddenError(); }

export async function getMyProfile(actorId: string) {
  validIdentity(actorId);
  const [row] = await db.select(profileFields).from(users).leftJoin(userProfiles, eq(users.id, userProfiles.userId)).where(eq(users.id, actorId));
  if (!row) throw new ForbiddenError();
  return profileView(row);
}

export async function updateMyProfile(actorId: string, input: ProfileEditInput) {
  validIdentity(actorId);
  const parsed = profileEditSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const { expectedRevision, name, ...data } = parsed.data;
  const unique = new Map(data.skills.map(skill => [skill.toLocaleLowerCase(), skill]));
  data.skills = [...unique.values()];
  return db.transaction(async tx => {
    // Serialize the first edit too, when no profile row exists yet.
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, actorId)).for("update");
    if (!user) throw new ForbiddenError();
    const [prior] = await tx.select({ revision: userProfiles.revision }).from(userProfiles).where(eq(userProfiles.userId, actorId));
    if ((prior?.revision ?? 0) !== expectedRevision) throw new ConflictError("资料已在其他页面更新，请重新打开后核对再保存。");
    await tx.update(users).set({ name }).where(eq(users.id, actorId));
    const changes = { ...data, revision: expectedRevision + 1, updatedAt: new Date() };
    if (prior) await tx.update(userProfiles).set(changes).where(eq(userProfiles.userId, actorId));
    else await tx.insert(userProfiles).values({ userId: actorId, ...changes });
    return { revision: changes.revision };
  });
}

/** A directory is scoped to its live team membership, never a global user search. */
export async function getTeamMemberDirectory(actorId: string, teamId: string) {
  validIdentity(actorId); validIdentity(teamId);
  return db.transaction(async tx => {
  const [access] = await tx.select({ role: teamMembers.role, name: teams.name }).from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, actorId), eq(teamMembers.teamId, teamId))).for("share");
  if (!access) throw new ForbiddenError();
  const members = await tx.select({ ...profileFields, role: teamMembers.role }).from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId)).leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(teamMembers.teamId, teamId)).orderBy(asc(users.name), asc(users.id));
  return { team: { id: teamId, name: access.name }, role: access.role,
    members: members.map(row => ({ ...profileView(row), role: row.role })) };
  });
}

export async function getMemberProfile(actorId: string, targetId: string,
  input: z.input<typeof profileBrowseSchema> = {}) {
  validIdentity(actorId); validIdentity(targetId);
  const parsed = profileBrowseSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("主页筛选参数无效");
  const { teamId, filter, page } = parsed.data;
  return db.transaction(async tx => {
  // Check the intersection before loading the target's profile or any project data.
  const viewer = alias(teamMembers, "profile_viewer"), target = alias(teamMembers, "profile_target");
  const shared = await tx.select({ id: teams.id, name: teams.name, role: target.role }).from(viewer)
    .innerJoin(target, eq(target.teamId, viewer.teamId)).innerJoin(teams, eq(teams.id, viewer.teamId))
    .where(and(eq(viewer.userId, actorId), eq(target.userId, targetId), teamId ? eq(teams.id, teamId) : undefined))
    .orderBy(asc(teams.name)).for("share");
  if ((!shared.length && actorId !== targetId) || (teamId && !shared.length)) throw new ForbiddenError();
  const [row] = await tx.select(profileFields).from(users).leftJoin(userProfiles, eq(users.id, userProfiles.userId)).where(eq(users.id, targetId));
  if (!row) throw new ForbiddenError();
  const commonTeams = shared.map(t => t.id), today = shanghaiDay();
  const scopedProjects = commonTeams.length ? await tx.select({
    id: projects.id, name: projects.name, teamId: projects.teamId, status: projects.status,
    startDate: projects.startDate, endDate: projects.endDate, leaderId: projects.leaderId,
  }).from(projects).where(inArray(projects.teamId, commonTeams)).orderBy(desc(projects.createdAt), asc(projects.id)) : [];
  const projectIds = scopedProjects.map(p => p.id);
  const isSelf = actorId === targetId;
  if (!projectIds.length) return { person: profileView(row), isSelf, teams: shared, selectedTeamId: teamId,
    stats: { tasks: 0, done: 0, doing: 0, todo: 0, overdue: 0, projects: 0, deliverables: 0 },
    projects: [], tasks: { items: [], total: 0, page, pageSize: 20 }, deliverables: [], activity: [] };
  // This predicate is repeated in every aggregate/list. It also catches membership
  // revoked between the initial intersection lookup and the project query.
  const allowedProject = sql`exists(select 1 from ${teamMembers} a join ${teamMembers} b on b.team_id=a.team_id
    where a.user_id=${actorId} and b.user_id=${targetId} and a.team_id=${projects.teamId})`;
  const assigned = and(inArray(tasks.projectId, projectIds), assignedTo(targetId), allowedProject);
  const overdue = and(ne(tasks.status, "done"), lt(tasks.dueDate, today));
  const taskFilter = filter === "all" ? undefined : filter === "overdue" ? overdue : eq(tasks.status, filter);
  const visibleDeliverable = and(inArray(deliverables.projectId, projectIds), eq(deliverables.authorId, targetId),
    ne(deliverables.status, "draft"), allowedProject);
  const [taskCounts, taskRows, [filteredCount], [materialCount], materialRows, activity, perProject] = await Promise.all([
    tx.select({ status: tasks.status, count: sql<number>`count(*)::int`, overdue: sql<number>`count(*) filter(where ${overdue})::int` })
      .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(assigned).groupBy(tasks.status),
    tx.select({ id: tasks.id, projectId: tasks.projectId, projectName: projects.name, title: tasks.title,
      status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate, parentTaskId: tasks.parentTaskId, isBlocked: tasks.isBlocked })
      .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(assigned, taskFilter))
      .orderBy(sql`case when ${tasks.status}='done' then 1 else 0 end`, sql`coalesce(${tasks.dueDate},'9999-12-31')`, desc(tasks.updatedAt), asc(tasks.id)).limit(20).offset((page - 1) * 20),
    tx.select({ count: sql<number>`count(*)::int` }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(and(assigned, taskFilter)),
    tx.select({ count: sql<number>`count(*)::int` }).from(deliverables).innerJoin(projects, eq(projects.id, deliverables.projectId)).where(visibleDeliverable),
    tx.select({ id: deliverables.id, projectId: deliverables.projectId, projectName: projects.name,
      title: deliverables.title, type: deliverables.type, status: deliverables.status, submittedAt: deliverables.submittedAt,
      version: sql<number>`coalesce((select max(v.version_number) from ${deliverableVersions} v where v.deliverable_id=${deliverables.id}),0)::int` })
      .from(deliverables).innerJoin(projects, eq(projects.id, deliverables.projectId)).where(visibleDeliverable)
      .orderBy(desc(deliverables.submittedAt), desc(deliverables.id)).limit(20),
    tx.select({ id: projectActivities.id, projectId: projectActivities.projectId, projectName: projects.name,
      type: projectActivities.type, summary: projectActivities.summary, occurredAt: projectActivities.occurredAt })
      .from(projectActivities).innerJoin(projects, eq(projects.id, projectActivities.projectId))
      .where(and(inArray(projectActivities.projectId, projectIds), eq(projectActivities.actorId, targetId), allowedProject))
      .orderBy(desc(projectActivities.occurredAt), desc(projectActivities.id)).limit(10),
    tx.select({ id: tasks.projectId, total: sql<number>`count(*)::int`, done: sql<number>`count(*) filter(where ${tasks.status}='done')::int` })
      .from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId)).where(assigned).groupBy(tasks.projectId),
  ]);
  const counts = { todo: 0, doing: 0, done: 0, overdue: 0 };
  for (const group of taskCounts) { counts[group.status] = group.count; counts.overdue += group.overdue; }
  return { person: profileView(row), isSelf, teams: shared, selectedTeamId: teamId,
    stats: { ...counts, tasks: counts.todo + counts.doing + counts.done, projects: scopedProjects.length, deliverables: materialCount.count },
    projects: scopedProjects.map(project => { const progress = perProject.find(p => p.id === project.id);
      return { ...project, role: shared.find(t => t.id === project.teamId)!.role, isLeader: project.leaderId === targetId,
        tasks: progress?.total ?? 0, done: progress?.done ?? 0 }; }),
    tasks: { items: taskRows, total: filteredCount.count, page, pageSize: 20 },
    deliverables: materialRows.map(material => ({ ...material, submittedAt: material.submittedAt?.toISOString() ?? null })),
    activity: activity.map(event => ({ ...event, occurredAt: event.occurredAt.toISOString() })) };
  });
}
export type MemberProfile = Awaited<ReturnType<typeof getMemberProfile>>;
