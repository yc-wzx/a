import { and, eq, gt, lt, ne, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { personalScheduleEvents, personalScheduleState, personalWorkPlans, projects, milestones, tasks, teamMembers } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { hashRequest } from "@/lib/write-request";
import { assignedTo } from "@/lib/task-assignees";
import { claimPersonalRequest, finishPersonalRequest, lockPersonalState } from "./store";
import { isPersonalPlanStale } from "./planner";
import { preferencesSchema, shanghaiDay, type WorkBlock } from "./types";

export const calendarMoveSchema = z.strictObject({
  kind: z.enum(["event", "work"]), id: z.uuid(), index: z.number().int().min(0).max(999).optional(),
  expectedRevision: z.number().int().positive(), startAt: z.iso.datetime({ offset: true }),
  commit: z.boolean().default(false), requestId: z.uuid(),
});
export async function moveCalendarArrangement(actor: string, input: unknown) {
  z.uuid().parse(actor); const data = calendarMoveSchema.parse(input), start = new Date(data.startAt);
  if (start.getUTCSeconds() || start.getUTCMilliseconds() || start.getUTCMinutes() % 15) throw new ValidationError("请以 15 分钟为单位调整时间");
  return db.transaction(async tx => {
    const state = await lockPersonalState(tx, actor);
    const claim = data.commit ? await claimPersonalRequest(tx, actor, "calendar.move", data.requestId, data) : null;
    if (claim?.replay) return claim.result as { saved: boolean; startAt: string; endAt: string; conflicts: string[] };
    let event: typeof personalScheduleEvents.$inferSelect | undefined, plan: typeof personalWorkPlans.$inferSelect | undefined, block: WorkBlock | undefined, effectiveDeadline: string | undefined, earliestDate: string | null = null;
    if (data.kind === "event") {
      [event] = await tx.select().from(personalScheduleEvents).where(and(eq(personalScheduleEvents.id, data.id), eq(personalScheduleEvents.userId, actor))).for("update");
      if (!event) throw new NotFoundError();
      if (!["manual", "emergency"].includes(event.source)) throw new ForbiddenError("导入日程只读，请在来源日历修改");
      if (event.revision !== data.expectedRevision) throw new ConflictError("日程已变化，请刷新后重新调整");
    } else {
      [plan] = await tx.select().from(personalWorkPlans).where(and(eq(personalWorkPlans.id, data.id), eq(personalWorkPlans.userId, actor), eq(personalWorkPlans.status, "confirmed"))).for("update");
      if (!plan) throw new NotFoundError();
      const [access] = await tx.select({ id: projects.id, endDate: projects.endDate }).from(projects).innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId)).where(and(eq(projects.id, plan.projectId), eq(projects.status, "active"), eq(teamMembers.userId, actor))).for("share", { of: [projects, teamMembers] });
      if (!access) throw new ForbiddenError();
      if (plan.revision !== data.expectedRevision || await isPersonalPlanStale(tx, actor, plan)) throw new ConflictError("个人计划已变化，请先重新核对计划");
      block = (plan.items as WorkBlock[])[data.index ?? -1];
      if (!block) throw new ValidationError("工作时段不存在");
      const [task] = await tx.select({ dueDate: tasks.dueDate, startDate: tasks.startDate, status: tasks.status, milestoneId: tasks.milestoneId }).from(tasks).where(and(eq(tasks.id, block.taskId), eq(tasks.projectId, plan.projectId), assignedTo(actor))).for("share");
      if (!task || task.status === "done") throw new ForbiddenError("此任务已完成或已不再指派给你");
      const [stage] = task.milestoneId ? await tx.select({ targetDate: milestones.targetDate }).from(milestones).where(and(eq(milestones.id,task.milestoneId),eq(milestones.projectId,plan.projectId))).for("share") : [];
      effectiveDeadline = [task.dueDate,stage?.targetDate,access.endDate].filter((v): v is string => !!v).sort()[0];
      earliestDate = task.startDate;
    }
    const originalStart = event?.startAt.getTime() ?? Date.parse(block!.startAt), originalEnd = event?.endAt.getTime() ?? Date.parse(block!.endAt);
    const end = new Date(start.getTime() + originalEnd - originalStart), conflicts: string[] = [];
    if (end <= start || end.getTime() - start.getTime() > 7 * 86400000) throw new ValidationError("日程时段不合法");
    if (plan) {
      const day = shanghaiDay(start), endDay = shanghaiDay(new Date(end.getTime() - 1)), prefs = preferencesSchema.parse(state.preferences);
      if (start.getTime() < Date.now()) conflicts.push("工作安排不能移到已经过去的时间");
      if (earliestDate && day < earliestDate) conflicts.push("早于任务开始日期");
      if (day < plan.startDate || endDay > plan.endDate || day !== endDay) conflicts.push("工作时段必须位于原计划日期内，且不能跨天");
      const minute = (d: Date) => (d.getUTCHours() * 60 + d.getUTCMinutes() + 480) % 1440;
      const minutes = (s: string) => Number(s.slice(0,2)) * 60 + Number(s.slice(3));
      if (!prefs.days.includes(new Date(`${day}T00:00:00Z`).getUTCDay()) || minute(start) < minutes(prefs.workStart) || minute(end) > minutes(prefs.workEnd)) conflicts.push("超出已设置的可投入时间");
      if (effectiveDeadline && endDay > effectiveDeadline) conflicts.push("晚于任务或所属阶段的截止日期");
    }
    const buffer = plan ? preferencesSchema.parse(state.preferences).bufferMinutes * 60000 : 0;
    const busy = await tx.select({ title: personalScheduleEvents.title }).from(personalScheduleEvents).where(and(eq(personalScheduleEvents.userId, actor), event ? ne(personalScheduleEvents.id, event.id) : undefined, lt(personalScheduleEvents.startAt, new Date(end.getTime()+buffer)), gt(personalScheduleEvents.endAt, new Date(start.getTime()-buffer)))).limit(5);
    conflicts.push(...busy.map(e => `与「${e.title}」时间重叠`));
    const plans = await tx.select().from(personalWorkPlans).innerJoin(projects, eq(projects.id, personalWorkPlans.projectId)).innerJoin(teamMembers, and(eq(teamMembers.teamId, projects.teamId), eq(teamMembers.userId, actor))).where(and(eq(personalWorkPlans.userId, actor), eq(personalWorkPlans.status, "confirmed"), eq(projects.status, "active"))).limit(101);
    if (plans.length > 100) throw new ConflictError("个人计划过多，请先整理后再调整");
    const currentTasks = plans.length ? await tx.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.projectId,[...new Set(plans.map(p => p.projects.id))]),assignedTo(actor),ne(tasks.status,"done"))) : [];
    const currentIds = new Set(currentTasks.map(t => t.id));
    for (const p of plans) for (const [i,b] of (p.personal_work_plans.items as WorkBlock[]).entries()) {
      if (!currentIds.has(b.taskId)) continue;
      if (plan?.id === p.personal_work_plans.id && i === data.index) continue;
      if (Date.parse(b.startAt) < end.getTime() && Date.parse(b.endAt) > start.getTime()) conflicts.push(`与「${b.title}」工作安排重叠`);
    }
    if (plan) {
      const dailyMinutes = plans.reduce((sum,p) => sum + (p.personal_work_plans.items as WorkBlock[]).reduce((n,b,i) => n + (!currentIds.has(b.taskId) || p.personal_work_plans.id === plan!.id && i === data.index || shanghaiDay(new Date(b.startAt)) !== shanghaiDay(start) ? 0 : b.minutes),0),block!.minutes);
      if (dailyMinutes > preferencesSchema.parse(state.preferences).dailyMinutes) conflicts.push("超过每天最多投入时间");
    }
    const result = { saved: data.commit, startAt: start.toISOString(), endAt: end.toISOString(), conflicts: [...new Set(conflicts)].slice(0,10) };
    if (!data.commit) return result;
    if (conflicts.length) throw new ConflictError("所选时间有冲突，请更换时间后重试");
    if (event) {
      const fingerprint = hashRequest({ title: event.title, startAt: start.toISOString(), endAt: end.toISOString() });
      await tx.update(personalScheduleEvents).set({ startAt: start, endAt: end, fingerprint, revision: event.revision + 1 }).where(eq(personalScheduleEvents.id, event.id));
      await tx.update(personalScheduleState).set({ revision: state.revision + 1 }).where(eq(personalScheduleState.userId, actor));
    } else {
      const items = (plan!.items as WorkBlock[]).map((b,i) => i === data.index ? { ...b, startAt: start.toISOString(), endAt: end.toISOString() } : b);
      await tx.update(personalWorkPlans).set({ items, revision: plan!.revision + 1 }).where(eq(personalWorkPlans.id, plan!.id));
    }
    return finishPersonalRequest(tx, claim!.id, result);
  });
}
