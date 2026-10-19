import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { teamMembers, teams, users, type TeamRole } from "@/db/schema";
import { AppError, ForbiddenError, isUniqueViolation } from "./errors";

export async function createTeam(userId: string, name: string) {
  return db.transaction(async (tx) => {
    const [team] = await tx
      .insert(teams)
      .values({ name, inviteCode: nanoid(10) })
      .returning();
    await tx.insert(teamMembers).values({
      teamId: team.id,
      userId,
      role: "admin",
    });
    return team;
  });
}

export async function joinTeam(userId: string, inviteCode: string) {
  const [team] = await db.select().from(teams).where(eq(teams.inviteCode, inviteCode));
  if (!team) throw new AppError("邀请码无效");

  const [existing] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));
  if (existing) throw new AppError("已在该团队中");

  try {
    const [member] = await db
      .insert(teamMembers)
      .values({ teamId: team.id, userId, role: "student" })
      .returning();
    return member;
  } catch (e) {
    // 查重与插入之间的并发窗口：另一请求已抢先加入，由 DB 唯一约束兜底
    if (isUniqueViolation(e)) throw new AppError("已在该团队中");
    throw e;
  }
}

export async function getTeamMembership(userId: string, teamId: string) {
  const [member] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return member ?? null;
}

export async function requireTeamRole(
  userId: string,
  teamId: string,
  allowed: TeamRole[],
) {
  const member = await getTeamMembership(userId, teamId);
  if (!member || !allowed.includes(member.role)) throw new ForbiddenError();
  return member;
}

// 无权限前置：调用方须已校验访问权（如 getProjectForUser / requireTeamRole）后再调用
export async function listTeamMembers(teamId: string) {
  return db
    .select({ id: users.id, name: users.name, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));
}

export async function updateMemberRole(
  actorId: string,
  teamId: string,
  targetUserId: string,
  role: TeamRole,
) {
  if (!z.enum(["admin", "teacher", "student"]).safeParse(role).success) throw new AppError("角色无效");
  return db.transaction(async tx => {
    await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
    const members = await tx.select().from(teamMembers).where(eq(teamMembers.teamId, teamId)).for("update");
    if (members.find(m => m.userId === actorId)?.role !== "admin") throw new ForbiddenError();
    const target = members.find(m => m.userId === targetUserId);
    if (!target) throw new AppError("该成员不在团队中");
    if (target.role === "admin" && role !== "admin" && members.filter(m => m.role === "admin").length === 1) throw new AppError("请先指定另一位管理员，团队必须保留至少一位管理员");
    const [updated] = await tx
      .update(teamMembers)
      .set({ role })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)))
      .returning();
    if (!updated) throw new AppError("该成员不在团队中");
    return updated;
  });
}

export async function removeTeamMember(actorId: string, teamId: string, targetUserId: string) {
  return db.transaction(async tx => {
    await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("update");
    const members = await tx.select().from(teamMembers).where(eq(teamMembers.teamId, teamId)).for("update");
    const actor = members.find(m => m.userId === actorId), target = members.find(m => m.userId === targetUserId);
    if (!actor || (actor.role !== "admin" && actorId !== targetUserId)) throw new ForbiddenError();
    if (!target) throw new AppError("该成员不在团队中");
    if (target.role === "admin" && members.filter(m => m.role === "admin").length === 1) throw new AppError("请先指定另一位管理员，再移除或退出");
    const [open] = await tx.execute<{ total: number }>(sql`select count(*)::int as total from tasks t join projects p on p.id=t.project_id where p.team_id=${teamId} and p.status='active' and t.status<>'done' and (t.assignee_id=${targetUserId} or exists(select 1 from task_assignees a where a.task_id=t.id and a.user_id=${targetUserId}))`);
    if (open.total) throw new AppError(`该成员还有 ${open.total} 项未完成任务，请先在任务中调整执行成员，再移除或退出`);
    const [lead] = await tx.execute<{ total: number }>(sql`select count(*)::int as total from projects where team_id=${teamId} and status='active' and leader_id=${targetUserId}`);
    if (lead.total) throw new AppError("请先在项目概览中调整项目负责人，再移除或退出");
    await tx.delete(teamMembers).where(eq(teamMembers.id, target.id));
  });
}
