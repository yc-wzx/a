import { assignedTo } from "./task-assignees";
import { and, asc, eq, gt, gte, inArray, lt, lte, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { iterations, milestones, personalScheduleEvents, personalWorkPlans, projects, tasks, teamMembers } from "@/db/schema";
import type { CalendarEntry, WorkspaceCalendar } from "@/contracts/workspace-calendar";
import { calendarDayOffset, dayStartMs, DAY_MS } from "./calendar-dates";
import { isPersonalPlanStale } from "./schedule/planner";
import type { WorkBlock } from "./schedule/types";

export const calendarQuerySchema = z.strictObject({ startDate: z.iso.date(), endDate: z.iso.date() }).refine(
  q => q.startDate <= q.endDate && dayStartMs(q.endDate) - dayStartMs(q.startDate) < 42 * DAY_MS,
  { message: "请选择不超过 42 天的有效日期范围" },
);
const LIMIT = 2000;
export async function getWorkspaceCalendar(actorId: string, input: { startDate: string; endDate: string }): Promise<WorkspaceCalendar> {
  z.uuid().parse(actorId);
  const range = calendarQuerySchema.parse(input);
  const from = new Date(dayStartMs(range.startDate)), to = new Date(dayStartMs(calendarDayOffset(range.endDate, 1)));
  return db.transaction(async tx => {
    // Keep membership and active-project visibility stable throughout the read.
    const visible = await tx.select({ id: projects.id, name: projects.name, endDate: projects.endDate })
      .from(projects).innerJoin(teamMembers, eq(teamMembers.teamId, projects.teamId))
      .where(and(eq(teamMembers.userId, actorId), eq(projects.status, "active")))
      .for("share", { of: [projects, teamMembers] });
    const ids = visible.map(p => p.id), names = new Map(visible.map(p => [p.id, p.name]));
    const events = await tx.select({ id: personalScheduleEvents.id, title: personalScheduleEvents.title, startAt: personalScheduleEvents.startAt, endAt: personalScheduleEvents.endAt })
      .from(personalScheduleEvents).where(and(eq(personalScheduleEvents.userId, actorId), lt(personalScheduleEvents.startAt, to), gt(personalScheduleEvents.endAt, from)))
      .orderBy(asc(personalScheduleEvents.startAt), asc(personalScheduleEvents.id)).limit(LIMIT + 1);
    const entries: CalendarEntry[] = events.slice(0, LIMIT).map(e => ({ id: `schedule:${e.id}`, source: "schedule", when: "time", title: e.title, startAt: e.startAt.toISOString(), endAt: e.endAt.toISOString(), href: `/schedule?from=${range.startDate}&to=${range.endDate}` }));
    let truncated = events.length > LIMIT;
    if (!ids.length) return { ...range, entries, truncated };
    const [due, stages, rounds, plans] = await Promise.all([
      tx.select().from(tasks).where(and(inArray(tasks.projectId, ids), assignedTo(actorId), ne(tasks.status, "done"), gte(tasks.dueDate, range.startDate), lte(tasks.dueDate, range.endDate))).orderBy(tasks.dueDate, tasks.id).limit(LIMIT + 1),
      tx.select().from(milestones).where(and(inArray(milestones.projectId, ids), gte(milestones.targetDate, range.startDate), lte(milestones.targetDate, range.endDate))).orderBy(milestones.targetDate, milestones.id).limit(LIMIT + 1),
      tx.select().from(iterations).where(and(inArray(iterations.projectId, ids), lte(iterations.startDate, range.endDate), gte(iterations.endDate, range.startDate))).orderBy(iterations.startDate, iterations.id).limit(LIMIT + 1),
      tx.select().from(personalWorkPlans).where(and(eq(personalWorkPlans.userId, actorId), eq(personalWorkPlans.status, "confirmed"), inArray(personalWorkPlans.projectId, ids), lte(personalWorkPlans.startDate, range.endDate), gte(personalWorkPlans.endDate, range.startDate))).orderBy(personalWorkPlans.startDate, personalWorkPlans.id).limit(101),
    ]);
    truncated ||= due.length > LIMIT || stages.length > LIMIT || rounds.length > LIMIT || plans.length > 100;
    for (const t of due.slice(0, LIMIT)) entries.push({ id: `task:${t.id}`, when: "date", source: "deadline", kind: "task", date: t.dueDate!, title: t.title, projectName: names.get(t.projectId), href: `/projects/${t.projectId}?task=${t.id}` });
    for (const m of stages.slice(0, LIMIT)) entries.push({ id: `milestone:${m.id}`, when: "date", source: "deadline", kind: "milestone", date: m.targetDate!, title: m.title, done: m.status === "done", projectName: names.get(m.projectId), href: `/projects/${m.projectId}` });
    for (const i of rounds.slice(0, LIMIT)) entries.push({ id: `iteration:${i.id}`, when: "range", source: "deadline", kind: "iteration", date: i.startDate, endDate: i.endDate, title: i.name, done: i.status === "completed", projectName: names.get(i.projectId), href: `/projects/${i.projectId}/iterations/${i.id}` });
    for (const p of visible) if (p.endDate && p.endDate >= range.startDate && p.endDate <= range.endDate) entries.push({ id: `project:${p.id}`, when: "date", source: "deadline", kind: "project", date: p.endDate, title: `${p.name} · 项目截止`, href: `/projects/${p.id}` });
    // Resolve saved block references against current tasks; deleted/completed/reassigned
    // tasks must never reappear as somebody's scheduled work from an old snapshot.
    const currentTasks = await tx.select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId }).from(tasks).where(and(inArray(tasks.projectId, ids), assignedTo(actorId), ne(tasks.status, "done")));
    const ownTasks = new Map(currentTasks.map(t => [t.id, t]));
    for (const p of plans.slice(0, 100)) {
      const stale = await isPersonalPlanStale(tx, actorId, p);
      for (const [index, block] of (p.items as WorkBlock[]).entries()) {
        const task = ownTasks.get(block.taskId);
        if (!task || task.projectId !== p.projectId || Date.parse(block.startAt) >= to.getTime() || Date.parse(block.endAt) <= from.getTime()) continue;
        entries.push({ id: `work:${p.id}:${index}`, when: "time", source: "work", title: task.title, startAt: block.startAt, endAt: block.endAt, stale, projectName: names.get(p.projectId), href: `/projects/${p.projectId}?task=${task.id}` });
      }
    }
    return { ...range, entries, truncated };
  }, { isolationLevel: "repeatable read" });
}
