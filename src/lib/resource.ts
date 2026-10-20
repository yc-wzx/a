import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, type DbTx } from "@/db";
import { resourceUsages, users, teams, teamMembers } from "@/db/schema";
import { resourceReservations, teamManagementSettings } from "@/db/team-management-schema";
import { AppError, ConflictError, ForbiddenError } from "./errors";
import { getTeamMembership } from "./team";
import { z } from "zod";

export interface CreateResourceUsageInput {
  resourceName: string;
  purpose?: string | null;
  startTime: Date;
  endTime?: Date | null;
}

// 登记资源占用。占用不分角色——任一团队成员皆可登记；纯登记无审批。
export async function createResourceUsage(
  actorId: string,
  teamId: string,
  input: CreateResourceUsageInput,
) {
  const name = input.resourceName.trim();
  if (!name) throw new AppError("资源名不能为空");
  if (name.length > 120 || (input.purpose?.length ?? 0) > 2000) throw new AppError("资源名称或用途过长");
  if (!Number.isFinite(input.startTime.getTime()) || (input.endTime && !Number.isFinite(input.endTime.getTime()))) throw new AppError("时间无效");
  if (input.endTime && input.endTime.getTime() <= input.startTime.getTime()) {
    throw new AppError("结束时间须晚于开始时间");
  }

  return db.transaction(async tx => {
  await reservationAccess(tx, actorId, teamId);
  await lockResource(tx, teamId, resourceKey(name));
  // The holder can start actual usage for their own approved booking.
  const [booking] = await tx.select({ id: resourceReservations.id }).from(resourceReservations).where(and(
    eq(resourceReservations.teamId, teamId), eq(resourceReservations.resourceKey, resourceKey(name)),
    eq(resourceReservations.status, "approved"), sql`${resourceReservations.userId} <> ${actorId}`,
    sql`${resourceReservations.startTime} < ${(input.endTime ?? new Date("9999-12-31T00:00:00Z")).toISOString()}::timestamptz`,
    sql`${resourceReservations.endTime} > ${input.startTime.toISOString()}::timestamptz`,
  ));
  if (booking) throw new ConflictError("该时段已有其他成员获批的预约，请先调整占用时间");
  const [usage] = await tx
    .insert(resourceUsages)
    .values({
      teamId,
      userId: actorId,
      resourceName: name,
      purpose: input.purpose?.trim() || null,
      startTime: input.startTime,
      endTime: input.endTime ?? null,
    })
    .returning();
  return usage;
  });
}

// 结束进行中占用（设 endTime=now）。登记者本人或团队 admin 可结束。
export async function endResourceUsage(actorId: string, usageId: string) {
  const [usage] = await db
    .select()
    .from(resourceUsages)
    .where(eq(resourceUsages.id, usageId));
  if (!usage) throw new AppError("占用记录不存在");

  const membership = await getTeamMembership(actorId, usage.teamId);
  if (!membership) throw new ForbiddenError();

  if (usage.userId !== actorId) {
    if (membership.role !== "admin") throw new ForbiddenError();
  }
  if (usage.endTime) throw new AppError("该占用已结束");

  const [ended] = await db
    .update(resourceUsages)
    .set({ endTime: sql`now()` })
    .where(and(eq(resourceUsages.id, usageId), isNull(resourceUsages.endTime)))
    .returning();
  if (!ended) throw new AppError("该占用已结束");
  return ended;
}

function resourceKey(name: string) { return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }
async function lockResource(tx: DbTx, teamId: string, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${teamId}:${key}`}, 811))`);
}
async function reservationAccess(tx: DbTx, actorId: string, teamId: string, allowArchived = false) {
  if (!z.uuid().safeParse(teamId).success) throw new ForbiddenError();
  const [team] = await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, teamId)).for("share");
  if (!team) throw new ForbiddenError();
  const [member] = await tx.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, actorId))).for("share");
  if (!member) throw new ForbiddenError();
  const [settings] = await tx.select().from(teamManagementSettings).where(eq(teamManagementSettings.teamId, teamId));
  if (settings?.archivedAt && !allowArchived) throw new AppError("团队已归档，不能新增或审批资源预约");
  return member;
}
async function checkReservationConflict(tx: DbTx, teamId: string, key: string, start: Date, end: Date, excludeId?: string) {
  const [booking] = await tx.select({ startTime: resourceReservations.startTime, endTime: resourceReservations.endTime }).from(resourceReservations).where(and(
    eq(resourceReservations.teamId, teamId), eq(resourceReservations.resourceKey, key), eq(resourceReservations.status, "approved"),
    sql`${resourceReservations.startTime} < ${end.toISOString()}::timestamptz`, sql`${resourceReservations.endTime} > ${start.toISOString()}::timestamptz`,
    excludeId ? sql`${resourceReservations.id} <> ${excludeId}` : undefined,
  ));
  if (booking) throw new ConflictError("该资源在所选时段已有获批预约，请调整时间");
  const [usage] = await tx.select({ id: resourceUsages.id }).from(resourceUsages).where(and(
    eq(resourceUsages.teamId, teamId),
    sql`lower(regexp_replace(trim(normalize(${resourceUsages.resourceName}, NFKC)), '[[:space:]]+', ' ', 'g')) = ${key}`,
    sql`${resourceUsages.startTime} < ${end.toISOString()}::timestamptz`, sql`(${resourceUsages.endTime} is null or ${resourceUsages.endTime} > ${start.toISOString()}::timestamptz)`,
  ));
  if (usage) throw new ConflictError("该资源在所选时段已有实际占用，请调整时间或先结束占用");
}
export async function createResourceReservation(actorId: string, teamId: string, input: { resourceName: string; purpose: string; startTime: Date; endTime: Date }) {
  const parsed = z.object({ resourceName: z.string().trim().min(1).max(120), purpose: z.string().trim().min(1).max(2000), startTime: z.date(), endTime: z.date() }).safeParse(input);
  if (!parsed.success) throw new AppError("请填写资源名称、用途和完整时间");
  const v = parsed.data;
  if (v.endTime <= v.startTime) throw new AppError("结束时间须晚于开始时间");
  if (v.startTime.getTime() < Date.now() - 60000) throw new AppError("预约开始时间不能早于当前时间");
  if (v.endTime.getTime() - v.startTime.getTime() > 30 * 86400000) throw new AppError("单次预约最长为30天");
  return db.transaction(async tx => {
    await reservationAccess(tx, actorId, teamId);
    const key = resourceKey(v.resourceName);
    await lockResource(tx, teamId, key);
    await checkReservationConflict(tx, teamId, key, v.startTime, v.endTime);
    const [record] = await tx.insert(resourceReservations).values({ teamId, userId: actorId, ...v, resourceKey: key }).returning();
    return record;
  });
}
export async function reviewResourceReservation(actorId: string, reservationId: string, input: { approve: boolean; revision: number; note?: string }) {
  if (!z.uuid().safeParse(reservationId).success || !Number.isInteger(input.revision) || typeof input.approve !== "boolean" || (input.note?.length ?? 0) > 1000) throw new AppError("审批信息无效");
  return db.transaction(async tx => {
    const [prior] = await tx.select().from(resourceReservations).where(eq(resourceReservations.id, reservationId));
    if (!prior) throw new ForbiddenError();
    const member = await reservationAccess(tx, actorId, prior.teamId);
    if (member.role !== "admin" && member.role !== "teacher") throw new ForbiddenError();
    await lockResource(tx, prior.teamId, prior.resourceKey);
    const [record] = await tx.select().from(resourceReservations).where(eq(resourceReservations.id, reservationId)).for("update");
    if (record.status !== "pending" || record.revision !== input.revision) throw new ConflictError("预约已被处理，请刷新列表");
    if (input.approve) {
      if (record.endTime.getTime() <= Date.now()) throw new AppError("预约时段已结束，不能批准");
      await checkReservationConflict(tx, record.teamId, record.resourceKey, record.startTime, record.endTime, record.id);
    }
    const [result] = await tx.update(resourceReservations).set({ status: input.approve ? "approved" : "rejected", reviewedById: actorId, reviewNote: input.note?.trim() || null, revision: record.revision + 1, updatedAt: new Date() }).where(eq(resourceReservations.id, reservationId)).returning();
    return result;
  });
}
export async function cancelResourceReservation(actorId: string, reservationId: string, expectedRevision: number) {
  if (!z.uuid().safeParse(reservationId).success || !Number.isInteger(expectedRevision)) throw new AppError("预约信息无效");
  return db.transaction(async tx => {
    const [prior] = await tx.select().from(resourceReservations).where(eq(resourceReservations.id, reservationId));
    if (!prior) throw new ForbiddenError();
    await reservationAccess(tx, actorId, prior.teamId, true);
    if (prior.userId !== actorId) throw new ForbiddenError();
    await lockResource(tx, prior.teamId, prior.resourceKey);
    const [record] = await tx.select().from(resourceReservations).where(eq(resourceReservations.id, reservationId)).for("update");
    if (!["pending", "approved"].includes(record.status) || record.revision !== expectedRevision) throw new ConflictError("预约已变化，请刷新列表");
    const [result] = await tx.update(resourceReservations).set({ status: "cancelled", revision: record.revision + 1, updatedAt: new Date() }).where(eq(resourceReservations.id, reservationId)).returning();
    return result;
  });
}
export async function listTeamResourceReservations(actorId: string, teamId: string) {
  if (!await getTeamMembership(actorId, teamId)) throw new ForbiddenError();
  return db.select({ id: resourceReservations.id, userId: resourceReservations.userId, userName: users.name,
    resourceName: resourceReservations.resourceName, purpose: resourceReservations.purpose,
    startTime: resourceReservations.startTime, endTime: resourceReservations.endTime, status: resourceReservations.status,
    reviewNote: resourceReservations.reviewNote, revision: resourceReservations.revision,
  }).from(resourceReservations).innerJoin(users, eq(resourceReservations.userId, users.id)).where(eq(resourceReservations.teamId, teamId)).orderBy(desc(resourceReservations.startTime)).limit(200);
}

function durationMinutes(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60000);
}

// 列举团队占用（倒序）+ 每人/每资源时长汇总（仅计已结束占用）。
export async function listTeamResourceUsages(actorId: string, teamId: string) {
  const membership = await getTeamMembership(actorId, teamId);
  if (!membership) throw new ForbiddenError();

  const rows = await db
    .select({
      id: resourceUsages.id,
      resourceName: resourceUsages.resourceName,
      purpose: resourceUsages.purpose,
      userId: resourceUsages.userId,
      userName: users.name,
      startTime: resourceUsages.startTime,
      endTime: resourceUsages.endTime,
    })
    .from(resourceUsages)
    .innerJoin(users, eq(resourceUsages.userId, users.id))
    .where(eq(resourceUsages.teamId, teamId))
    .orderBy(desc(resourceUsages.startTime));

  const usages = rows.map((r) => ({
    ...r,
    active: r.endTime === null,
    durationMinutes: r.endTime ? durationMinutes(r.startTime, r.endTime) : null,
  }));

  const byUserMap = new Map<string, { userId: string; userName: string; totalMinutes: number }>();
  const byResourceMap = new Map<string, { resourceName: string; totalMinutes: number }>();
  for (const u of usages) {
    if (u.durationMinutes === null) continue;
    const bu = byUserMap.get(u.userId) ?? { userId: u.userId, userName: u.userName, totalMinutes: 0 };
    bu.totalMinutes += u.durationMinutes;
    byUserMap.set(u.userId, bu);
    const br = byResourceMap.get(u.resourceName) ?? { resourceName: u.resourceName, totalMinutes: 0 };
    br.totalMinutes += u.durationMinutes;
    byResourceMap.set(u.resourceName, br);
  }

  return {
    usages,
    byUser: [...byUserMap.values()].sort((a, b) => b.totalMinutes - a.totalMinutes),
    byResource: [...byResourceMap.values()].sort((a, b) => b.totalMinutes - a.totalMinutes),
  };
}
