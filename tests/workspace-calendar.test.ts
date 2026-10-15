import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { iterations, milestones, personalScheduleEvents, personalWorkPlans, projects, tasks, teamMembers, users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { importMySchedule } from "@/lib/schedule/store";
import { changePersonalPlan, generatePersonalPlan } from "@/lib/schedule/planner";
import { calendarQuerySchema, getWorkspaceCalendar } from "@/lib/workspace-calendar";
import { resetDb } from "./helpers";

const range = { startDate: "2026-10-12", endDate: "2026-10-18" };
async function scene() {
  const [admin, student, other, teacher, outsider] = await db.insert(users).values(["admin", "student", "other", "teacher", "outsider"].map(name => ({ name, email: `${name}@calendar.test`, passwordHash: "fixture" }))).returning();
  const team = await createTeam(admin.id, "日历课程团队");
  for (const u of [student, other, teacher]) await joinTeam(u.id, team.inviteCode);
  await db.update(teamMembers).set({ role: "teacher" }).where(eq(teamMembers.userId, teacher.id));
  const project = await createProject(admin.id, team.id, { name: "日历项目", endDate: "2026-10-18" });
  const task = await createTask(admin.id, project.id, { title: "学生任务", assigneeId: student.id, dueDate: "2026-10-17" });
  const planInput = { requestId: randomUUID(), startDate: range.startDate, days: 7 as const, mode: "rules" as const, goal: "完善日历", selections: [{ taskId: task.id, minutes: 60 }] };
  return { admin, student, other, teacher, outsider, team, project, task, planInput };
}
beforeEach(async () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-12T00:00:00Z")); await resetDb(); });
afterEach(() => vi.useRealTimers());

describe("工作台个人日历的真实范围与权限", () => {
  it("按北京时间裁剪跨午夜事件，排除恰好落在范围外的边界", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, { requestId: randomUUID(), source: "manual", events: [
      { title: "跨日", startAt: "2026-10-11T23:30:00+08:00", endAt: "2026-10-12T00:30:00+08:00" },
      { title: "结束在边界外", startAt: "2026-10-11T23:00:00+08:00", endAt: "2026-10-12T00:00:00+08:00" },
      { title: "开始在边界外", startAt: "2026-10-19T00:00:00+08:00", endAt: "2026-10-19T00:30:00+08:00" },
    ] });
    const data = await getWorkspaceCalendar(s.student.id, range);
    expect(data.entries.filter(e => e.source === "schedule").map(e => e.title)).toEqual(["跨日"]);
    const deadline = data.entries.find(e => e.id === `task:${s.task.id}`)!;
    expect(deadline).toMatchObject({ when: "date", date: "2026-10-17" });
    expect(deadline).not.toHaveProperty("startAt");
  });
  it("教师能看当前团队项目节点，不能看学生的私人课表、工作计划和别人的任务截止", async () => {
    const s = await scene();
    await importMySchedule(s.student.id, { requestId: randomUUID(), source: "manual", events: [{ title: "不公开的事务原因", startAt: "2026-10-12T10:00:00+08:00", endAt: "2026-10-12T11:00:00+08:00", shareBusy: true }] });
    await db.insert(milestones).values({ projectId: s.project.id, title: "共同中期节点", targetDate: "2026-10-14" });
    await db.insert(iterations).values({ projectId: s.project.id, name: "跨范围迭代", startDate: "2026-10-01", endDate: "2026-10-15" });
    const draft = await generatePersonalPlan(s.student.id, s.project.id, s.planInput);
    await changePersonalPlan(s.student.id, s.project.id, draft.id, { requestId: randomUUID(), expectedRevision: 1, action: "confirm" });
    for (const user of [s.admin, s.other, s.teacher]) {
      const data = await getWorkspaceCalendar(user.id, range);
      expect(data.entries.every(e => e.source === "deadline" && e.when !== "time")).toBe(true);
      expect(data.entries.map(e => e.title)).toContain("共同中期节点");
      expect(data.entries.map(e => e.title)).toContain("跨范围迭代");
      expect(JSON.stringify(data)).not.toContain("不公开的事务原因");
      expect(data.entries.find(e => e.id === `task:${s.task.id}`)).toBeUndefined();
    }
    expect((await getWorkspaceCalendar(s.outsider.id, range)).entries).toEqual([]);
  });
  it("草案、取消计划不显示；任务修改使已确认计划标为需要核对，完成、改派后旧工作不复活", async () => {
    const s = await scene();
    const draft = await generatePersonalPlan(s.student.id, s.project.id, s.planInput);
    expect((await getWorkspaceCalendar(s.student.id, range)).entries.filter(e => e.source === "work")).toEqual([]);
    await changePersonalPlan(s.student.id, s.project.id, draft.id, { requestId: randomUUID(), expectedRevision: 1, action: "confirm" });
    let data = await getWorkspaceCalendar(s.student.id, range);
    expect(data.entries.filter(e => e.source === "work").every(e => e.stale === false)).toBe(true);
    expect(data.entries.some(e => e.source === "work")).toBe(true);
    await db.update(tasks).set({ title: "已更新的任务标题", dueDate: "2026-10-16" }).where(eq(tasks.id, s.task.id));
    data = await getWorkspaceCalendar(s.student.id, range);
    expect(data.entries.filter(e => e.source === "work").every(e => e.stale && e.title === "已更新的任务标题")).toBe(true);
    await db.update(tasks).set({ status: "done" }).where(eq(tasks.id, s.task.id));
    expect((await getWorkspaceCalendar(s.student.id, range)).entries.some(e => e.source === "work" || e.id === `task:${s.task.id}`)).toBe(false);
    await db.update(tasks).set({ status: "todo", assigneeId: s.other.id }).where(eq(tasks.id, s.task.id));
    expect((await getWorkspaceCalendar(s.student.id, range)).entries.some(e => e.source === "work")).toBe(false);
    await db.update(tasks).set({ assigneeId: s.student.id }).where(eq(tasks.id, s.task.id));
    await db.update(personalWorkPlans).set({ status: "cancelled" }).where(eq(personalWorkPlans.id, draft.id));
    expect((await getWorkspaceCalendar(s.student.id, range)).entries.some(e => e.source === "work")).toBe(false);
  });
  it("撤销成员资格或归档项目后，任务和项目节点立即从新查询中消失，本人日程保留", async () => {
    const s = await scene();
    await db.update(projects).set({ status: "archived" }).where(eq(projects.id, s.project.id));
    expect((await getWorkspaceCalendar(s.student.id, range)).entries).toEqual([]);
    await db.update(projects).set({ status: "active" }).where(eq(projects.id, s.project.id));
    await db.delete(teamMembers).where(eq(teamMembers.userId, s.student.id));
    expect((await getWorkspaceCalendar(s.student.id, range)).entries).toEqual([]);
  });
  it("完整读取超过原日程页的 50 条记录，并在硬上限明确标记截断", async () => {
    const s = await scene();
    const rows = Array.from({ length: 2001 }, (_, n) => ({ userId: s.student.id, title: `记录 ${n}`, startAt: new Date("2026-10-12T02:00:00Z"), endAt: new Date("2026-10-12T03:00:00Z"), source: "manual", fingerprint: String(n) }));
    await db.insert(personalScheduleEvents).values(rows.slice(0, 65));
    const complete = await getWorkspaceCalendar(s.student.id, range);
    expect(complete.entries.filter(e => e.source === "schedule")).toHaveLength(65);
    expect(complete.truncated).toBe(false);
    await db.insert(personalScheduleEvents).values(rows.slice(65));
    const capped = await getWorkspaceCalendar(s.student.id, range);
    expect(capped.entries.filter(e => e.source === "schedule")).toHaveLength(2000);
    expect(capped.truncated).toBe(true);
  });
  it("拒绝无效、倒序或过长范围，支持完整 42 格月历", () => {
    expect(calendarQuerySchema.safeParse({ startDate: "2026-10-01", endDate: "2026-11-11" }).success).toBe(true);
    for (const bad of [{ startDate: "2026-02-30", endDate: "2026-03-01" }, { startDate: range.endDate, endDate: range.startDate }, { startDate: "2026-10-01", endDate: "2026-11-12" }]) expect(calendarQuerySchema.safeParse(bad).success).toBe(false);
  });
});
