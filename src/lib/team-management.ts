import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, type DbTx } from "@/db";
import { projects, teamMembers, teams, users } from "@/db/schema";
import { teamJoinRequests, teamManagementSettings } from "@/db/team-management-schema";
import { AppError, ConflictError, ForbiddenError } from "./errors";

async function access(tx: DbTx, actorId: string, teamId: string, adminOnly = true) {
  if (!z.uuid().safeParse(teamId).success) throw new ForbiddenError();
  const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
  if (!team) throw new ForbiddenError();
  const [member] = await tx.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actorId))).for("share");
  if (!member || (adminOnly && member.role !== "admin")) throw new ForbiddenError();
  await tx.insert(teamManagementSettings).values({ teamId }).onConflictDoNothing();
  const [settings] = await tx.select().from(teamManagementSettings).where(eq(teamManagementSettings.teamId, teamId));
  return { team, member, settings };
}

export async function getTeamManagement(actorId: string, teamId: string) {
  return db.transaction(async tx => {
    const data = await access(tx, actorId, teamId);
    const requests = await tx.select({ id: teamJoinRequests.id, name: users.name, status: teamJoinRequests.status, createdAt: teamJoinRequests.createdAt })
      .from(teamJoinRequests).innerJoin(users, eq(teamJoinRequests.userId, users.id)).where(eq(teamJoinRequests.teamId, teamId));
    return { ...data, requests };
  });
}

export async function listMyTeamJoinRequests(actorId: string) {
  return db.select({ id: teamJoinRequests.id, teamName: teams.name, status: teamJoinRequests.status, createdAt: teamJoinRequests.createdAt })
    .from(teamJoinRequests).innerJoin(teams, eq(teams.id, teamJoinRequests.teamId)).where(eq(teamJoinRequests.userId, actorId)).orderBy(desc(teamJoinRequests.createdAt)).limit(20);
}

const invitationSchema = z.object({ revision: z.number().int().positive(), enabled: z.boolean(), requireApproval: z.boolean(), lifetimeDays: z.union([z.literal(0), z.literal(1), z.literal(7), z.literal(30)]), rotate: z.boolean() }).strict();
export async function updateTeamInvitation(actorId: string, teamId: string, input: z.infer<typeof invitationSchema>) {
  const parsed = invitationSchema.safeParse(input);
  if (!parsed.success) throw new AppError("请检查邀请设置");
  return db.transaction(async tx => {
    const { settings } = await access(tx, actorId, teamId);
    if (settings.archivedAt) throw new AppError("团队已归档，请先恢复团队");
    if (settings.revision !== input.revision) throw new ConflictError("邀请设置已变化，请刷新后重试");
    if (input.rotate) await tx.update(teams).set({ inviteCode: nanoid(10) }).where(eq(teams.id, teamId));
    const [updated] = await tx.update(teamManagementSettings).set({
      inviteEnabled: input.enabled, requireApproval: input.requireApproval,
      inviteExpiresAt: input.lifetimeDays ? new Date(Date.now() + input.lifetimeDays * 86400000) : null,
      revision: settings.revision + 1,
    }).where(eq(teamManagementSettings.teamId, teamId)).returning();
    return updated;
  });
}

export async function reviewTeamJoinRequest(actorId: string, teamId: string, requestId: string, approve: boolean) {
  if (!z.uuid().safeParse(requestId).success || typeof approve !== "boolean") throw new AppError("加入申请无效");
  return db.transaction(async tx => {
    const { settings } = await access(tx, actorId, teamId);
    if (settings.archivedAt) throw new AppError("团队已归档，请先恢复团队");
    const [request] = await tx.select().from(teamJoinRequests).where(and(eq(teamJoinRequests.id, requestId), eq(teamJoinRequests.teamId, teamId))).for("update");
    if (!request) throw new ForbiddenError();
    if (request.status !== "pending") throw new ConflictError("申请已处理，请刷新列表");
    if (approve) await tx.insert(teamMembers).values({ teamId, userId: request.userId, role: "student" }).onConflictDoNothing();
    const [result] = await tx.update(teamJoinRequests).set({ status: approve ? "approved" : "rejected", reviewedById: actorId, reviewedAt: new Date() }).where(eq(teamJoinRequests.id, requestId)).returning();
    return result;
  });
}

export async function setTeamArchived(actorId: string, teamId: string, archived: boolean, expectedRevision: number) {
  return db.transaction(async tx => {
    const { settings } = await access(tx, actorId, teamId);
    if (settings.revision !== expectedRevision) throw new ConflictError("团队设置已变化，请刷新后重试");
    const projectRows = await tx.select().from(projects).where(eq(projects.teamId, teamId)).for("update");
    if (archived && projectRows.some(p => p.status === "active")) throw new AppError("请先归档团队的全部项目，再归档团队");
    const [result] = await tx.update(teamManagementSettings).set({ archivedAt: archived ? new Date() : null, revision: settings.revision + 1 }).where(eq(teamManagementSettings.teamId, teamId)).returning();
    return result;
  });
}

async function deletionPreview(tx: DbTx, data: Awaited<ReturnType<typeof access>>) {
  const id = data.team.id;
  const [counts] = await tx.execute<{ projects: number; members: number; tasks: number; documents: number; reservations: number; usages: number }>(sql`
    select (select count(*)::int from projects where team_id=${id}) as projects,
      (select count(*)::int from team_members where team_id=${id}) as members,
      (select count(*)::int from tasks t join projects p on p.id=t.project_id where p.team_id=${id}) as tasks,
      (select count(*)::int from project_documents d join projects p on p.id=d.project_id where p.team_id=${id}) as documents,
      (select count(*)::int from resource_reservations where team_id=${id}) as reservations,
      (select count(*)::int from resource_usages where team_id=${id}) as usages
  `);
  const projectRows = await tx.select({ id: projects.id, status: projects.status }).from(projects).where(eq(projects.teamId, id)).for("update");
  const token = createHash("sha256").update(JSON.stringify([data.team.name, data.settings, counts, projectRows.sort((a,b) => a.id.localeCompare(b.id))])).digest("hex");
  return { counts, token, projectIds: projectRows.map(p => p.id) };
}
export async function previewTeamDeletion(actorId: string, teamId: string) {
  return db.transaction(async tx => deletionPreview(tx, await access(tx, actorId, teamId)));
}
export async function deleteArchivedTeam(actorId: string, teamId: string, input: { name: string; token: string }) {
  return db.transaction(async tx => {
    const data = await access(tx, actorId, teamId);
    if (!data.settings.archivedAt) throw new AppError("请先归档团队，再进行解散");
    if (input.name !== data.team.name) throw new AppError("请输入完整团队名称以确认解散");
    const preview = await deletionPreview(tx, data);
    if (preview.token !== input.token) throw new ConflictError("团队内容已变化，请重新核对解散范围");
    const [active] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.teamId, teamId), eq(projects.status, "active")));
    if (active) throw new AppError("团队还有进行中的项目，请先归档全部项目");
    await tx.execute(sql`delete from collaboration_reactions where message_id in (
      select c.id from task_comments c join projects p on p.id=c.project_id where p.team_id=${teamId}
      union all select d.id from task_discussion_messages d join tasks t on t.id=d.task_id join projects p on p.id=t.project_id where p.team_id=${teamId}
    )`);
    await tx.delete(teams).where(eq(teams.id, teamId));
    return { projectIds: preview.projectIds };
  });
}
